/**
 * Drains the IWILL Ops intents from `nis2_outbox`.
 *
 * A lead's contact details are committed with its outbox intents in one
 * transaction, but until this job existed nothing moved an intent out of
 * `pending`: leads were stored and never reached the CRM. This worker closes
 * the `ops_lead` / `ops_consultation` half of NIS2-05; `visitor_summary` and
 * `internal_lead` are deliberately left pending rather than marked delivered,
 * so their absence stays visible.
 *
 * Delivery is idempotent at the provider: the Ops enquiry carries the intent id
 * as both `Idempotency-Key` and `submissionKey`, so a retry cannot create a
 * second CRM record.
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

class OpsHttpError extends Error {
  constructor(readonly status: number) {
    super(`ops responded ${status}`);
    this.name = 'OpsHttpError';
  }
}

export default async function nis2OutboxOpsJob(container: MedusaContainer): Promise<void> {
  // Kill switch: set to "false" to stop delivery without a code change.
  if (process.env.NIS2_OUTBOX_OPS_WORKER === 'false') return;

  const service = container.resolve(NIS2_MODULE) as Nis2ModuleService;
  const logger = container.resolve('logger') as SafeLogger;
  const now = new Date();

  const due = (await service.listNisOutboxes(
    {
      intent_type: [...OPS_INTENT_TYPES],
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
    const enquiry = buildOpsEnquiry(row.id, row.intent_type as OpsIntentType, lead, consultation);
    httpStatus = await postToOps(enquiry, row.request_id);

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
    const errorClass: OutboxErrorClass = error instanceof OpsHttpError
      ? classifyHttpStatus(error.status)
      : classifyThrown(error);
    if (error instanceof OpsHttpError) httpStatus = error.status;

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

async function loadDomain(
  service: Nis2ModuleService,
  row: OutboxRow,
): Promise<{ lead: LeadRow; consultation?: ConsultationRow }> {
  try {
    if (row.intent_type === 'ops_consultation') {
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
  const timeoutMs = Number(process.env.IWILL_OPS_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const apiKey = process.env.IWILL_OPS_API_KEY;

  const response = await fetch(`${baseUrl}${OPS_ENQUIRY_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': enquiry.submissionKey,
      'X-Request-Id': requestId,
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(enquiry),
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) throw new OpsHttpError(response.status);
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
  name: 'nis2-outbox-ops',
  schedule: '* * * * *',
};
