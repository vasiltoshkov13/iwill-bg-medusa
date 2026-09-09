import { CONTRACT_VERSION, ContractError } from '../contract';
import { handleV1Request } from '../handler';

const KEY = '5d9cac03-85c8-44a9-a218-b427a42de85e';
const REQUEST_ID = '10000000-0000-4000-8000-000000000017';
const REPLAY_REQUEST_ID = '10000000-0000-4000-8000-000000000018';
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
      'x-request-id': REQUEST_ID,
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
    delete process.env.NIS2_RATE_LIMIT_ASSESSMENT_GLOBAL_MAX;
    delete process.env.NIS2_RATE_LIMIT_ASSESSMENT_NETWORK_MAX;
    delete process.env.NIS2_RATE_LIMIT_ASSESSMENT_KEY_MAX;
    global.fetch = originalFetch;
  });

  it('returns 201 only after the assessment service reports a committed row', async () => {
    const committed = {
      assessment: { id: 'nis2asm_01JTEST', persistedAt: '2026-09-04T00:00:00.000Z', rulesVersion: 'BG-NIS2-2026-09-v1' },
      result: { rulesVersion: 'BG-NIS2-2026-09-v1' },
      requestId: REQUEST_ID,
      idempotency: { replayed: false },
    };
    const service = {
      createAssessmentSubmission: jest.fn().mockImplementation(async (input) => ({
        status: 201,
        body: { ...committed, requestId: input.requestId },
        persistenceOutcome: 'committed',
      })),
    };
    const logger = { info: jest.fn() };
    const req = requestDouble({ answers, infrastructureNeeds: [], attribution: {} }, service, logger);
    const res = responseDouble();

    await expect(handleV1Request('assessment', req, res)).resolves.toBe(true);

    expect(service.createAssessmentSubmission).toHaveBeenCalledTimes(1);
    expect(service.createAssessmentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: REQUEST_ID }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(committed);
    expect(res.setHeader).toHaveBeenCalledWith('X-NIS2-Contract-Version', CONTRACT_VERSION);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', REQUEST_ID);
    expect(logger.info.mock.calls.map(([entry]) => JSON.parse(entry))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'nis2_durable_write_completed',
          request_id: REQUEST_ID,
          record_type: 'assessment',
          outcome: 'committed',
          replayed: false,
        }),
      ]),
    );
  });

  it('marks a duplicate committed request as a 200 replay', async () => {
    const service = {
      createConsultationSubmission: jest.fn().mockImplementation(async (input) => ({
        status: 200,
        body: {
          consultation: { id: 'nis2consult_01JTEST', leadId: 'nis2lead_01JTEST', persistedAt: '2026-09-04T00:00:00.000Z' },
          requestId: input.requestId,
          idempotency: { replayed: true },
          delivery: { ops: 'queued', internalNotification: 'queued' },
        },
        persistenceOutcome: 'none',
      })),
    };
    const req = requestDouble({ leadId: 'nis2lead_01JTEST', attribution: {} }, service);
    req.headers['x-request-id'] = REPLAY_REQUEST_ID;
    const res = responseDouble();

    await handleV1Request('consultation', req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].requestId).toBe(REPLAY_REQUEST_ID);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', REPLAY_REQUEST_ID);
    expect(res.setHeader).toHaveBeenCalledWith('Idempotency-Replayed', 'true');
  });

  it('uses only a read-only replay lookup when just the logical key ceiling is exceeded', async () => {
    process.env.NIS2_RATE_LIMIT_ASSESSMENT_KEY_MAX = '1';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: [1, 1, 2] }),
    });
    const createAssessmentSubmission = jest.fn();
    const replaySubmission = jest.fn().mockImplementation(async (_endpoint, input) => ({
      status: 200,
      body: {
        assessment: { id: 'nis2asm_01JTEST' },
        requestId: input.requestId,
        idempotency: { replayed: true },
      },
      persistenceOutcome: 'none',
    }));
    const service = { createAssessmentSubmission, replaySubmission };
    const res = responseDouble();

    await handleV1Request(
      'assessment',
      requestDouble({ answers, infrastructureNeeds: [], attribution: {} }, service),
      res,
    );

    expect(replaySubmission).toHaveBeenCalledWith('assessment', expect.objectContaining({
      idempotencyKey: KEY,
      requestId: REQUEST_ID,
      requestDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(createAssessmentSubmission).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith('Idempotency-Replayed', 'true');
  });

  it('returns 429 without a write when a key-only replay lookup finds no committed record', async () => {
    process.env.NIS2_RATE_LIMIT_ASSESSMENT_KEY_MAX = '1';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: [1, 1, 2] }),
    });
    const service = {
      createAssessmentSubmission: jest.fn(),
      replaySubmission: jest.fn().mockResolvedValue(null),
    };
    const res = responseDouble();

    await handleV1Request(
      'assessment',
      requestDouble({ answers, infrastructureNeeds: [], attribution: {} }, service),
      res,
    );

    expect(service.replaySubmission).toHaveBeenCalledTimes(1);
    expect(service.createAssessmentSubmission).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0]).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: 'RATE_LIMITED', retryable: true }),
      requestId: REQUEST_ID,
    }));
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
  });

  it('preserves a 409 material-change result from a key-only replay lookup', async () => {
    process.env.NIS2_RATE_LIMIT_ASSESSMENT_KEY_MAX = '1';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: [1, 1, 2] }),
    });
    const service = {
      createAssessmentSubmission: jest.fn(),
      replaySubmission: jest.fn().mockRejectedValue(
        new ContractError('IDEMPOTENCY_KEY_REUSED', 409, false),
      ),
    };
    const res = responseDouble();

    await handleV1Request(
      'assessment',
      requestDouble({ answers, infrastructureNeeds: [], attribution: {} }, service),
      res,
    );

    expect(service.createAssessmentSubmission).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0]).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED', retryable: false }),
      requestId: REQUEST_ID,
    }));
  });

  it.each([
    ['fleet', [2, 1, 2], 'NIS2_RATE_LIMIT_ASSESSMENT_GLOBAL_MAX'],
    ['peer-network', [1, 2, 2], 'NIS2_RATE_LIMIT_ASSESSMENT_NETWORK_MAX'],
  ] as const)('never reaches storage when the %s ceiling is exceeded', async (_scope, counts, limitName) => {
    process.env.NIS2_RATE_LIMIT_ASSESSMENT_KEY_MAX = '1';
    process.env[limitName] = '1';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: [...counts] }),
    });
    const service = {
      createAssessmentSubmission: jest.fn(),
      replaySubmission: jest.fn(),
    };
    const res = responseDouble();

    await handleV1Request(
      'assessment',
      requestDouble({ answers, infrastructureNeeds: [], attribution: {} }, service),
      res,
    );

    expect(service.replaySubmission).not.toHaveBeenCalled();
    expect(service.createAssessmentSubmission).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
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
      privacyNoticeVersion: 'nis2-privacy-2026-09-08-93ba2f3d8256',
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
      { answers, infrastructureNeeds: [], attribution: {}, company_website: ' \t\r\n ' },
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
    expect(res.json.mock.calls[0][0].requestId).toBe(REQUEST_ID);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', REQUEST_ID);
  });

  it('correlates a mapped 503 response with the supplied request id', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'synthetic limiter outage' }),
    });
    const service = { createAssessmentSubmission: jest.fn() };
    const res = responseDouble();

    await handleV1Request(
      'assessment',
      requestDouble({ answers, infrastructureNeeds: [], attribution: {} }, service),
      res,
    );

    expect(service.createAssessmentSubmission).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0]).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: 'PERSISTENCE_UNAVAILABLE', retryable: true }),
      requestId: REQUEST_ID,
    }));
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', REQUEST_ID);
  });

  it('replaces a malformed request id instead of reflecting or logging it', async () => {
    const malformed = 'person@example.bg\r\nX-Injected: private';
    const service = {
      createAssessmentSubmission: jest.fn().mockImplementation(async (input) => ({
        status: 201,
        body: {
          assessment: { id: 'nis2asm_01JTEST' },
          requestId: input.requestId,
          idempotency: { replayed: false },
        },
      })),
    };
    const logger = { info: jest.fn() };
    const req = requestDouble({ answers, infrastructureNeeds: [], attribution: {} }, service, logger);
    req.headers['x-request-id'] = malformed;
    const res = responseDouble();

    await handleV1Request('assessment', req, res);

    const bodyRequestId = res.json.mock.calls[0][0].requestId;
    const responseRequestId = res.setHeader.mock.calls.find(([name]) => name === 'X-Request-ID')?.[1];
    expect(bodyRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(responseRequestId).toBe(bodyRequestId);
    expect(service.createAssessmentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: bodyRequestId }),
    );
    expect(JSON.stringify(res.json.mock.calls)).not.toContain(malformed);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(malformed);
    expect(logger.info.mock.calls.map(([entry]) => JSON.parse(entry))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'nis2_http_request_completed',
          request_id: bodyRequestId,
          http_status: 201,
        }),
      ]),
    );
  });

  it('returns the complete privacy acknowledgement error contract', async () => {
    const service = { createLeadSubmission: jest.fn() };
    const req = requestDouble({
      assessmentId: null,
      name: 'Private Person',
      companyName: 'Private Company',
      jobTitle: null,
      email: 'person@example.bg',
      phone: null,
      preferredContact: 'EMAIL',
      privacyConsent: false,
      privacyNoticeVersion: 'nis2-privacy-2026-09-08-93ba2f3d8256',
      marketingConsent: false,
      marketingNoticeVersion: null,
      wantsConsultation: false,
      answers,
      infrastructureNeeds: [],
      attribution: {},
    }, service);
    const res = responseDouble();

    await handleV1Request('lead', req, res);

    expect(service.createLeadSubmission).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'CONSENT_REQUIRED',
        message: 'Необходимо е да удостоверите, че сте се запознали с известието за поверителност и поисканото обработване.',
        retryable: false,
        field: 'privacyConsent',
      },
      requestId: REQUEST_ID,
    });
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', REQUEST_ID);
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
