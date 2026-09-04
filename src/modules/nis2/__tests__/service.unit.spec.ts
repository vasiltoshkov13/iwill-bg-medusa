import { ContractError } from '../../../api/store/nis2/contract';
import Nis2ModuleService from '../service';

const DIGEST = 'a'.repeat(64);

const committed = {
  lead: {
    id: 'nis2lead_01JTEST',
    persistedAt: '2026-09-04T00:00:00.000Z',
    qualification: 'qualified',
  },
  requestId: 'first-request',
  idempotency: { replayed: false },
  delivery: { summary: 'queued', ops: 'queued', internalNotification: 'queued' },
};

function serviceDouble(): any {
  return Object.create(Nis2ModuleService.prototype);
}

describe('NIS2 durable service idempotency boundary', () => {
  it('returns a replay before attempting another transaction', async () => {
    const service = serviceDouble();
    service.listNisIdempotencies = jest.fn().mockResolvedValue([
      { request_digest: DIGEST, response_body: committed },
    ]);
    service.createLeadTransaction_ = jest.fn();

    const result = await service.createLeadSubmission({
      idempotencyKey: '5d9cac03-85c8-44a9-a218-b427a42de85e',
      requestDigest: DIGEST,
      requestId: 'retry-request',
      lead: {} as never,
      answersDigest: 'answers',
      result: {} as never,
      qualification: 'qualified',
    });

    expect(result).toEqual({
      status: 200,
      body: expect.objectContaining({ requestId: 'retry-request', idempotency: { replayed: true } }),
      persistenceOutcome: 'none',
    });
    expect(service.createLeadTransaction_).not.toHaveBeenCalled();
  });

  it('recovers a concurrent unique-key race as a replay', async () => {
    const service = serviceDouble();
    service.listNisIdempotencies = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ request_digest: DIGEST, response_body: committed }]);
    const uniqueError = Object.assign(new Error('duplicate'), { code: '23505' });
    service.createLeadTransaction_ = jest.fn().mockRejectedValue(uniqueError);

    const result = await service.createLeadSubmission({
      idempotencyKey: '5d9cac03-85c8-44a9-a218-b427a42de85e',
      requestDigest: DIGEST,
      requestId: 'concurrent-request',
      lead: {} as never,
      answersDigest: 'answers',
      result: {} as never,
      qualification: 'qualified',
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual(expect.objectContaining({ idempotency: { replayed: true } }));
    expect(result.persistenceOutcome).toBe('rolled_back');
  });

  it('marks a resolved first write as committed after the transaction wrapper returns', async () => {
    const service = serviceDouble();
    service.listNisIdempotencies = jest.fn().mockResolvedValue([]);
    service.createLeadTransaction_ = jest.fn().mockResolvedValue({ status: 201, body: committed });

    const result = await service.createLeadSubmission({
      idempotencyKey: '5d9cac03-85c8-44a9-a218-b427a42de85e',
      requestDigest: DIGEST,
      requestId: 'first-request',
      lead: {} as never,
      answersDigest: 'answers',
      result: {} as never,
      qualification: 'qualified',
    });

    expect(result.persistenceOutcome).toBe('committed');
  });

  it('turns an uncommitted database failure into a retryable persistence error', async () => {
    const service = serviceDouble();
    service.listNisIdempotencies = jest.fn().mockResolvedValue([]);
    service.createLeadTransaction_ = jest.fn().mockRejectedValue(new Error('database contained private row data'));

    await expect(
      service.createLeadSubmission({
        idempotencyKey: '5d9cac03-85c8-44a9-a218-b427a42de85e',
        requestDigest: DIGEST,
        requestId: 'failed-request',
        lead: {} as never,
        answersDigest: 'answers',
        result: {} as never,
        qualification: 'qualified',
      }),
    ).rejects.toEqual(expect.objectContaining<Partial<ContractError> & { persistenceOutcome: string }>({
      code: 'PERSISTENCE_UNAVAILABLE',
      status: 503,
      retryable: true,
      persistenceOutcome: 'rolled_back',
    }));
  });

  it('turns an initial idempotency lookup failure into a retryable persistence error', async () => {
    const service = serviceDouble();
    service.listNisIdempotencies = jest.fn().mockRejectedValue(new Error('database unavailable'));
    service.createLeadTransaction_ = jest.fn();

    await expect(
      service.createLeadSubmission({
        idempotencyKey: '5d9cac03-85c8-44a9-a218-b427a42de85e',
        requestDigest: DIGEST,
        requestId: 'failed-lookup',
        lead: {} as never,
        answersDigest: 'answers',
        result: {} as never,
        qualification: 'qualified',
      }),
    ).rejects.toEqual(expect.objectContaining<Partial<ContractError>>({
      code: 'PERSISTENCE_UNAVAILABLE',
      status: 503,
      retryable: true,
    }));
    expect(service.createLeadTransaction_).not.toHaveBeenCalled();
  });
});
