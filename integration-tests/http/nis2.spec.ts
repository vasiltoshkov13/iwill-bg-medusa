import { createServer, type IncomingMessage, type Server } from 'node:http';

import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules } from '@medusajs/framework/utils';
import { NIS2_MODULE } from '../../src/modules/nis2';
import type Nis2ModuleService from '../../src/modules/nis2/service';
import storefrontLeadBody from '../fixtures/storefront-34d404509a5cbedda22f42ea908b2f7cb97873cb-lead.json';

jest.setTimeout(120 * 1000);

const VERSION = '1.0.0';
const SECRET = 'integration-test-secret-with-at-least-32-characters';
const LIMITER_SECRET = 'integration-limiter-secret-with-at-least-32-characters';
let publishableKey = '';
let limiterServer: Server;
let limiterUrl = '';
let limiterMode: 'normal' | 'error' = 'normal';
const limiterCounts = new Map<string, number>();
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
const leadBody = storefrontLeadBody;

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

medusaIntegrationTestRunner({
  inApp: true,
  env: {
    NIS2_IDEMPOTENCY_SECRET: SECRET,
    STRIPE_API_KEY: 'dummy',
  },
  testSuite: ({ api, getContainer, dbConnection }) => {
    const service = () => getContainer().resolve(NIS2_MODULE) as Nis2ModuleService;

    beforeAll(async () => {
      limiterServer = createServer(async (request, response) => {
        if (limiterMode === 'error') {
          response.writeHead(503, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'synthetic limiter outage' }));
          return;
        }
        try {
          const command = JSON.parse(await readRequestBody(request)) as unknown[];
          const keyCount = Number(command[2]);
          const keys = command.slice(3, 3 + keyCount).map(String);
          const counts = keys.map((key) => {
            const count = (limiterCounts.get(key) ?? 0) + 1;
            limiterCounts.set(key, count);
            return count;
          });
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ result: counts }));
        } catch {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'invalid test command' }));
        }
      });
      await new Promise<void>((resolve) => limiterServer.listen(0, '127.0.0.1', resolve));
      const address = limiterServer.address();
      if (!address || typeof address === 'string') throw new Error('Limiter test server did not bind.');
      limiterUrl = `http://127.0.0.1:${address.port}`;
      process.env.NIS2_RATE_LIMIT_REST_URL = limiterUrl;
      process.env.NIS2_RATE_LIMIT_REST_TOKEN = 'synthetic-integration-token';
      process.env.NIS2_RATE_LIMIT_HMAC_SECRET = LIMITER_SECRET;
      process.env.NIS2_RATE_LIMIT_ALLOW_LOOPBACK = 'true';
    });

    afterAll(async () => {
      await new Promise<void>((resolve, reject) => {
        limiterServer.close((error) => error ? reject(error) : resolve());
      });
    });

    beforeEach(async () => {
      limiterCounts.clear();
      limiterMode = 'normal';
      process.env.NIS2_RATE_LIMIT_REST_URL = limiterUrl;
      process.env.NIS2_RATE_LIMIT_ASSESSMENT_NETWORK_MAX = '1000';
      process.env.NIS2_RATE_LIMIT_ASSESSMENT_GLOBAL_MAX = '1000';
      process.env.NIS2_RATE_LIMIT_ASSESSMENT_KEY_MAX = '1000';
      process.env.NIS2_RATE_LIMIT_LEAD_NETWORK_MAX = '1000';
      process.env.NIS2_RATE_LIMIT_LEAD_GLOBAL_MAX = '1000';
      process.env.NIS2_RATE_LIMIT_LEAD_KEY_MAX = '1000';
      process.env.NIS2_RATE_LIMIT_CONSULTATION_NETWORK_MAX = '1000';
      process.env.NIS2_RATE_LIMIT_CONSULTATION_GLOBAL_MAX = '1000';
      process.env.NIS2_RATE_LIMIT_CONSULTATION_KEY_MAX = '1000';
      const apiKeyService = getContainer().resolve(Modules.API_KEY) as any;
      const created = await apiKeyService.createApiKeys({
        title: 'NIS2 integration',
        type: 'publishable',
        created_by: 'integration-test',
      });
      publishableKey = created.token;
    });

    describe('NIS2-CAMPAIGN-CONTRACT 1.0.0 durable HTTP API', () => {
      it('rejects an absent contract version before any durable write', async () => {
        const before = (await service().listNisAssessments({})).length;
        const response = await api.post('/store/nis2/assessments', assessmentBody, {
          headers: {
            'Content-Type': 'application/json',
            'x-publishable-api-key': publishableKey,
            'Idempotency-Key': '4f2e379c-d387-4029-bf62-da11b01db1d6',
          },
          ...acceptAnyStatus,
        });

        expect(response.status).toBe(426);
        expect(response.headers['x-nis2-contract-version']).toBe(VERSION);
        expect(response.data.error).toEqual(expect.objectContaining({
          code: 'UNSUPPORTED_CONTRACT_VERSION',
          retryable: false,
        }));
        expect((await service().listNisAssessments({})).length).toBe(before);
      });

      it('rejects a mismatched contract version before any durable write', async () => {
        const before = (await service().listNisAssessments({})).length;
        const response = await api.post('/store/nis2/assessments', assessmentBody, {
          headers: {
            ...headers('8a2413cf-4be0-4140-b0dd-e0a803e18f1d'),
            'X-NIS2-Contract-Version': '0.9.0',
          },
          ...acceptAnyStatus,
        });

        expect(response.status).toBe(426);
        expect(response.data.error).toEqual(expect.objectContaining({
          code: 'UNSUPPORTED_CONTRACT_VERSION',
          retryable: false,
        }));
        expect((await service().listNisAssessments({})).length).toBe(before);
      });

      it('requires versioned privacy consent at the direct Medusa lead boundary', async () => {
        const before = (await service().listNisLeads({})).length;
        const response = await api.post(
          '/store/nis2/leads',
          { ...leadBody, privacyConsent: false },
          {
            headers: headers('d43e8bab-6486-4651-ad6a-ccbd6fa84db5'),
            ...acceptAnyStatus,
          },
        );

        expect(response.status).toBe(400);
        expect(response.data.error).toEqual(expect.objectContaining({
          code: 'CONSENT_REQUIRED',
          retryable: false,
        }));
        expect((await service().listNisLeads({})).length).toBe(before);
      });

      it('accepts the exact storefront 34d4045 lead payload as a durable write', async () => {
        const key = '90b3f62f-8c20-4b02-9004-0d8539f76dfa';
        const beforeLeads = (await service().listNisLeads({})).length;
        const beforeOutbox = (await service().listNisOutboxes({})).length;

        const response = await api.post('/store/nis2/leads', storefrontLeadBody, {
          headers: headers(key),
          ...acceptAnyStatus,
        });

        expect(response.status).toBe(201);
        const leadId = response.data.lead.id;
        const persisted = await service().listNisLeads({ id: leadId });
        expect(persisted).toHaveLength(1);
        expect(persisted[0].privacy_notice_version).toBe('nis2-privacy-2026-09-08-93ba2f3d8256');
        expect((await service().listNisLeads({})).length).toBe(beforeLeads + 1);
        expect((await service().listNisOutboxes({})).length).toBe(beforeOutbox + 3);
        expect(await service().listNisIdempotencies({ endpoint_kind: 'lead', idempotency_key: key })).toHaveLength(1);
      });

      it.each([
        ['the former approved version', 'nis2-privacy-2026-09-04', '0c5c2c4d-21e8-4a86-bff0-b9c195ccac09'],
        ['the superseded storefront version', 'nis2-privacy-2026-09-08-5090901008de', 'a2b1c914-874f-43c8-9451-c946f63c3815'],
        ['a changed canonical version', 'nis2-privacy-2026-09-08-93ba2f3d8256-changed', 'd6f6d337-ea7e-422f-9447-22c7b695180b'],
        ['a whitespace-modified canonical version', ' nis2-privacy-2026-09-08-93ba2f3d8256 ', '23ac6425-b44f-40c3-a567-11f9de14a783'],
        ['an unknown version', 'nis2-privacy-unknown', 'eb855cb0-3149-4ea6-b502-a1a4673986d0'],
        ['a missing version', undefined, '113d9030-a65e-444d-87d2-1f1e420248f4'],
      ])('rejects %s before a durable write', async (_case, privacyNoticeVersion, key) => {
        const beforeLeads = (await service().listNisLeads({})).length;
        const beforeOutbox = (await service().listNisOutboxes({})).length;
        const response = await api.post(
          '/store/nis2/leads',
          { ...storefrontLeadBody, privacyNoticeVersion },
          { headers: headers(key), ...acceptAnyStatus },
        );

        expect(response.status).toBe(400);
        expect(response.data.error).toEqual(expect.objectContaining({
          code: 'VALIDATION_FAILED',
          retryable: false,
          field: 'privacyNoticeVersion',
        }));
        expect((await service().listNisLeads({})).length).toBe(beforeLeads);
        expect((await service().listNisOutboxes({})).length).toBe(beforeOutbox);
        expect(await service().listNisIdempotencies({ endpoint_kind: 'lead', idempotency_key: key })).toHaveLength(0);
      });

      it('enforces the fleet ceiling at the direct Medusa boundary', async () => {
        process.env.NIS2_RATE_LIMIT_ASSESSMENT_GLOBAL_MAX = '2';
        const before = (await service().listNisAssessments({})).length;
        const keys = [
          '08d28098-11d0-4a6f-8e7e-d8e72ba8767d',
          'cefe0111-47df-4b0a-8fea-669132d1293c',
          'b2a6bb0e-a076-4b6b-8b24-c8535ad84701',
        ];
        const first = await api.post('/store/nis2/assessments', assessmentBody, {
          headers: headers(keys[0]),
          ...acceptAnyStatus,
        });
        const second = await api.post('/store/nis2/assessments', assessmentBody, {
          headers: headers(keys[1]),
          ...acceptAnyStatus,
        });
        const third = await api.post('/store/nis2/assessments', assessmentBody, {
          headers: headers(keys[2]),
          ...acceptAnyStatus,
        });

        expect([first.status, second.status, third.status]).toEqual([201, 201, 429]);
        expect(third.headers['retry-after']).toEqual(expect.any(String));
        expect(third.data.error).toEqual(expect.objectContaining({
          code: 'RATE_LIMITED',
          retryable: true,
        }));
        expect((await service().listNisAssessments({})).length).toBe(before + 2);
      });

      it('ignores spoofed forwarding headers when enforcing the peer-network ceiling', async () => {
        process.env.NIS2_RATE_LIMIT_ASSESSMENT_NETWORK_MAX = '2';
        const before = (await service().listNisAssessments({})).length;
        const keys = [
          '0654623d-e283-422c-8435-28acf0be9218',
          'b547a610-f11b-4246-8e49-28c109c1b8de',
          '6d02a90c-a52e-4ebf-870a-1803ccb59c29',
        ];
        const submit = (index: number) => api.post('/store/nis2/assessments', assessmentBody, {
            headers: {
              ...headers(keys[index]),
              'X-Forwarded-For': `203.0.113.${index + 10}`,
              'X-Real-IP': `198.51.100.${index + 10}`,
            },
            ...acceptAnyStatus,
          });
        const first = await submit(0);
        const second = await submit(1);
        const third = await submit(2);

        expect([first.status, second.status, third.status]).toEqual([201, 201, 429]);
        expect((await service().listNisAssessments({})).length).toBe(before + 2);
      });

      it('allows distinct logical submissions behind one NAT below the network ceiling', async () => {
        process.env.NIS2_RATE_LIMIT_ASSESSMENT_NETWORK_MAX = '3';
        process.env.NIS2_RATE_LIMIT_ASSESSMENT_KEY_MAX = '1';
        const before = (await service().listNisAssessments({})).length;
        const first = await api.post('/store/nis2/assessments', assessmentBody, {
          headers: headers('c3883b15-530a-41f1-892f-8ec516822942'),
          ...acceptAnyStatus,
        });
        const second = await api.post('/store/nis2/assessments', assessmentBody, {
          headers: headers('1f93649f-ab32-4cf7-a30e-00bb9dbbb9dc'),
          ...acceptAnyStatus,
        });

        expect([first.status, second.status]).toEqual([201, 201]);
        expect((await service().listNisAssessments({})).length).toBe(before + 2);
      });

      it('enforces a logical-submission key ceiling before replay work', async () => {
        process.env.NIS2_RATE_LIMIT_ASSESSMENT_KEY_MAX = '2';
        const key = 'e1a9c1ac-a8cc-4312-9981-6b6c1448f0d9';
        const first = await api.post('/store/nis2/assessments', assessmentBody, {
          headers: headers(key),
          ...acceptAnyStatus,
        });
        const second = await api.post('/store/nis2/assessments', assessmentBody, {
          headers: headers(key),
          ...acceptAnyStatus,
        });
        const third = await api.post('/store/nis2/assessments', assessmentBody, {
          headers: headers(key),
          ...acceptAnyStatus,
        });

        expect([first.status, second.status, third.status]).toEqual([201, 200, 429]);
        expect(third.data.error.code).toBe('RATE_LIMITED');
        expect(await service().listNisIdempotencies({ idempotency_key: key })).toHaveLength(1);
      });

      it('fails closed without a durable write when the shared limiter is unavailable', async () => {
        limiterMode = 'error';
        const before = (await service().listNisLeads({})).length;
        const response = await api.post('/store/nis2/leads', leadBody, {
          headers: headers('4449038b-abf4-4444-b411-f462a180043c'),
          ...acceptAnyStatus,
        });

        expect(response.status).toBe(503);
        expect(response.headers['retry-after']).toBe('1');
        expect(response.data.error).toEqual(expect.objectContaining({
          code: 'PERSISTENCE_UNAVAILABLE',
          retryable: true,
        }));
        expect(JSON.stringify(response.data)).not.toContain(leadBody.email);
        expect((await service().listNisLeads({})).length).toBe(before);
      });

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
        expect(JSON.stringify(response.data)).not.toContain(storefrontLeadBody.email);
      });
    });
  },
});
