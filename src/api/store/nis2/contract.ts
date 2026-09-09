import { createHmac, timingSafeEqual } from 'node:crypto';

export const CONTRACT_VERSION = '1.0.0';
export const MAX_BODY_BYTES = 16 * 1024;

export type EndpointKind = 'assessment' | 'lead' | 'consultation';
export type PublicErrorCode =
  | 'MISSING_IDEMPOTENCY_KEY'
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'INVALID_JSON'
  | 'VALIDATION_FAILED'
  | 'CONSENT_REQUIRED'
  | 'ASSESSMENT_NOT_FOUND'
  | 'LEAD_NOT_FOUND'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'ASSESSMENT_MISMATCH'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RULES_VERSION_MISMATCH'
  | 'UNSUPPORTED_CONTRACT_VERSION'
  | 'RATE_LIMITED'
  | 'PERSISTENCE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ERROR_MESSAGES: Record<PublicErrorCode, string> = {
  MISSING_IDEMPOTENCY_KEY: 'Липсва ключ за безопасно повторение на заявката.',
  INVALID_IDEMPOTENCY_KEY: 'Невалиден ключ за безопасно повторение на заявката.',
  INVALID_JSON: 'Заявката не съдържа валиден JSON.',
  VALIDATION_FAILED: 'Моля, проверете отбелязаните полета.',
  CONSENT_REQUIRED: 'Необходимо е да удостоверите, че сте се запознали с известието за поверителност и поисканото обработване.',
  ASSESSMENT_NOT_FOUND: 'Оценката не е намерена.',
  LEAD_NOT_FOUND: 'Запитването не е намерено.',
  IDEMPOTENCY_KEY_REUSED: 'Заявката не може да бъде повторена с променени данни.',
  ASSESSMENT_MISMATCH: 'Оценката не съответства на предоставените данни.',
  PAYLOAD_TOO_LARGE: 'Заявката е твърде голяма.',
  UNSUPPORTED_MEDIA_TYPE: 'Заявката трябва да бъде JSON.',
  RULES_VERSION_MISMATCH: 'Оценката временно не може да бъде записана. Опитайте отново.',
  UNSUPPORTED_CONTRACT_VERSION: 'Версията на заявката не се поддържа.',
  RATE_LIMITED: 'Твърде много заявки. Опитайте отново по-късно.',
  PERSISTENCE_UNAVAILABLE: 'Не успяхме да запишем заявката. Опитайте отново.',
  INTERNAL_ERROR: 'Възникна временна грешка. Опитайте отново.',
};

export class ContractError extends Error {
  constructor(
    readonly code: PublicErrorCode,
    readonly status: number,
    readonly retryable: boolean,
    readonly field?: string,
  ) {
    super(code);
    this.name = 'ContractError';
  }
}

type Headers = Record<string, string | string[] | undefined>;

function header(headers: Headers, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function parseV1Request(headers: Headers, body: unknown) {
  const version = header(headers, 'x-nis2-contract-version');
  if (version !== CONTRACT_VERSION) {
    throw new ContractError('UNSUPPORTED_CONTRACT_VERSION', 426, false);
  }

  const contentType = header(headers, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new ContractError('UNSUPPORTED_MEDIA_TYPE', 415, false);
  }

  const idempotencyKey = header(headers, 'idempotency-key');
  if (!idempotencyKey) {
    throw new ContractError('MISSING_IDEMPOTENCY_KEY', 400, false);
  }
  if (!UUID_V4.test(idempotencyKey)) {
    throw new ContractError('INVALID_IDEMPOTENCY_KEY', 400, false);
  }

  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) {
    throw new ContractError('PAYLOAD_TOO_LARGE', 413, false);
  }

  return { idempotencyKey, contractVersion: CONTRACT_VERSION } as const;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalDigest(value: unknown, secret: string): string {
  return createHmac('sha256', secret).update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function digestsEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function publicError(error: ContractError, requestId: string) {
  return {
    error: {
      code: error.code,
      message: ERROR_MESSAGES[error.code],
      retryable: error.retryable,
      ...(error.field ? { field: error.field } : {}),
    },
    requestId,
  };
}
