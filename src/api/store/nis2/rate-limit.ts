import { createHmac } from 'node:crypto';
import type { MedusaRequest } from '@medusajs/framework/http';

import type { EndpointKind } from './contract';

const DEFAULT_WINDOW_SECONDS = 10 * 60;
const MIN_SECRET_LENGTH = 32;
const LUA_FIXED_WINDOW = `
local ttl = tonumber(ARGV[1])
local counts = {}
for index, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then
    redis.call('EXPIRE', key, ttl)
  end
  counts[index] = count
end
return counts
`;

const DEFAULT_LIMITS: Record<EndpointKind, RateLimitPolicy> = {
  assessment: { network: 600, global: 5000, idempotencyKey: 12 },
  lead: { network: 300, global: 1200, idempotencyKey: 12 },
  consultation: { network: 300, global: 1200, idempotencyKey: 12 },
};

interface RateLimitPolicy {
  network: number;
  global: number;
  idempotencyKey: number;
}

interface RedisEvalResponse {
  result?: unknown;
  error?: unknown;
}

export type Nis2RateLimitResult =
  | { allowed: true; retryAfter: 0 }
  | { allowed: false; retryAfter: number; unavailable: false; replayOnly: boolean }
  | { allowed: false; retryAfter: 1; unavailable: true; replayOnly: false };

interface RateLimitOptions {
  fetchImpl?: typeof fetch;
  now?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Atomically consumes backend-wide, peer-network and logical-submission counters.
 *
 * Forwarded headers are intentionally ignored because direct origin callers can
 * forge them. Raw peer addresses and idempotency keys remain in-process; only
 * truncated HMAC bucket identifiers are sent to the shared Redis REST service.
 */
export async function consumeNis2RateLimit(
  req: MedusaRequest,
  endpoint: EndpointKind,
  options: RateLimitOptions = {},
): Promise<Nis2RateLimitResult> {
  const env = options.env ?? process.env;
  const config = readConfig(endpoint, env);
  if (!config) {
    if (env.NIS2_RATE_LIMIT_ALLOW_UNCONFIGURED === 'true') {
      return { allowed: true, retryAfter: 0 };
    }
    return unavailable();
  }

  const now = options.now ?? Date.now();
  const windowStart = Math.floor(now / (config.windowSeconds * 1000));
  const retryAfter = Math.max(
    1,
    Math.ceil(((windowStart + 1) * config.windowSeconds * 1000 - now) / 1000),
  );
  const peer = req.socket?.remoteAddress ?? 'unknown';
  const idempotencyKey = firstHeader(req, 'idempotency-key') ?? 'missing';
  const prefix = `nis2:rl:v1:medusa:${endpoint}:${windowStart}`;
  const keys = [
    `${prefix}:global`,
    `${prefix}:network:${digest(config.secret, `network:${peer}`)}`,
    `${prefix}:key:${digest(config.secret, `key:${idempotencyKey}`)}`,
  ];

  try {
    const response = await (options.fetchImpl ?? fetch)(config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        'EVAL',
        LUA_FIXED_WINDOW,
        String(keys.length),
        ...keys,
        String(config.windowSeconds + 5),
      ]),
      cache: 'no-store',
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok) return unavailable();

    const body = await response.json() as RedisEvalResponse;
    if (typeof body.error === 'string') return unavailable();
    const counts = parseCounts(body.result, keys.length);
    if (!counts) return unavailable();

    const [globalCount, networkCount, keyCount] = counts;
    if (globalCount > config.policy.global || networkCount > config.policy.network) {
      return { allowed: false, retryAfter, unavailable: false, replayOnly: false };
    }
    if (keyCount > config.policy.idempotencyKey) {
      return { allowed: false, retryAfter, unavailable: false, replayOnly: true };
    }
    return { allowed: true, retryAfter: 0 };
  } catch {
    return unavailable();
  }
}

function unavailable(): Nis2RateLimitResult {
  return { allowed: false, retryAfter: 1, unavailable: true, replayOnly: false };
}

function readConfig(endpoint: EndpointKind, env: NodeJS.ProcessEnv) {
  const urlValue = env.NIS2_RATE_LIMIT_REST_URL
    || env.KV_REST_API_URL
    || env.UPSTASH_REDIS_REST_URL;
  const token = env.NIS2_RATE_LIMIT_REST_TOKEN
    || env.KV_REST_API_TOKEN
    || env.UPSTASH_REDIS_REST_TOKEN;
  const secret = env.NIS2_RATE_LIMIT_HMAC_SECRET;
  if (!urlValue || !token || !secret || secret.length < MIN_SECRET_LENGTH) return null;

  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }
  const loopbackAllowed = env.NODE_ENV !== 'production'
    && env.NIS2_RATE_LIMIT_ALLOW_LOOPBACK === 'true'
    && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopbackAllowed) return null;

  const defaults = DEFAULT_LIMITS[endpoint];
  const stem = `NIS2_RATE_LIMIT_${endpoint.toUpperCase()}`;
  return {
    url: url.toString(),
    token,
    secret,
    windowSeconds: positiveInt(env.NIS2_RATE_LIMIT_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS),
    timeoutMs: positiveInt(env.NIS2_RATE_LIMIT_TIMEOUT_MS, 1500),
    policy: {
      network: positiveInt(env[`${stem}_NETWORK_MAX`], defaults.network),
      global: positiveInt(env[`${stem}_GLOBAL_MAX`], defaults.global),
      idempotencyKey: positiveInt(env[`${stem}_KEY_MAX`], defaults.idempotencyKey),
    },
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCounts(value: unknown, expected: number): number[] | null {
  if (!Array.isArray(value) || value.length !== expected) return null;
  const counts = value.map(Number);
  return counts.every((count) => Number.isSafeInteger(count) && count >= 1) ? counts : null;
}

function digest(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex').slice(0, 32);
}

function firstHeader(req: MedusaRequest, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
