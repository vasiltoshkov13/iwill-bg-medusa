/**
 * Drains `nis2_outbox`.
 *
 * A lead's contact details are committed with its outbox intents in one
 * transaction, but until this job existed nothing moved an intent out of
 * `pending`: leads were stored and never reached the CRM, and the summary email
 * the form promises the visitor was never sent.
 *
 * Delivery is idempotent at each provider: the intent id travels as the
 * `Idempotency-Key` (and as `submissionKey` for Ops), so a retry cannot create a
 * second CRM record or send a second email.
 */

import type { MedusaContainer } from '@medusajs/framework/types';

import { NIS2_MODULE } from '../modules/nis2';
import type Nis2ModuleService from '../modules/nis2/service';
import type { OutboxErrorClass } from '../modules/nis2/durability';
import {
  DEFAULT_OPS_URL,
  DEFAULT_TIMEOUT_MS,
  OPS_ENQUIRY_PATH,
  OPS_INTENT_TYPES,
  UndeliverableIntent,
  attemptBucket,
  buildOpsEnquiry,
  classifyHttpStatus,
  classifyThrown,
  settlementFor,
  type ConsultationRow,
  type LeadRow,
  type OpsEnquiry,
  type OpsIntentType,
} from '../modules/nis2/ops-delivery';
import {
  EMAIL_INTENT_TYPES,
  RESEND_ENDPOINT,
  buildEmailMessage,
  emailConfigFromEnv,
  type EmailIntentType,
  type ResendMessage,
} from '../modules/nis2/email-delivery';

const BATCH_SIZE = 25;
/** A claimed intent is retried by the next run if the process dies mid-flight. */
const LEASE_MS = 5 * 60_000;
const CONTRACT_VERSION = '1.0.0';

interface SafeLogger {
  info(message: string): void;
}

interface OutboxRow {
  id: string;
  request_id: string;
  intent_type: string;
  domain_id: string;
  state: string;
  attempt_count: number;
}

class ProviderHttpError extends Error {
  constructor(readonly status: number) {
    super(`provider responded ${status}`);
    this.name = 'ProviderHttpError';
  }
}

export default async function nis2OutboxJob(container: MedusaContainer): Promise<void> {
  // Kill switch: set to "false" to stop delivery without a code change.
  if (process.env.NIS2_OUTBOX_WORKER === 'false') return;

  const service = container.resolve(NIS2_MODULE) as Nis2ModuleService;
  const logger = container.resolve('logger') as SafeLogger;
  const now = new Date();

  // An unconfigured provider is not a delivery failure: leaving its intents
  // unclaimed keeps them pending at attempt 0 instead of burning the retry
  // ladder and dead-lettering a backlog of real leads over a missing key.
  const deliverable: string[] = [...OPS_INTENT_TYPES];
  if (process.env.RESEND_API_KEY) deliverable.push(...EMAIL_INTENT_TYPES);

  const due = (await service.listNisOutboxes(
    {
      intent_type: deliverable,
      // `processing` rows reappear here only once their lease has expired.
      state: ['pending', 'processing'],
      next_attempt_at: { $lte: now },
    },
    { take: BATCH_SIZE, order: { next_attempt_at: 'ASC' } },
  )) as unknown as OutboxRow[];

  for (const row of due) {
    await deliverIntent(service, logger, row);
  }
}

async function deliverIntent(
  service: Nis2ModuleService,
  logger: SafeLogger,
  row: OutboxRow,
): Promise<void> {
  const attempt = (row.attempt_count ?? 0) + 1;
  const claimedAt = new Date();

  // The state in the selector means a row another run already moved on is left
  // alone. With `MEDUSA_WORKER_MODE=shared` a single scheduler runs this job,
  // so the lease — not this guard — is what protects against a crashed run.
  const claimed = (await service.updateNisOutboxes({
    selector: { id: row.id, state: row.state },
    data: {
      state: 'processing',
      attempt_count: attempt,
      next_attempt_at: new Date(claimedAt.getTime() + LEASE_MS),
    },
  })) as unknown as unknown[];
  if (!Array.isArray(claimed) || claimed.length === 0) return;

  const startedAt = Date.now();
  let httpStatus: number | null = null;

  try {
    const { lead, consultation } = await loadDomain(service, row);
    httpStatus = await dispatch(row, lead, consultation);

    await service.updateNisOutboxes({
      selector: { id: row.id },
      data: { state: 'delivered', last_error_class: null, next_attempt_at: new Date() },
    });

    log(logger, {
      event: 'nis2_outbox_attempt_finished',
      intent_id: row.id,
      intent_type: row.intent_type,
      outcome: 'delivered',
      attempt_bucket: attemptBucket(attempt),
      http_status: httpStatus,
      request_id: row.request_id,
      latency_ms: Date.now() - startedAt,
    });
  } catch (error) {
    const errorClass: OutboxErrorClass = error instanceof ProviderHttpError
      ? classifyHttpStatus(error.status)
      : classifyThrown(error);
    if (error instanceof ProviderHttpError) httpStatus = error.status;

    const settlement = settlementFor(attempt, errorClass, new Date());
    await service.updateNisOutboxes({ selector: { id: row.id }, data: settlement });

    log(logger, {
      event: 'nis2_outbox_attempt_finished',
      intent_id: row.id,
      intent_type: row.intent_type,
      outcome: settlement.state === 'dead_letter' ? 'dead_letter' : 'retry_scheduled',
      attempt_bucket: attemptBucket(attempt),
      error_class: errorClass,
      http_status: httpStatus,
      request_id: row.request_id,
      latency_ms: Date.now() - startedAt,
    });

    if (settlement.state === 'dead_letter') {
      log(logger, {
        event: 'nis2_outbox_dead_lettered',
        intent_id: row.id,
        intent_type: row.intent_type,
        error_class: errorClass,
        attempt_bucket: attemptBucket(attempt),
      });
    }
  }
}

async function dispatch(
  row: OutboxRow,
  lead: LeadRow,
  consultation?: ConsultationRow,
): Promise<number> {
  if ((OPS_INTENT_TYPES as readonly string[]).includes(row.intent_type)) {
    const enquiry = buildOpsEnquiry(row.id, row.intent_type as OpsIntentType, lead, consultation);
    return postToOps(enquiry, row.request_id);
  }
  if ((EMAIL_INTENT_TYPES as readonly string[]).includes(row.intent_type)) {
    const message = buildEmailMessage(
      row.intent_type as EmailIntentType,
      lead,
      emailConfigFromEnv(),
      consultation,
    );
    return postToResend(message, row.id);
  }
  // Only intents this job claims reach here, so an unknown type is a code change
  // that forgot its handler — park it rather than retry it forever.
  throw new UndeliverableIntent('provider_4xx', `no handler for intent ${row.intent_type}`);
}

async function loadDomain(
  service: Nis2ModuleService,
  row: OutboxRow,
): Promise<{ lead: LeadRow; consultation?: ConsultationRow }> {
  try {
    if (row.intent_type === 'ops_consultation' || row.intent_type === 'internal_consultation') {
      const consultation = (await service.retrieveNisConsultation(row.domain_id)) as unknown as ConsultationRow;
      const lead = (await service.retrieveNisLead(consultation.lead_id)) as unknown as LeadRow;
      return { lead, consultation };
    }
    const lead = (await service.retrieveNisLead(row.domain_id)) as unknown as LeadRow;
    return { lead };
  } catch (error) {
    // A domain row that is gone will never come back, so retrying is pointless.
    if (isNotFound(error)) {
      throw new UndeliverableIntent('provider_4xx', `domain row ${row.domain_id} not found`);
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { type?: unknown }).type === 'not_found';
}

async function postToOps(enquiry: OpsEnquiry, requestId: string): Promise<number> {
  const baseUrl = (process.env.IWILL_OPS_API_URL || DEFAULT_OPS_URL).replace(/\/+$/, '');
  const apiKey = process.env.IWILL_OPS_API_KEY;

  return send(`${baseUrl}${OPS_ENQUIRY_PATH}`, {
    'Idempotency-Key': enquiry.submissionKey,
    'X-Request-Id': requestId,
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  }, enquiry);
}

async function postToResend(message: ResendMessage, intentId: string): Promise<number> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Unreachable while the job filters unconfigured providers out of its query,
    // but a claimed intent must never be sent unauthenticated.
    throw new UndeliverableIntent('authentication', 'RESEND_API_KEY is not configured');
  }

  return send(RESEND_ENDPOINT, {
    Authorization: `Bearer ${apiKey}`,
    'Idempotency-Key': intentId,
  }, message);
}

async function send(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<number> {
  const timeoutMs = Number(process.env.IWILL_OPS_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) throw new ProviderHttpError(response.status);
  return response.status;
}

/**
 * Only the dimensions the campaign observability contract allows. Contact
 * details and provider error text never reach the log.
 */
function log(logger: SafeLogger, event: Record<string, unknown>): void {
  logger.info(JSON.stringify({
    service: 'medusa',
    contract_version: CONTRACT_VERSION,
    timestamp: new Date().toISOString(),
    ...event,
  }));
}

export const config = {
  name: 'nis2-outbox',
  schedule: '* * * * *',
};
