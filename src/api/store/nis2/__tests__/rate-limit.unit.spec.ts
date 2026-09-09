import { consumeNis2RateLimit } from '../rate-limit';

const KEY = '5d9cac03-85c8-44a9-a218-b427a42de85e';
const PEER = '198.51.100.24';

function requestDouble() {
  return {
    headers: { 'idempotency-key': KEY },
    socket: { remoteAddress: PEER },
  } as any;
}

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    NIS2_RATE_LIMIT_REST_URL: 'https://rate-limit.example.invalid',
    NIS2_RATE_LIMIT_REST_TOKEN: 'synthetic-unit-token',
    NIS2_RATE_LIMIT_HMAC_SECRET: 'unit-limiter-secret-with-at-least-32-characters',
    NIS2_RATE_LIMIT_ASSESSMENT_GLOBAL_MAX: '10',
    NIS2_RATE_LIMIT_ASSESSMENT_NETWORK_MAX: '10',
    NIS2_RATE_LIMIT_ASSESSMENT_KEY_MAX: '1',
    ...overrides,
  };
}

function fetchReturning(counts: number[]) {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ result: counts }),
  });
}

describe('NIS2 shared rate-limit decisions', () => {
  it('marks a denial replay-only when just the logical key ceiling is exceeded', async () => {
    const fetchImpl = fetchReturning([1, 1, 2]);

    await expect(consumeNis2RateLimit(requestDouble(), 'assessment', {
      env: environment(),
      fetchImpl,
      now: 1,
    })).resolves.toEqual({
      allowed: false,
      retryAfter: 600,
      unavailable: false,
      replayOnly: true,
    });

    const limiterPayload = JSON.stringify(JSON.parse(fetchImpl.mock.calls[0][1].body));
    expect(limiterPayload).not.toContain(KEY);
    expect(limiterPayload).not.toContain(PEER);
  });

  it.each([
    ['fleet', [2, 1, 2], { NIS2_RATE_LIMIT_ASSESSMENT_GLOBAL_MAX: '1' }],
    ['peer-network', [1, 2, 2], { NIS2_RATE_LIMIT_ASSESSMENT_NETWORK_MAX: '1' }],
  ] as const)(
    'does not permit a storage replay check when the %s ceiling is exceeded',
    async (_scope, counts, overrides) => {
      await expect(consumeNis2RateLimit(requestDouble(), 'assessment', {
        env: environment(overrides),
        fetchImpl: fetchReturning([...counts]),
        now: 1,
      })).resolves.toEqual({
        allowed: false,
        retryAfter: 600,
        unavailable: false,
        replayOnly: false,
      });
    },
  );
});
