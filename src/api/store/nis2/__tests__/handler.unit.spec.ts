import { CONTRACT_VERSION } from '../contract';
import { handleV1Request } from '../handler';

const KEY = '5d9cac03-85c8-44a9-a218-b427a42de85e';
const originalFetch = global.fetch;
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

function responseDouble() {
  const response: any = {
    setHeader: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
}

function requestDouble(body: Record<string, unknown>, service: Record<string, jest.Mock>, logger = { info: jest.fn() }) {
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'x-nis2-contract-version': CONTRACT_VERSION,
      'idempotency-key': KEY,
    },
    scope: {
      resolve: jest.fn((name: string) => (name === 'logger' ? logger : service)),
    },
  } as any;
}

describe('NIS2 v1 route durability adapter', () => {
  beforeEach(() => {
    process.env.NIS2_IDEMPOTENCY_SECRET = 'unit-test-secret-with-at-least-32-characters';
    process.env.NIS2_RATE_LIMIT_REST_URL = 'https://rate-limit.example.invalid';
    process.env.NIS2_RATE_LIMIT_REST_TOKEN = 'synthetic-unit-token';
    process.env.NIS2_RATE_LIMIT_HMAC_SECRET = 'unit-limiter-secret-with-at-least-32-characters';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: [1, 1, 1] }),
    });
  });

  afterEach(() => {
    delete process.env.NIS2_IDEMPOTENCY_SECRET;
    delete process.env.NIS2_RATE_LIMIT_REST_URL;
    delete process.env.NIS2_RATE_LIMIT_REST_TOKEN;
    delete process.env.NIS2_RATE_LIMIT_HMAC_SECRET;
    global.fetch = originalFetch;
  });

  it('returns 201 only after the assessment service reports a committed row', async () => {
    const committed = {
      assessment: { id: 'nis2asm_01JTEST', persistedAt: '2026-09-04T00:00:00.000Z', rulesVersion: 'BG-NIS2-2026-08-v1' },
      result: { rulesVersion: 'BG-NIS2-2026-08-v1' },
      requestId: 'service-request',
      idempotency: { replayed: false },
    };
    const service = {
      createAssessmentSubmission: jest.fn().mockResolvedValue({
        status: 201,
        body: committed,
        persistenceOutcome: 'committed',
      }),
    };
    const logger = { info: jest.fn() };
    const req = requestDouble({ answers, infrastructureNeeds: [], attribution: {} }, service, logger);
    const res = responseDouble();

    await expect(handleV1Request('assessment', req, res)).resolves.toBe(true);

    expect(service.createAssessmentSubmission).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(committed);
    expect(res.setHeader).toHaveBeenCalledWith('X-NIS2-Contract-Version', CONTRACT_VERSION);
    expect(logger.info.mock.calls.map(([entry]) => JSON.parse(entry))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'nis2_durable_write_completed',
          record_type: 'assessment',
          outcome: 'committed',
          replayed: false,
        }),
      ]),
    );
  });

  it('marks a duplicate committed request as a 200 replay', async () => {
    const service = {
      createConsultationSubmission: jest.fn().mockResolvedValue({
        status: 200,
        body: {
          consultation: { id: 'nis2consult_01JTEST', leadId: 'nis2lead_01JTEST', persistedAt: '2026-09-04T00:00:00.000Z' },
          requestId: 'retry',
          idempotency: { replayed: true },
          delivery: { ops: 'queued', internalNotification: 'queued' },
        },
        persistenceOutcome: 'none',
      }),
    };
    const req = requestDouble({ leadId: 'nis2lead_01JTEST', attribution: {} }, service);
    const res = responseDouble();

    await handleV1Request('consultation', req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith('Idempotency-Replayed', 'true');
  });

  it('digests normalized material request data rather than superficial formatting', async () => {
    const service = {
      createAssessmentSubmission: jest.fn().mockResolvedValue({
        status: 201,
        body: { assessment: { id: 'nis2asm_01JTEST' }, idempotency: { replayed: false } },
      }),
    };

    await handleV1Request(
      'assessment',
      requestDouble(
        {
          answers: {
            ...answers,
            organizationType: ' PRIVATE_ENTERPRISE ',
            specialConditions: ['TLD_NAME_REGISTRY', 'DNS_SERVICE_PROVIDER'],
          },
          infrastructureNeeds: [' SCADA_OT ', 'NETWORK_SEGMENTATION_VLAN'],
          attribution: {},
        },
        service,
      ),
      responseDouble(),
    );
    await handleV1Request(
      'assessment',
      requestDouble(
        {
          answers: {
            ...answers,
            specialConditions: ['DNS_SERVICE_PROVIDER', 'TLD_NAME_REGISTRY'],
          },
          infrastructureNeeds: ['NETWORK_SEGMENTATION_VLAN', 'SCADA_OT'],
          attribution: {},
        },
        service,
      ),
      responseDouble(),
    );

    expect(service.createAssessmentSubmission.mock.calls[0][0].requestDigest).toBe(
      service.createAssessmentSubmission.mock.calls[1][0].requestDigest,
    );
  });

  it('returns a generic retryable 500 and logs no request PII for an unexpected failure', async () => {
    const logger = { info: jest.fn() };
    const service = {
      createLeadSubmission: jest.fn().mockRejectedValue(new Error('database error for person@example.bg')),
    };
    const body = {
      assessmentId: null,
      name: 'Private Person',
      companyName: 'Private Company',
      jobTitle: null,
      email: 'person@example.bg',
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
    const req = requestDouble(body, service, logger);
    const res = responseDouble();

    await handleV1Request('lead', req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const responseText = JSON.stringify(res.json.mock.calls[0][0]);
    const logText = JSON.stringify(logger.info.mock.calls);
    expect(responseText).toContain('INTERNAL_ERROR');
    expect(responseText).not.toContain('person@example.bg');
    expect(logText).not.toContain('person@example.bg');
    expect(logText).not.toContain('Private Person');
    expect(logText).not.toContain(KEY);
    const events = logger.info.mock.calls.map(([entry]) => JSON.parse(entry));
    const event = events.find(({ event: name }) => name === 'nis2_http_request_completed');
    expect(event).toEqual(
      expect.objectContaining({
        event: 'nis2_http_request_completed',
        environment: 'test',
        service: 'medusa',
      }),
    );
    expect(events.some(({ event: name }) => name === 'nis2_durable_write_completed')).toBe(false);
    expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
  });

  it('rejects a honeypot before calling the durable service', async () => {
    const service = { createAssessmentSubmission: jest.fn() };
    const req = requestDouble(
      { answers, infrastructureNeeds: [], attribution: {}, company_website: 'bot value' },
      service,
    );
    const res = responseDouble();

    await handleV1Request('assessment', req, res);

    expect(service.createAssessmentSubmission).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Моля, проверете отбелязаните полета.',
      retryable: false,
    });
  });

  it('does not let an operational logger failure replace a durable success response', async () => {
    const logger = {
      info: jest.fn(() => {
        throw new Error('telemetry unavailable');
      }),
    };
    const committed = {
      assessment: { id: 'nis2asm_01JTEST', persistedAt: '2026-09-04T00:00:00.000Z' },
      idempotency: { replayed: false },
    };
    const service = {
      createAssessmentSubmission: jest.fn().mockResolvedValue({ status: 201, body: committed }),
    };
    const res = responseDouble();

    await expect(
      handleV1Request(
        'assessment',
        requestDouble({ answers, infrastructureNeeds: [], attribution: {} }, service, logger),
        res,
      ),
    ).resolves.toBe(true);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(committed);
  });

  it('rejects an unversioned request instead of invoking the compatibility handler', async () => {
    const service = { createAssessmentSubmission: jest.fn() };
    const req = requestDouble({ answers, infrastructureNeeds: [] }, service);
    delete req.headers['x-nis2-contract-version'];
    const res = responseDouble();

    await expect(handleV1Request('assessment', req, res)).resolves.toBe(true);
    expect(res.status).toHaveBeenCalledWith(426);
    expect(res.json.mock.calls[0][0].error.code).toBe('UNSUPPORTED_CONTRACT_VERSION');
    expect(service.createAssessmentSubmission).not.toHaveBeenCalled();
  });
});
