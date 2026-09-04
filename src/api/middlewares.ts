import { randomUUID } from 'node:crypto';
import {
  defineMiddlewares,
  errorHandler,
  type MedusaErrorHandlerFunction,
  type MedusaRequest,
  type MedusaResponse,
} from '@medusajs/framework/http';

import {
  CONTRACT_VERSION,
  ContractError,
  MAX_BODY_BYTES,
  publicError,
  type EndpointKind,
} from './store/nis2/contract';

const NIS2_ROUTE = /^\/store\/nis2\/(assessments|leads|consultations)$/;
const coreErrorHandler = errorHandler();

const v1BodyParserErrorHandler: MedusaErrorHandlerFunction = (error, req, res, next) => {
  const endpoint = endpointFor(req);
  const requestedVersion = firstHeader(req, 'x-nis2-contract-version');

  if (!endpoint || requestedVersion === undefined) {
    coreErrorHandler(error, req, res, next);
    return;
  }

  let contractError: ContractError | undefined;
  if (requestedVersion !== CONTRACT_VERSION) {
    contractError = new ContractError('UNSUPPORTED_CONTRACT_VERSION', 426, false);
  } else if (error?.type === 'entity.parse.failed') {
    contractError = new ContractError('INVALID_JSON', 400, false);
  } else if (error?.type === 'entity.too.large') {
    contractError = new ContractError('PAYLOAD_TOO_LARGE', 413, false);
  }

  if (!contractError) {
    coreErrorHandler(error, req, res, next);
    return;
  }

  const requestId = randomUUID();
  res.setHeader('X-NIS2-Contract-Version', CONTRACT_VERSION);
  res.status(contractError.status).json(publicError(contractError, requestId));
  logParserFailure(req, endpoint, requestId, contractError);
};

function endpointFor(req: MedusaRequest): EndpointKind | undefined {
  const match = req.path.match(NIS2_ROUTE);
  const plural = match?.[1];
  if (plural === 'assessments') return 'assessment';
  if (plural === 'leads') return 'lead';
  if (plural === 'consultations') return 'consultation';
  return undefined;
}

function firstHeader(req: MedusaRequest, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function logParserFailure(
  req: MedusaRequest,
  endpoint: EndpointKind,
  requestId: string,
  error: ContractError,
): void {
  try {
    const logger = req.scope?.resolve('logger') as { info(message: string): void } | undefined;
    logger?.info(
      JSON.stringify({
        event: 'nis2_http_request_completed',
        timestamp: new Date().toISOString(),
        request_id: requestId,
        contract_version: CONTRACT_VERSION,
        environment: process.env.NODE_ENV ?? 'development',
        service: 'medusa',
        endpoint,
        http_status: error.status,
        error_code: error.code,
        latency_ms: 0,
        replayed: false,
      }),
    );
  } catch {
    // Telemetry failure must not alter the public contract or expose request data.
  }
}

export default defineMiddlewares({
  errorHandler: v1BodyParserErrorHandler,
  routes: [
    '/store/nis2/assessments',
    '/store/nis2/leads',
    '/store/nis2/consultations',
  ].map((matcher) => ({
    matcher,
    methods: ['POST'] as const,
    bodyParser: { sizeLimit: MAX_BODY_BYTES },
  })),
});
