/**
 * Pure delivery rules for the IWILL Ops outbox intents.
 *
 * The outbox row carries only `{ domainKind, domainId }`, so the worker loads
 * the domain row and composes the Ops enquiry here. Keeping this module free of
 * I/O lets the retry, dead-letter and payload decisions be unit-tested without a
 * database or a network.
 */

import { backoffForAttempt, type OutboxErrorClass, type OutboxState } from './durability';

export const OPS_INTENT_TYPES = ['ops_lead', 'ops_consultation'] as const;
export type OpsIntentType = (typeof OPS_INTENT_TYPES)[number];

/** ~3.5h of backoff before an intent is parked for a human. */
export const MAX_ATTEMPTS = 8;

export const OPS_ENQUIRY_PATH = '/api/enquiries';
export const DEFAULT_OPS_URL = 'https://iwill-ops-backend-production.up.railway.app';
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Mirrors the fields `POST /api/enquiries` accepts from the storefront. */
export interface OpsEnquiry {
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  message: string;
  source: string;
  subject: string;
  priority: 'normal' | 'urgent';
  submissionKey: string;
}

export interface LeadRow {
  id: string;
  assessment_id?: string | null;
  name?: string | null;
  company_name?: string | null;
  job_title?: string | null;
  email?: string | null;
  phone?: string | null;
  preferred_contact?: string | null;
  privacy_consent?: boolean | null;
  wants_consultation?: boolean | null;
  qualification?: string | null;
  scope_result?: string | null;
  entity_category?: string | null;
  confidence?: string | null;
  enterprise_size?: string | null;
  annex_class?: string | null;
  infrastructure_needs?: string[] | null;
  result_snapshot?: { headline?: unknown } | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
}

export interface ConsultationRow {
  id: string;
  lead_id: string;
}

export class UndeliverableIntent extends Error {
  constructor(readonly errorClass: OutboxErrorClass, message: string) {
    super(message);
    this.name = 'UndeliverableIntent';
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function line(label: string, value: unknown): string | null {
  const rendered = Array.isArray(value) ? value.join(', ') : text(value);
  return rendered ? `${label}: ${rendered}` : null;
}

function campaign(lead: LeadRow): string | null {
  const parts = [lead.utm_source, lead.utm_medium, lead.utm_campaign, lead.utm_content, lead.utm_term]
    .map(text)
    .filter(Boolean);
  return parts.length ? parts.join(' / ') : null;
}

/**
 * A qualified lead from a paid campaign is the one an operator should open
 * first; everything else keeps the ordinary queue priority.
 */
export function priorityFor(lead: LeadRow): 'normal' | 'urgent' {
  return lead.qualification === 'qualified' ? 'urgent' : 'normal';
}

export function buildOpsEnquiry(
  intentId: string,
  intentType: OpsIntentType,
  lead: LeadRow,
  consultation?: ConsultationRow,
): OpsEnquiry {
  const name = text(lead.name);
  const email = text(lead.email);
  // Ops rejects a payload without these, so a domain row that cannot produce
  // them is parked rather than retried against a deterministic 400.
  if (!name || !email) {
    throw new UndeliverableIntent('provider_4xx', `lead ${lead.id} has no usable name/email`);
  }

  const headline = text(lead.result_snapshot?.headline);
  const isConsultation = intentType === 'ops_consultation';
  const body = [
    isConsultation
      ? 'Заявка за консултация от NIS2 проверката на iwill.bg.'
      : 'Заявка от NIS2 проверката на iwill.bg.',
    '',
    headline ? `Резултат: ${headline}` : null,
    line('Обхват', lead.scope_result),
    line('Категория субект', lead.entity_category),
    line('Сигурност на оценката', lead.confidence),
    line('Размер на предприятието', lead.enterprise_size),
    line('Приложение', lead.annex_class),
    line('Квалификация', lead.qualification),
    '',
    line('Длъжност', lead.job_title),
    line('Предпочитан контакт', lead.preferred_contact),
    `Желае консултация: ${lead.wants_consultation ? 'да' : 'не'}`,
    line('Инфраструктурни нужди', lead.infrastructure_needs),
    '',
    line('Lead ID', lead.id),
    line('Assessment ID', lead.assessment_id),
    consultation ? line('Consultation ID', consultation.id) : null,
    line('Кампания', campaign(lead)),
  ]
    .filter((entry) => entry !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    name,
    email,
    phone: text(lead.phone) || null,
    company: text(lead.company_name) || null,
    message: body,
    source: 'iwill.bg/nis2',
    subject: isConsultation ? 'NIS2 — заявка за консултация' : 'NIS2 — предварителна проверка',
    priority: priorityFor(lead),
    // Stable across retries, so a redelivery cannot create a second Ops record.
    submissionKey: intentId,
  };
}

export function classifyHttpStatus(status: number): OutboxErrorClass {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'authentication';
  if (status >= 500) return 'provider_5xx';
  if (status >= 400) return 'provider_4xx';
  return 'unknown';
}

export function classifyThrown(error: unknown): OutboxErrorClass {
  if (error instanceof UndeliverableIntent) return error.errorClass;
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'timeout';
  }
  return 'network';
}

/**
 * A 4xx that is not a throttle is the provider telling us this payload will
 * never be accepted, so it is parked immediately instead of burning the full
 * retry ladder against a deterministic rejection.
 */
export function isTerminal(errorClass: OutboxErrorClass): boolean {
  return errorClass === 'provider_4xx';
}

export interface Settlement {
  state: OutboxState;
  next_attempt_at: Date;
  last_error_class: OutboxErrorClass | null;
}

export function settlementFor(
  attempt: number,
  errorClass: OutboxErrorClass,
  now: Date,
): Settlement {
  if (isTerminal(errorClass) || attempt >= MAX_ATTEMPTS) {
    return { state: 'dead_letter', next_attempt_at: now, last_error_class: errorClass };
  }
  return {
    state: 'pending',
    next_attempt_at: new Date(now.getTime() + backoffForAttempt(attempt)),
    last_error_class: errorClass,
  };
}

/** Coarse buckets keep the retry dashboard readable without per-attempt series. */
export function attemptBucket(attempt: number): string {
  if (attempt <= 1) return '1';
  if (attempt <= 3) return '2-3';
  if (attempt <= 7) return '4-7';
  return '8+';
}
