import { randomUUID } from 'node:crypto';
import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';

import { NIS2_MODULE } from '../../../modules/nis2';
import type Nis2ModuleService from '../../../modules/nis2/service';
import { evaluateNis2 } from '../../../modules/nis2/rules/evaluate';
import {
  CONTRACT_VERSION,
  ContractError,
  canonicalDigest,
  parseV1Request,
  publicError,
  type EndpointKind,
} from './contract';
import {
  loadCampaignAllowlist,
  parseAssessmentBody,
  parseConsultationBody,
  parseLeadBody,
  qualificationFor,
} from './validation';
import { consumeNis2RateLimit } from './rate-limit';

interface SafeLogger {
  info(message: string): void;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function handleV1Request(
  endpoint: EndpointKind,
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<boolean> {
  const startedAt = Date.now();
  const requestId = requestIdFor(req.headers);
  res.setHeader('X-NIS2-Contract-Version', CONTRACT_VERSION);
  res.setHeader('X-Request-ID', requestId);

  let status = 500;
  let errorCode: string | null = null;
  let replayed = false;

  try {
    const common = parseV1Request(req.headers, req.body);
    const rateLimit = await consumeNis2RateLimit(req, endpoint);
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfter));
      throw new ContractError(
        rateLimit.unavailable ? 'PERSISTENCE_UNAVAILABLE' : 'RATE_LIMITED',
        rateLimit.unavailable ? 503 : 429,
        true,
      );
    }
    const secret = idempotencySecret();
    const allowlist = loadCampaignAllowlist();
    const service: Nis2ModuleService = req.scope.resolve(NIS2_MODULE);

    let result;
    switch (endpoint) {
      case 'assessment': {
        const assessment = parseAssessmentBody(req.body, allowlist);
        const evaluation = evaluateNis2(assessment.answers);
        result = await service.createAssessmentSubmission({
          ...common,
          requestDigest: canonicalDigest(materialSubmission(assessment), secret),
          requestId,
          assessment,
          result: evaluation,
          answersDigest: canonicalDigest(
            { answers: materialAnswers(assessment.answers), rulesVersion: evaluation.rulesVersion },
            secret,
          ),
        });
        break;
      }
      case 'lead': {
        const lead = parseLeadBody(req.body, allowlist);
        const evaluation = evaluateNis2(lead.answers);
        result = await service.createLeadSubmission({
          ...common,
          requestDigest: canonicalDigest(materialSubmission(lead), secret),
          requestId,
          lead,
          result: evaluation,
          answersDigest: canonicalDigest(
            { answers: materialAnswers(lead.answers), rulesVersion: evaluation.rulesVersion },
            secret,
          ),
          qualification: qualificationFor(evaluation.scopeResult, lead.infrastructureNeeds),
        });
        break;
      }
      case 'consultation': {
        const consultation = parseConsultationBody(req.body, allowlist);
        result = await service.createConsultationSubmission({
          ...common,
          requestDigest: canonicalDigest(consultation, secret),
          requestId,
          consultation,
        });
        break;
      }
    }

    status = result.status;
    replayed = result.status === 200;
    if (result.persistenceOutcome && result.persistenceOutcome !== 'none') {
      logDurableWrite(req, endpoint, requestId, result.persistenceOutcome, replayed);
    }
    if (replayed) res.setHeader('Idempotency-Replayed', 'true');
    res.status(result.status).json(result.body);
  } catch (error) {
    const contractError =
      error instanceof ContractError
        ? error
        : new ContractError('INTERNAL_ERROR', 500, true);
    status = contractError.status;
    errorCode = contractError.code;
    const persistenceOutcome = (error as { persistenceOutcome?: 'rolled_back' })?.persistenceOutcome;
    if (persistenceOutcome) {
      logDurableWrite(req, endpoint, requestId, persistenceOutcome, false);
    }
    res.status(contractError.status).json(publicError(contractError, requestId));
  } finally {
    logCompletion(req, {
      endpoint,
      requestId,
      status,
      errorCode,
      replayed,
      latencyMs: Date.now() - startedAt,
    });
  }

  return true;
}

function requestIdFor(headers: MedusaRequest['headers']): string {
  const supplied = headers['x-request-id'];
  return typeof supplied === 'string' && UUID_V4.test(supplied) ? supplied : randomUUID();
}

function idempotencySecret(): string {
  const secret = process.env.NIS2_IDEMPOTENCY_SECRET;
  if (!secret || secret.length < 32) {
    throw new ContractError('PERSISTENCE_UNAVAILABLE', 503, true);
  }
  return secret;
}

function materialAnswers<T extends { specialConditions: readonly string[] }>(answers: T) {
  return {
    ...answers,
    specialConditions: [...answers.specialConditions].sort(),
  };
}

function materialSubmission<
  T extends {
    answers: { specialConditions: readonly string[] };
    infrastructureNeeds: readonly string[];
  },
>(submission: T) {
  return {
    ...submission,
    answers: materialAnswers(submission.answers),
    infrastructureNeeds: [...submission.infrastructureNeeds].sort(),
  };
}

function logCompletion(
  req: MedusaRequest,
  event: {
    endpoint: EndpointKind;
    requestId: string;
    status: number;
    errorCode: string | null;
    replayed: boolean;
    latencyMs: number;
  },
): void {
  safeLog(req, {
    event: 'nis2_http_request_completed',
    timestamp: new Date().toISOString(),
    request_id: event.requestId,
    contract_version: CONTRACT_VERSION,
    environment: process.env.NODE_ENV ?? 'development',
    service: 'medusa',
    endpoint: event.endpoint,
    http_status: event.status,
    error_code: event.errorCode,
    latency_ms: event.latencyMs,
    replayed: event.replayed,
  });
}

function logDurableWrite(
  req: MedusaRequest,
  endpoint: EndpointKind,
  requestId: string,
  outcome: 'committed' | 'rolled_back',
  replayed: boolean,
): void {
  safeLog(req, {
    event: 'nis2_durable_write_completed',
    timestamp: new Date().toISOString(),
    request_id: requestId,
    contract_version: CONTRACT_VERSION,
    environment: process.env.NODE_ENV ?? 'development',
    service: 'medusa',
    record_type: endpoint,
    outcome,
    replayed,
  });
}

function safeLog(req: MedusaRequest, event: Record<string, unknown>): void {
  try {
    const logger = req.scope.resolve('logger') as SafeLogger;
    logger.info(JSON.stringify(event));
  } catch {
    // Telemetry must never turn an already durable submission into a client-visible failure.
  }
}
