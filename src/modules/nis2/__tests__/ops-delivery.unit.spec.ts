import { backoffForAttempt } from '../durability';
import {
  MAX_ATTEMPTS,
  UndeliverableIntent,
  attemptBucket,
  buildOpsEnquiry,
  classifyHttpStatus,
  classifyThrown,
  isTerminal,
  priorityFor,
  settlementFor,
  type ConsultationRow,
  type LeadRow,
} from '../ops-delivery';

const INTENT_ID = 'nis2intent_01JTESTOPSLEAD';
const NOW = new Date('2026-09-21T10:00:00.000Z');

const LEAD: LeadRow = {
  id: 'nis2lead_01JTEST',
  assessment_id: 'nis2asm_01JTEST',
  name: 'Иван Петров',
  company_name: 'Примерна Фабрика АД',
  job_title: 'IT мениджър',
  email: 'ivan@primerna.bg',
  phone: '+359888123456',
  preferred_contact: 'phone',
  wants_consultation: true,
  qualification: 'qualified',
  scope_result: 'LIKELY_IN_SCOPE',
  entity_category: 'LIKELY_IMPORTANT',
  confidence: 'HIGH',
  enterprise_size: 'MEDIUM',
  annex_class: 'ANNEX_II',
  infrastructure_needs: ['SCADA_OT', 'NETWORK_SEGMENTATION_VLAN'],
  result_snapshot: { headline: 'Висока вероятност организацията ви да попада в обхвата на NIS2.' },
  utm_source: 'inzhenering_revu',
  utm_medium: 'online_article',
  utm_campaign: 'nis2_sep2026',
  utm_content: 'article_link',
  utm_term: null,
};

describe('NIS2 Ops outbox delivery', () => {
  describe('buildOpsEnquiry', () => {
    it('carries the contact fields Ops requires and the intent id as the dedupe key', () => {
      const enquiry = buildOpsEnquiry(INTENT_ID, 'ops_lead', LEAD);

      expect(enquiry.name).toBe('Иван Петров');
      expect(enquiry.email).toBe('ivan@primerna.bg');
      expect(enquiry.phone).toBe('+359888123456');
      expect(enquiry.company).toBe('Примерна Фабрика АД');
      expect(enquiry.message).not.toBe('');
      expect(enquiry.source).toBe('iwill.bg/nis2');
      // Stable across retries: a redelivery must not create a second record.
      expect(enquiry.submissionKey).toBe(INTENT_ID);
    });

    it('puts the assessment outcome and campaign into the CRM message', () => {
      const { message } = buildOpsEnquiry(INTENT_ID, 'ops_lead', LEAD);

      expect(message).toContain('Висока вероятност организацията ви да попада в обхвата на NIS2.');
      expect(message).toContain('LIKELY_IN_SCOPE');
      expect(message).toContain('SCADA_OT, NETWORK_SEGMENTATION_VLAN');
      expect(message).toContain('nis2lead_01JTEST');
      expect(message).toContain('nis2asm_01JTEST');
      expect(message).toContain('inzhenering_revu / online_article / nis2_sep2026 / article_link');
      expect(message).toContain('Желае консултация: да');
    });

    it('distinguishes a consultation intent and names the consultation record', () => {
      const consultation: ConsultationRow = { id: 'nis2consult_01JTEST', lead_id: LEAD.id };
      const enquiry = buildOpsEnquiry(INTENT_ID, 'ops_consultation', LEAD, consultation);

      expect(enquiry.subject).toBe('NIS2 — заявка за консултация');
      expect(enquiry.message).toContain('Заявка за консултация');
      expect(enquiry.message).toContain('nis2consult_01JTEST');
    });

    it('omits absent optional fields instead of printing empty labels', () => {
      const sparse: LeadRow = {
        id: 'nis2lead_02',
        name: 'Мария',
        email: 'maria@example.bg',
        company_name: null,
        phone: null,
        job_title: null,
        infrastructure_needs: null,
        result_snapshot: null,
      };
      const enquiry = buildOpsEnquiry(INTENT_ID, 'ops_lead', sparse);

      expect(enquiry.phone).toBeNull();
      expect(enquiry.company).toBeNull();
      expect(enquiry.message).not.toContain('Длъжност:');
      expect(enquiry.message).not.toContain('Кампания:');
      expect(enquiry.message).toContain('Желае консултация: не');
    });

    it('parks a row Ops would reject rather than retrying a deterministic 400', () => {
      const noEmail: LeadRow = { id: 'nis2lead_03', name: 'Иван', email: '  ' };

      expect(() => buildOpsEnquiry(INTENT_ID, 'ops_lead', noEmail)).toThrow(UndeliverableIntent);
      expect(classifyThrown(catchError(() => buildOpsEnquiry(INTENT_ID, 'ops_lead', noEmail))))
        .toBe('provider_4xx');
    });
  });

  describe('priorityFor', () => {
    it('raises a qualified lead and leaves the rest at the ordinary priority', () => {
      expect(priorityFor({ ...LEAD, qualification: 'qualified' })).toBe('urgent');
      expect(priorityFor({ ...LEAD, qualification: 'review_required' })).toBe('normal');
      expect(priorityFor({ ...LEAD, qualification: 'unqualified' })).toBe('normal');
      expect(priorityFor({ id: 'x' })).toBe('normal');
    });
  });

  describe('error classification', () => {
    it('maps provider responses onto the outbox error classes', () => {
      expect(classifyHttpStatus(429)).toBe('rate_limited');
      expect(classifyHttpStatus(401)).toBe('authentication');
      expect(classifyHttpStatus(403)).toBe('authentication');
      expect(classifyHttpStatus(400)).toBe('provider_4xx');
      expect(classifyHttpStatus(404)).toBe('provider_4xx');
      expect(classifyHttpStatus(500)).toBe('provider_5xx');
      expect(classifyHttpStatus(503)).toBe('provider_5xx');
    });

    it('separates an expired deadline from an unreachable provider', () => {
      // `AbortSignal.timeout()` aborts the fetch, so both names mean the
      // deadline expired -- the same reading the storefront's Ops client uses.
      const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });

      expect(classifyThrown(timeout)).toBe('timeout');
      expect(classifyThrown(aborted)).toBe('timeout');
      expect(classifyThrown(new Error('getaddrinfo ENOTFOUND'))).toBe('network');
    });

    it('treats only a non-throttle 4xx as terminal', () => {
      expect(isTerminal('provider_4xx')).toBe(true);
      expect(isTerminal('rate_limited')).toBe(false);
      expect(isTerminal('provider_5xx')).toBe(false);
      expect(isTerminal('timeout')).toBe(false);
      expect(isTerminal('network')).toBe(false);
      expect(isTerminal('authentication')).toBe(false);
    });
  });

  describe('settlementFor', () => {
    it('schedules the next attempt on the shared backoff ladder', () => {
      const settlement = settlementFor(1, 'provider_5xx', NOW);

      expect(settlement.state).toBe('pending');
      expect(settlement.last_error_class).toBe('provider_5xx');
      expect(settlement.next_attempt_at.getTime()).toBe(NOW.getTime() + backoffForAttempt(1));
    });

    it('keeps retrying a throttle instead of parking it', () => {
      expect(settlementFor(2, 'rate_limited', NOW).state).toBe('pending');
    });

    it('parks a deterministic rejection on the first attempt', () => {
      const settlement = settlementFor(1, 'provider_4xx', NOW);

      expect(settlement.state).toBe('dead_letter');
      expect(settlement.last_error_class).toBe('provider_4xx');
    });

    it('parks the intent once the retry ladder is exhausted', () => {
      expect(settlementFor(MAX_ATTEMPTS - 1, 'timeout', NOW).state).toBe('pending');
      expect(settlementFor(MAX_ATTEMPTS, 'timeout', NOW).state).toBe('dead_letter');
      expect(settlementFor(MAX_ATTEMPTS + 1, 'network', NOW).state).toBe('dead_letter');
    });
  });

  describe('attemptBucket', () => {
    it('collapses attempts into the dashboard buckets', () => {
      expect(attemptBucket(1)).toBe('1');
      expect(attemptBucket(3)).toBe('2-3');
      expect(attemptBucket(7)).toBe('4-7');
      expect(attemptBucket(8)).toBe('8+');
    });
  });
});

function catchError(run: () => unknown): unknown {
  try {
    run();
    throw new Error('expected the call to throw');
  } catch (error) {
    return error;
  }
}
