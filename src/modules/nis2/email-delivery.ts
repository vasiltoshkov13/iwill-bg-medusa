/**
 * Pure message composition for the two email outbox intents.
 *
 * `visitor_summary` is a promise the form makes out loud ("Ще изпратим
 * предоставената от вас оценка ... на посочения служебен email"), so it renders
 * the stored result snapshot rather than re-evaluating anything: the visitor
 * receives exactly the assessment they saw.
 *
 * Kept free of I/O so the copy, the consent gate and the recipient rules can be
 * asserted without a network.
 */

import { NIS2_DISCLAIMER } from './rules/constants';
import type { InfrastructureNeed, Nis2Result } from './rules/types';
import { UndeliverableIntent, type ConsultationRow, type LeadRow } from './ops-delivery';
import { recommendSolutionCategories } from './recommendations';

export const EMAIL_INTENT_TYPES = [
  'visitor_summary',
  'internal_lead',
  'internal_consultation',
] as const;
export type EmailIntentType = (typeof EMAIL_INTENT_TYPES)[number];

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';
export const DEFAULT_SENDER = 'IWILL Bulgaria <noreply@iwill.bg>';
export const DEFAULT_REPLY_INBOX = 'sales@iwill.bg';
export const DEFAULT_INTERNAL_INBOX = 'sales@iwill.bg';

export interface EmailConfig {
  sender: string;
  replyInbox: string;
  internalInbox: string;
}

export interface ResendMessage {
  from: string;
  to: string[];
  subject: string;
  html: string;
  reply_to?: string;
}

export function emailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EmailConfig {
  return {
    sender: env.NIS2_SUMMARY_FROM || DEFAULT_SENDER,
    replyInbox: env.NIS2_REPLY_INBOX || DEFAULT_REPLY_INBOX,
    internalInbox: env.NIS2_INTERNAL_INBOX || DEFAULT_INTERNAL_INBOX,
  };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** A header-safe, minimally plausible address. */
export function isDeliverableAddress(value: unknown): value is string {
  return typeof value === 'string'
    && /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(value.trim());
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resultOf(lead: LeadRow): Nis2Result | null {
  const snapshot = lead.result_snapshot as Nis2Result | null | undefined;
  return snapshot && typeof snapshot === 'object' && text(snapshot.headline) ? snapshot : null;
}

export function buildEmailMessage(
  intentType: EmailIntentType,
  lead: LeadRow,
  config: EmailConfig,
  consultation?: ConsultationRow,
): ResendMessage {
  if (intentType === 'visitor_summary') return visitorSummary(lead, config);
  return internalNotice(intentType, lead, config, consultation);
}

function visitorSummary(lead: LeadRow, config: EmailConfig): ResendMessage {
  // The acknowledgement is what permits this send. Without it on the record the
  // intent is parked rather than delivered on an assumption.
  if (lead.privacy_consent !== true) {
    throw new UndeliverableIntent('provider_4xx', `lead ${lead.id} has no recorded consent`);
  }
  const recipient = text(lead.email);
  if (!isDeliverableAddress(recipient)) {
    throw new UndeliverableIntent('provider_4xx', `lead ${lead.id} has no deliverable address`);
  }
  const result = resultOf(lead);
  if (!result) {
    throw new UndeliverableIntent('provider_4xx', `lead ${lead.id} has no result snapshot`);
  }

  const company = text(lead.company_name);
  return {
    from: config.sender,
    to: [recipient],
    reply_to: config.replyInbox,
    subject: company
      ? `Вашата предварителна NIS2 оценка — ${company}`
      : 'Вашата предварителна NIS2 оценка',
    html: renderVisitorSummaryHtml(lead, result, config.replyInbox),
  };
}

function internalNotice(
  intentType: 'internal_lead' | 'internal_consultation',
  lead: LeadRow,
  config: EmailConfig,
  consultation?: ConsultationRow,
): ResendMessage {
  const recipient = config.internalInbox;
  if (!isDeliverableAddress(recipient)) {
    throw new UndeliverableIntent('provider_4xx', 'internal inbox is not a deliverable address');
  }
  const company = text(lead.company_name) || text(lead.name) || lead.id;
  const isConsultation = intentType === 'internal_consultation';
  const replyTo = isDeliverableAddress(text(lead.email)) ? text(lead.email) : undefined;

  return {
    from: config.sender,
    to: [recipient],
    ...(replyTo ? { reply_to: replyTo } : {}),
    subject: isConsultation
      ? `NIS2 заявка за консултация — ${company}`
      : `NIS2 заявка — ${company}${lead.qualification ? ` (${lead.qualification})` : ''}`,
    html: renderInternalHtml(lead, consultation, isConsultation),
  };
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

function renderVisitorSummaryHtml(
  lead: LeadRow,
  result: Nis2Result,
  replyInbox: string,
): string {
  const reasons = (result.reasons ?? [])
    .map(
      (reason) =>
        `<li style="margin-bottom: 8px; color: #d4d4d8; line-height: 1.6;">${escapeHtml(reason)}</li>`,
    )
    .join('');

  const recommendations = recommendSolutionCategories(
    (lead.infrastructure_needs ?? []) as InfrastructureNeed[],
  );
  const recommendationRows = recommendations
    .map(
      (rec) => `
        <div style="margin-bottom: 14px; padding: 14px; background: #18181b; border-radius: 8px;">
          <p style="margin: 0 0 6px 0; color: #fff; font-weight: 600; font-size: 14px;">${escapeHtml(rec.title)}</p>
          <p style="margin: 0; color: #a1a1aa; font-size: 14px; line-height: 1.6;">${escapeHtml(rec.body)}</p>
        </div>`,
    )
    .join('');

  return `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
      <div style="background: #111; padding: 28px; border-radius: 12px;">
        <p style="margin: 0 0 6px 0; color: #8cc63f; font-size: 12px; letter-spacing: 1px; text-transform: uppercase;">
          NIS2 / Закон за киберсигурност
        </p>
        <h2 style="color: #fff; margin: 0 0 18px 0; font-size: 20px;">Вашата предварителна NIS2 оценка</h2>

        <p style="color: #d4d4d8; line-height: 1.6; margin: 0 0 16px 0;">
          Здравейте, ${escapeHtml(text(lead.name))},
        </p>
        <p style="color: #d4d4d8; line-height: 1.6; margin: 0 0 20px 0;">
          Благодарим, че направихте проверката. Ето обобщение на резултата за
          <strong style="color: #fff;">${escapeHtml(text(lead.company_name))}</strong>.
        </p>

        <div style="padding: 18px; background: #18181b; border-radius: 10px; margin-bottom: 22px;">
          <p style="margin: 0; color: #fff; font-size: 16px; font-weight: 600; line-height: 1.5;">
            ${escapeHtml(result.headline)}
          </p>
          <p style="margin: 12px 0 0 0; color: #a1a1aa; font-size: 14px; line-height: 1.6;">
            ${escapeHtml(result.explanation)}
          </p>
        </div>

        <p style="color: #71717a; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; margin: 0 0 10px 0;">
          Защо този резултат
        </p>
        <ul style="margin: 0 0 24px 0; padding-left: 20px;">${reasons}</ul>

        ${
          recommendationRows
            ? `<p style="color: #71717a; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; margin: 0 0 10px 0;">
                 Какво препоръчваме да се прегледа
               </p>${recommendationRows}`
            : ''
        }

        <div style="margin: 26px 0 0 0; padding: 16px; background: #0a0a0a; border-radius: 8px; border: 1px solid #27272a;">
          <p style="margin: 0; color: #a1a1aa; font-size: 13px; line-height: 1.6;">
            ${escapeHtml(NIS2_DISCLAIMER)}
          </p>
        </div>

        <p style="color: #d4d4d8; line-height: 1.6; margin: 22px 0 0 0;">
          Ако искате наш инженер да прегледа инфраструктурата на организацията ви, просто отговорете на
          този имейл или ни пишете на
          <a href="mailto:${escapeHtml(replyInbox)}" style="color: #8cc63f;">${escapeHtml(replyInbox)}</a>.
        </p>

        <p style="color: #52525b; font-size: 12px; margin: 24px 0 0 0;">
          Версия на правилата: ${escapeHtml(text(result.rulesVersion))} · IWILL България · iwill.bg
        </p>
      </div>
    </div>`;
}

function renderInternalHtml(
  lead: LeadRow,
  consultation: ConsultationRow | undefined,
  isConsultation: boolean,
): string {
  const rows: Array<[string, unknown]> = [
    ['Име', lead.name],
    ['Организация', lead.company_name],
    ['Длъжност', lead.job_title],
    ['Email', lead.email],
    ['Телефон', lead.phone],
    ['Предпочитан контакт', lead.preferred_contact],
    ['Желае консултация', lead.wants_consultation ? 'да' : 'не'],
    ['Квалификация', lead.qualification],
    ['Обхват', lead.scope_result],
    ['Категория субект', lead.entity_category],
    ['Сигурност', lead.confidence],
    ['Размер', lead.enterprise_size],
    ['Приложение', lead.annex_class],
    ['Инфраструктурни нужди', (lead.infrastructure_needs ?? []).join(', ')],
    ['Lead ID', lead.id],
    ['Assessment ID', lead.assessment_id],
    ['Consultation ID', consultation?.id],
    [
      'Кампания',
      [lead.utm_source, lead.utm_medium, lead.utm_campaign, lead.utm_content, lead.utm_term]
        .map(text)
        .filter(Boolean)
        .join(' / '),
    ],
  ];

  const body = rows
    .map(([label, value]) => [label, text(value)] as const)
    .filter(([, value]) => value !== '')
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding: 6px 12px 6px 0; color: #71717a; font-size: 13px; vertical-align: top; white-space: nowrap;">${escapeHtml(label)}</td>
          <td style="padding: 6px 0; color: #e4e4e7; font-size: 14px;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join('');

  const headline = text((lead.result_snapshot as Nis2Result | null | undefined)?.headline);

  return `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
      <div style="background: #111; padding: 24px; border-radius: 12px;">
        <p style="margin: 0 0 6px 0; color: #8cc63f; font-size: 12px; letter-spacing: 1px; text-transform: uppercase;">
          ${isConsultation ? 'NIS2 · заявка за консултация' : 'NIS2 · нова заявка'}
        </p>
        ${headline ? `<p style="color: #fff; margin: 0 0 16px 0; font-size: 15px; line-height: 1.5;">${escapeHtml(headline)}</p>` : ''}
        <table style="border-collapse: collapse; width: 100%;">${body}</table>
      </div>
    </div>`;
}
