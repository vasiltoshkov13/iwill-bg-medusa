import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules } from '@medusajs/framework/utils';
import { NIS2_MODULE } from '../../src/modules/nis2';
import type Nis2ModuleService from '../../src/modules/nis2/service';

jest.setTimeout(120 * 1000);

const VERSION = '1.0.0';
const SECRET = 'integration-test-secret-with-at-least-32-characters';
let publishableKey = '';
const headers = (key?: string) => ({
  'Content-Type': 'application/json',
  'X-NIS2-Contract-Version': VERSION,
  'x-publishable-api-key': publishableKey,
  ...(key ? { 'Idempotency-Key': key } : {}),
});
const acceptAnyStatus = { validateStatus: () => true };

const answers = {
  organizationType: 'PRIVATE_ENTERPRISE',
  sector: 'FOOD',
  subsector: null,
  employees: 'E_50_249',
  turnover: 'T_10_50M',
  assets: 'A_10_43M',
  groupStatus: 'NO',
  specialConditions: ['NONE'],
};
const assessmentBody = {
  answers,
  infrastructureNeeds: ['NETWORK_SEGMENTATION_VLAN'],
  attribution: {},
};
const leadBody = {
  assessmentId: null,
  name: 'Integration Test',
  companyName: 'Integration Organisation',
  jobTitle: null,
  email: 'integration@example.invalid',
  phone: null,
  preferredContact: 'EMAIL',
  privacyConsent: true,
  privacyNoticeVersion: 'nis2-privacy-2026-09-04',
  marketingConsent: false,
  marketingNoticeVersion: null,
  wantsConsultation: false,
  answers,
  infrastructureNeeds: ['NETWORK_SEGMENTATION_VLAN'],
  attribution: {},
};

medusaIntegrationTestRunner({
  inApp: true,
  env: {
    NIS2_IDEMPOTENCY_SECRET: SECRET,
    STRIPE_API_KEY: 'dummy',
  },
  testSuite: ({ api, getContainer, dbConnection }) => {
    const service = () => getContainer().resolve(NIS2_MODULE) as Nis2ModuleService;

    beforeEach(async () => {
      const apiKeyService = getContainer().resolve(Modules.API_KEY) as any;
      const created = await apiKeyService.createApiKeys({
        title: 'NIS2 integration',
        type: 'publishable',
        created_by: 'integration-test',
      });
      publishableKey = created.token;
    });

    describe('NIS2-CAMPAIGN-CONTRACT 1.0.0 durable HTTP API', () => {
      it('serializes concurrent identical assessments to one committed row', async () => {
        const key = '5d9cac03-85c8-44a9-a218-b427a42de85e';
        const responses = await Promise.all(
          Array.from({ length: 5 }, () =>
            api.post('/store/nis2/assessments', assessmentBody, {
              headers: headers(key),
              ...acceptAnyStatus,
            }),
          ),
        );

        expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 200, 200, 201]);
        expect(new Set(responses.map((response) => response.data.assessment.id)).size).toBe(1);
        expect((await service().listNisAssessments({})).filter((row) => row.id === responses[0].data.assessment.id)).toHaveLength(1);
        expect(await service().listNisIdempotencies({ endpoint_kind: 'assessment', idempotency_key: key })).toHaveLength(1);
      });

      it('returns 409 for the same key with changed material data and creates no second row', async () => {
        const key = 'ba70e6aa-1ca1-4f64-bf4d-f083057b53bd';
        const first = await api.post('/store/nis2/assessments', assessmentBody, { headers: headers(key) });
        const changed = await api.post(
          '/store/nis2/assessments',
          { ...assessmentBody, infrastructureNeeds: ['SCADA_OT'] },
          { headers: headers(key), ...acceptAnyStatus },
        );

        expect(first.status).toBe(201);
        expect(changed.status).toBe(409);
        expect(changed.data.error).toEqual(expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED', retryable: false }));
        expect(await service().listNisIdempotencies({ endpoint_kind: 'assessment', idempotency_key: key })).toHaveLength(1);
      });

      it('replays the committed response after a caller loses the first response', async () => {
        const key = '261b86ba-237d-4a97-b7a8-72596c467f8b';
        const first = await api.post('/store/nis2/assessments', assessmentBody, { headers: headers(key) });
        const retry = await api.post('/store/nis2/assessments', assessmentBody, { headers: headers(key) });

        expect(first.status).toBe(201);
        expect(retry.status).toBe(200);
        expect(retry.data.assessment.id).toBe(first.data.assessment.id);
        expect(retry.data.idempotency).toEqual({ replayed: true });
        expect(retry.headers['idempotency-replayed']).toBe('true');
        expect(await service().listNisAssessments({ id: first.data.assessment.id })).toHaveLength(1);
      });

      it('serializes concurrent lead retries to one row and one intent set', async () => {
        const key = '18ee2617-9737-48bf-9b05-c52eddf8f8b5';
        const responses = await Promise.all(
          Array.from({ length: 4 }, () => api.post('/store/nis2/leads', leadBody, { headers: headers(key) })),
        );
        const leadIds = responses.map(({ data }) => data.lead.id);

        expect(responses.map(({ status }) => status).sort()).toEqual([200, 200, 200, 201]);
        expect(new Set(leadIds).size).toBe(1);
        expect(await service().listNisLeads({ id: leadIds[0] })).toHaveLength(1);
        expect(await service().listNisOutboxes({ domain_id: leadIds[0] })).toHaveLength(3);
      });

      it('serializes concurrent consultation retries to one row and one intent set', async () => {
        const leadResponse = await api.post('/store/nis2/leads', leadBody, {
          headers: headers('26c53bc3-c583-4338-9cff-a1a2b56baa37'),
        });
        const leadId = leadResponse.data.lead.id;
        const key = '449a4d4c-1a34-4d2a-9878-d446fc41d6fb';
        const responses = await Promise.all(
          Array.from({ length: 4 }, () =>
            api.post('/store/nis2/consultations', { leadId, attribution: {} }, { headers: headers(key) }),
          ),
        );
        const consultationIds = responses.map(({ data }) => data.consultation.id);

        expect(responses.map(({ status }) => status).sort()).toEqual([200, 200, 200, 201]);
        expect(new Set(consultationIds).size).toBe(1);
        expect(await service().listNisConsultations({ id: consultationIds[0] })).toHaveLength(1);
        expect(await service().listNisOutboxes({ domain_id: consultationIds[0] })).toHaveLength(2);
      });

      it('commits the lead, idempotency result and three outbox intents before 201', async () => {
        const key = '6f736d1a-bb9d-4f3b-9964-3a688842d28d';
        const response = await api.post('/store/nis2/leads', leadBody, { headers: headers(key) });

        expect(response.status).toBe(201);
        expect(response.data.lead).toEqual(expect.objectContaining({ qualification: 'qualified' }));
        const leadId = response.data.lead.id;
        const records = await service().listNisLeads({ id: leadId });
        expect(records).toHaveLength(1);
        expect(records[0].result_snapshot).toEqual(
          expect.objectContaining({
            rulesVersion: 'BG-NIS2-2026-08-v1',
            headline: expect.any(String),
            explanation: expect.any(String),
            reasons: expect.any(Array),
            disclaimer: expect.any(String),
          }),
        );
        expect(await service().listNisIdempotencies({ endpoint_kind: 'lead', idempotency_key: key })).toHaveLength(1);
        expect((await service().listNisOutboxes({ domain_id: leadId })).map((row) => row.intent_type).sort()).toEqual([
          'internal_lead',
          'ops_lead',
          'visitor_summary',
        ]);
      });

      it('commits a consultation row linked to its lead with two outbox intents', async () => {
        const leadResponse = await api.post('/store/nis2/leads', leadBody, {
          headers: headers('8f80f40c-60c8-401e-9857-8c17ed2839dd'),
        });
        const leadId = leadResponse.data.lead.id;
        const response = await api.post(
          '/store/nis2/consultations',
          { leadId, attribution: {} },
          { headers: headers('d1a82d35-e9b9-4ff9-8168-65f148564b77') },
        );

        expect(response.status).toBe(201);
        expect(response.data.consultation).toEqual(expect.objectContaining({ leadId }));
        const consultationId = response.data.consultation.id;
        expect(await service().listNisConsultations({ id: consultationId, lead_id: leadId })).toHaveLength(1);
        expect((await service().listNisOutboxes({ domain_id: consultationId })).map((row) => row.intent_type).sort()).toEqual([
          'internal_consultation',
          'ops_consultation',
        ]);
      });

      it('creates no durable record for missing idempotency or a non-blank honeypot', async () => {
        const before = (await service().listNisAssessments({})).length;
        const missing = await api.post('/store/nis2/assessments', assessmentBody, {
          headers: headers(),
          ...acceptAnyStatus,
        });
        const honeypot = await api.post(
          '/store/nis2/assessments',
          { ...assessmentBody, company_website: 'bot-value' },
          {
            headers: headers('b932b7ea-c914-40f4-838e-b011f870dc48'),
            ...acceptAnyStatus,
          },
        );

        expect(missing.status).toBe(400);
        expect(missing.data.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
        expect(honeypot.status).toBe(400);
        expect(honeypot.data.error).toEqual({
          code: 'VALIDATION_FAILED',
          message: 'Моля, проверете отбелязаните полета.',
          retryable: false,
        });
        expect((await service().listNisAssessments({})).length).toBe(before);
        expect(await service().listNisIdempotencies({ idempotency_key: 'b932b7ea-c914-40f4-838e-b011f870dc48' })).toHaveLength(0);
      });

      it('returns the v1 envelope for malformed JSON before any durable write', async () => {
        const before = (await service().listNisAssessments({})).length;
        const response = await api.post('/store/nis2/assessments', '{"answers":', {
          headers: headers('a9cdff3d-b124-4f51-aea7-8be331763d5d'),
          transformRequest: [(value) => value],
          ...acceptAnyStatus,
        });

        expect(response.status).toBe(400);
        expect(response.headers['x-nis2-contract-version']).toBe(VERSION);
        expect(response.data.error).toEqual({
          code: 'INVALID_JSON',
          message: 'Заявката не съдържа валиден JSON.',
          retryable: false,
        });
        expect((await service().listNisAssessments({})).length).toBe(before);
      });

      it('rejects a raw body over 16 KiB with the v1 envelope and no durable write', async () => {
        const before = (await service().listNisAssessments({})).length;
        const response = await api.post(
          '/store/nis2/assessments',
          JSON.stringify({ ...assessmentBody, padding: 'x'.repeat(16 * 1024) }),
          {
            headers: headers('48da5f12-a32d-4833-996a-c08f46ee3fc0'),
            transformRequest: [(value) => value],
            ...acceptAnyStatus,
          },
        );

        expect(response.status).toBe(413);
        expect(response.headers['x-nis2-contract-version']).toBe(VERSION);
        expect(response.data.error).toEqual({
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Заявката е твърде голяма.',
          retryable: false,
        });
        expect((await service().listNisAssessments({})).length).toBe(before);
      });

      it('rolls back the domain row when an outbox write fails before commit', async () => {
        const key = '6638a636-461a-4e07-91d8-165e476f3e4d';
        const beforeLeads = (await service().listNisLeads({})).length;
        const beforeOutbox = (await service().listNisOutboxes({})).length;
        await dbConnection.raw(
          'alter table nis2_outbox add constraint nis2_outbox_forced_rollback check (false) not valid',
        );

        try {
          const response = await api.post('/store/nis2/leads', leadBody, {
            headers: headers(key),
            ...acceptAnyStatus,
          });

          expect(response.status).toBe(503);
          expect(response.data.error).toEqual(
            expect.objectContaining({ code: 'PERSISTENCE_UNAVAILABLE', retryable: true }),
          );
          expect((await service().listNisLeads({})).length).toBe(beforeLeads);
          expect((await service().listNisOutboxes({})).length).toBe(beforeOutbox);
          expect(await service().listNisIdempotencies({ idempotency_key: key })).toHaveLength(0);
        } finally {
          await dbConnection.raw(
            'alter table nis2_outbox drop constraint if exists nis2_outbox_forced_rollback',
          );
        }
      });

      it('fails closed with generic 503 when the durable dependency is unavailable', async () => {
        await dbConnection.raw('drop table nis2_assessment cascade');
        const response = await api.post('/store/nis2/assessments', assessmentBody, {
          headers: headers('bb2b83c7-7733-4ba2-a820-bfc811b9438a'),
          ...acceptAnyStatus,
        });

        expect(response.status).toBe(503);
        expect(response.data.error).toEqual(expect.objectContaining({
          code: 'PERSISTENCE_UNAVAILABLE',
          retryable: true,
        }));
        expect(JSON.stringify(response.data)).not.toContain('integration@example.invalid');
      });
    });
  },
});
