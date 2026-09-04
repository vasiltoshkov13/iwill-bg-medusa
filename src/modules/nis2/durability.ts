import type { EndpointKind } from '../../api/store/nis2/contract';
import { ContractError, digestsEqual } from '../../api/store/nis2/contract';

export type OutboxIntentType =
  | 'ops_lead'
  | 'visitor_summary'
  | 'internal_lead'
  | 'ops_consultation'
  | 'internal_consultation';

export type OutboxState = 'pending' | 'processing' | 'delivered' | 'dead_letter';
export type OutboxErrorClass =
  | 'timeout'
  | 'rate_limited'
  | 'authentication'
  | 'provider_4xx'
  | 'provider_5xx'
  | 'network'
  | 'unknown';

export interface StoredIdempotency {
  request_digest: string;
  response_body: Record<string, unknown>;
}

export function replayResponse(
  response: Record<string, any>,
  requestId: string,
): Record<string, any> {
  return {
    ...response,
    requestId,
    idempotency: { replayed: true },
  };
}

export function resolveExistingIdempotency(
  existing: StoredIdempotency,
  requestDigest: string,
  requestId: string,
): Record<string, any> {
  if (!digestsEqual(existing.request_digest, requestDigest)) {
    throw new ContractError('IDEMPOTENCY_KEY_REUSED', 409, false);
  }
  return replayResponse(existing.response_body, requestId);
}

export function outboxIntentsFor(kind: EndpointKind): OutboxIntentType[] {
  switch (kind) {
    case 'assessment':
      return [];
    case 'lead':
      return ['ops_lead', 'visitor_summary', 'internal_lead'];
    case 'consultation':
      return ['ops_consultation', 'internal_consultation'];
  }
}

export function backoffForAttempt(attempt: number): number {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(60_000 * 2 ** (normalizedAttempt - 1), 3_600_000);
}

export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === 'object' && current !== null) {
      const candidate = current as {
        __isMedusaError?: unknown;
        type?: unknown;
        message?: unknown;
        code?: unknown;
        cause?: unknown;
        originalError?: unknown;
      };
      if (candidate.code === '23505') return true;
      if (
        candidate.__isMedusaError === true &&
        candidate.type === 'invalid_data' &&
        typeof candidate.message === 'string' &&
        /^Nis2 idempotency\b.*\balready exists\.$/.test(candidate.message)
      ) {
        return true;
      }
      current = candidate.cause ?? candidate.originalError;
    } else {
      break;
    }
  }
  return false;
}
