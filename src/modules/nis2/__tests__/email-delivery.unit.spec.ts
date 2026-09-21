import { NIS2_DISCLAIMER } from '../rules/constants';
import { UndeliverableIntent, type ConsultationRow, type LeadRow } from '../ops-delivery';
import {
  DEFAULT_INTERNAL_INBOX,
  DEFAULT_REPLY_INBOX,
  DEFAULT_SENDER,
  buildEmailMessage,
  emailConfigFromEnv,
  escapeHtml,
  isDeliverableAddress,
} from '../email-delivery';

const CONFIG = {
  sender: DEFAULT_SENDER,
  replyInbox: DEFAULT_REPLY_INBOX,
  internalInbox: DEFAULT_INTERNAL_INBOX,
};

const LEAD: LeadRow = {
  id: 'nis2lead_01JTEST',
  assessment_id: 'nis2asm_01JTEST',
  name: 'Иван Петров',
  company_name: 'Примерна Фабрика АД',
  job_title: 'IT мениджър',
  email: 'ivan@primerna.bg',
  phone: '+359888123456',
  preferred_contact: 'phone',
  privacy_consent: true,
  wants_consultation: true,
  qualification: 'qualified',
  scope_result: 'LIKELY_IN_SCOPE',
  entity_category: 'LIKELY_IMPORTANT',
  confidence: 'HIGH',
  enterprise_size: 'MEDIUM',
  annex_class: 'ANNEX_II',
  infrastructure_needs: ['SCADA_OT', 'BACKUP_BUSINESS_CONTINUITY'],
  result_snapshot: {
    headline: 'Висока вероятност организацията ви да попада в обхвата на NIS2.',
    explanation: 'По предоставените данни е възможно организацията да бъде определена като важен субект.',
    reasons: ['Секторът е сред изброените в приложение II.', 'Размерът надхвърля прага за среден субект.'],
    rulesVersion: 'BG-NIS2-2026-09-v1',
  } as unknown as LeadRow['result_snapshot'],
  utm_source: 'inzhenering_revu',
  utm_medium: 'online_article',
  utm_campaign: 'nis2_sep2026',
};

describe('NIS2 outbox email delivery', () => {
  describe('visitor_summary', () => {
    it('addresses the visitor and routes replies to the sales inbox', () => {
      const message = buildEmailMessage('visitor_summary', LEAD, CONFIG);

      expect(message.to).toEqual(['ivan@primerna.bg']);
      expect(message.from).toBe(DEFAULT_SENDER);
      expect(message.reply_to).toBe(DEFAULT_REPLY_INBOX);
      expect(message.subject).toBe('Вашата предварителна NIS2 оценка — Примерна Фабрика АД');
    });

    it('renders the stored snapshot the visitor already saw', () => {
      const { html } = buildEmailMessage('visitor_summary', LEAD, CONFIG);

      expect(html).toContain('Висока вероятност организацията ви да попада в обхвата на NIS2.');
      expect(html).toContain('По предоставените данни е възможно организацията да бъде определена като важен субект.');
      expect(html).toContain('Секторът е сред изброените в приложение II.');
      expect(html).toContain('BG-NIS2-2026-09-v1');
      expect(html).toContain('Иван Петров');
    });

    it('always carries the disclaimer, because a result by email reads as a determination', () => {
      const { html } = buildEmailMessage('visitor_summary', LEAD, CONFIG);

      expect(html).toContain(escapeHtml(NIS2_DISCLAIMER));
    });

    it('turns the selected infrastructure areas into review recommendations', () => {
      const { html } = buildEmailMessage('visitor_summary', LEAD, CONFIG);

      expect(html).toContain('Production / OT');
      expect(html).toContain('Business Continuity');
      expect(html).toContain('Какво препоръчваме да се прегледа');
    });

    it('omits the recommendations block when the visitor only asked for a consultation', () => {
      const { html } = buildEmailMessage(
        'visitor_summary',
        { ...LEAD, infrastructure_needs: ['NOT_SURE_WANT_CONSULTATION'] },
        CONFIG,
      );

      expect(html).not.toContain('Какво препоръчваме да се прегледа');
    });

    it('escapes visitor-supplied text instead of interpolating markup', () => {
      const { html } = buildEmailMessage(
        'visitor_summary',
        { ...LEAD, name: '<script>alert(1)</script>' },
        CONFIG,
      );

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('parks the intent when the record carries no consent', () => {
      expect(() => buildEmailMessage('visitor_summary', { ...LEAD, privacy_consent: false }, CONFIG))
        .toThrow(UndeliverableIntent);
      expect(() => buildEmailMessage('visitor_summary', { ...LEAD, privacy_consent: undefined }, CONFIG))
        .toThrow(UndeliverableIntent);
    });

    it('parks the intent when the address or the snapshot cannot produce an email', () => {
      expect(() => buildEmailMessage('visitor_summary', { ...LEAD, email: 'not-an-address' }, CONFIG))
        .toThrow(UndeliverableIntent);
      expect(() => buildEmailMessage('visitor_summary', { ...LEAD, result_snapshot: null }, CONFIG))
        .toThrow(UndeliverableIntent);
    });
  });

  describe('internal notices', () => {
    it('goes to the internal inbox and replies straight to the visitor', () => {
      const message = buildEmailMessage('internal_lead', LEAD, CONFIG);

      expect(message.to).toEqual([DEFAULT_INTERNAL_INBOX]);
      expect(message.reply_to).toBe('ivan@primerna.bg');
      expect(message.subject).toBe('NIS2 заявка — Примерна Фабрика АД (qualified)');
    });

    it('carries the facts an operator needs to act on the lead', () => {
      const { html } = buildEmailMessage('internal_lead', LEAD, CONFIG);

      expect(html).toContain('ivan@primerna.bg');
      expect(html).toContain('+359888123456');
      expect(html).toContain('nis2lead_01JTEST');
      expect(html).toContain('SCADA_OT, BACKUP_BUSINESS_CONTINUITY');
      expect(html).toContain('inzhenering_revu / online_article / nis2_sep2026');
    });

    it('names the consultation record on a consultation notice', () => {
      const consultation: ConsultationRow = { id: 'nis2consult_01JTEST', lead_id: LEAD.id };
      const message = buildEmailMessage('internal_consultation', LEAD, CONFIG, consultation);

      expect(message.subject).toBe('NIS2 заявка за консултация — Примерна Фабрика АД');
      expect(message.html).toContain('nis2consult_01JTEST');
    });

    it('still notifies when the visitor left no usable reply address', () => {
      const message = buildEmailMessage('internal_lead', { ...LEAD, email: 'broken' }, CONFIG);

      expect(message.to).toEqual([DEFAULT_INTERNAL_INBOX]);
      expect(message.reply_to).toBeUndefined();
    });

    it('does not gate the internal notice on the visitor consent flag', () => {
      // The recipient is IWILL's own inbox; the consent gate guards the visitor send.
      expect(() => buildEmailMessage('internal_lead', { ...LEAD, privacy_consent: false }, CONFIG))
        .not.toThrow();
    });
  });

  describe('configuration', () => {
    it('falls back to the published IWILL addresses', () => {
      expect(emailConfigFromEnv({} as NodeJS.ProcessEnv)).toEqual(CONFIG);
    });

    it('lets a deployment override the sender and both inboxes', () => {
      const env = {
        NIS2_SUMMARY_FROM: 'IWILL <hello@iwill.bg>',
        NIS2_REPLY_INBOX: 'nis2@iwill.bg',
        NIS2_INTERNAL_INBOX: 'ops@iwill.bg',
      } as NodeJS.ProcessEnv;

      expect(emailConfigFromEnv(env)).toEqual({
        sender: 'IWILL <hello@iwill.bg>',
        replyInbox: 'nis2@iwill.bg',
        internalInbox: 'ops@iwill.bg',
      });
    });
  });

  describe('isDeliverableAddress', () => {
    it('accepts an ordinary address and rejects header-unsafe or partial ones', () => {
      expect(isDeliverableAddress('ivan@primerna.bg')).toBe(true);
      expect(isDeliverableAddress('ivan@primerna')).toBe(false);
      expect(isDeliverableAddress('ivan primerna.bg')).toBe(false);
      expect(isDeliverableAddress('a@b.bg, c@d.bg')).toBe(false);
      expect(isDeliverableAddress('a@b.bg\nBcc: x@y.bg')).toBe(false);
      expect(isDeliverableAddress(null)).toBe(false);
    });
  });
});
