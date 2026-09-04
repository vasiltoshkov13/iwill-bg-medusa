import { ContractError } from '../../../api/store/nis2/contract';
import {
  OutboxIntentType,
  backoffForAttempt,
  isUniqueViolation,
  outboxIntentsFor,
  replayResponse,
  resolveExistingIdempotency,
} from '../durability';

const STORED_RESPONSE = {
  lead: {
    id: 'nis2lead_01JTEST',
    persistedAt: '2026-09-04T00:00:00.000Z',
    qualification: 'qualified',
  },
  requestId: 'old-request',
  idempotency: { replayed: false },
  delivery: { summary: 'queued', ops: 'queued', internalNotification: 'queued' },
};
const DIGEST = 'a'.repeat(64);

describe('NIS2-CAMPAIGN-CONTRACT 1.0.0 durability primitives', () => {
  it('replays the committed result with original domain ids and the current request id', () => {
    expect(replayResponse(STORED_RESPONSE, 'new-request')).toEqual({
      ...STORED_RESPONSE,
      requestId: 'new-request',
      idempotency: { replayed: true },
    });
    expect(STORED_RESPONSE.idempotency.replayed).toBe(false);
  });

  it('returns the replay only when the endpoint/key digest matches', () => {
    expect(
      resolveExistingIdempotency(
        { request_digest: DIGEST, response_body: STORED_RESPONSE },
        DIGEST,
        'new-request',
      ),
    ).toEqual(expect.objectContaining({ idempotency: { replayed: true } }));

    expect(() =>
      resolveExistingIdempotency(
        { request_digest: DIGEST, response_body: STORED_RESPONSE },
        'b'.repeat(64),
        'new-request',
      ),
    ).toThrow(expect.objectContaining<Partial<ContractError>>({ code: 'IDEMPOTENCY_KEY_REUSED', status: 409 }));
  });

  it.each([
    ['assessment', []],
    ['lead', ['ops_lead', 'visitor_summary', 'internal_lead']],
    ['consultation', ['ops_consultation', 'internal_consultation']],
  ] as Array<[string, OutboxIntentType[]]>)('creates only the required %s outbox intents', (kind, expected) => {
    expect(outboxIntentsFor(kind as 'assessment' | 'lead' | 'consultation')).toEqual(expected);
  });

  it('uses capped exponential retry delays without storing provider text', () => {
    expect(backoffForAttempt(1)).toBe(60_000);
    expect(backoffForAttempt(2)).toBe(120_000);
    expect(backoffForAttempt(10)).toBe(3_600_000);
  });

  it('recognizes both PostgreSQL and Medusa-mapped idempotency uniqueness failures', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true);
    expect(isUniqueViolation({
      __isMedusaError: true,
      type: 'invalid_data',
      message: 'Nis2 idempotency with endpoint_kind: assessment, idempotency_key: key, already exists.',
    })).toBe(true);
    expect(isUniqueViolation({ __isMedusaError: true, type: 'invalid_data', message: 'Other input is invalid.' })).toBe(false);
  });
});
