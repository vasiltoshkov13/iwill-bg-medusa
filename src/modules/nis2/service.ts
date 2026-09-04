import type { Context } from '@medusajs/framework/types';
import {
  InjectTransactionManager,
  MedusaContext,
  MedusaService,
} from '@medusajs/framework/utils';

import { ContractError, type EndpointKind } from '../../api/store/nis2/contract';
import type {
  ParsedAssessment,
  ParsedConsultation,
  ParsedLead,
} from '../../api/store/nis2/validation';
import type { Nis2Result } from './rules/types';
import {
  isUniqueViolation,
  outboxIntentsFor,
  resolveExistingIdempotency,
} from './durability';
import {
  NisAssessment,
  NisConsultation,
  NisIdempotency,
  NisLead,
  NisOutbox,
} from './models';

interface SubmissionBase {
  idempotencyKey: string;
  requestDigest: string;
  requestId: string;
}

export interface AssessmentSubmission extends SubmissionBase {
  assessment: ParsedAssessment;
  answersDigest: string;
  result: Nis2Result;
}

export interface LeadSubmission extends SubmissionBase {
  lead: ParsedLead;
  answersDigest: string;
  result: Nis2Result;
  qualification: 'qualified' | 'review_required' | 'unqualified';
}

export interface ConsultationSubmission extends SubmissionBase {
  consultation: ParsedConsultation;
}

export interface DurableResponse {
  status: 200 | 201;
  body: Record<string, any>;
  persistenceOutcome?: 'none' | 'committed' | 'rolled_back';
}

type ContractErrorWithOutcome = ContractError & {
  persistenceOutcome?: 'rolled_back';
};

function rolledBack(error: ContractError): ContractErrorWithOutcome {
  const marked = error as ContractErrorWithOutcome;
  marked.persistenceOutcome = 'rolled_back';
  return marked;
}

/**
 * NIS2 writes whose first-success transaction contains the domain row,
 * idempotency result, and every required outbox intent.
 */
class Nis2ModuleService extends MedusaService({
  NisAssessment,
  NisConsultation,
  NisIdempotency,
  NisLead,
  NisOutbox,
}) {
  async createAssessmentSubmission(input: AssessmentSubmission): Promise<DurableResponse> {
    return this.executeIdempotent('assessment', input, () => this.createAssessmentTransaction_(input));
  }

  async createLeadSubmission(input: LeadSubmission): Promise<DurableResponse> {
    return this.executeIdempotent('lead', input, () => this.createLeadTransaction_(input));
  }

  async createConsultationSubmission(input: ConsultationSubmission): Promise<DurableResponse> {
    return this.executeIdempotent('consultation', input, () => this.createConsultationTransaction_(input));
  }

  private async executeIdempotent(
    endpointKind: EndpointKind,
    input: SubmissionBase,
    create: () => Promise<DurableResponse>,
  ): Promise<DurableResponse> {
    let existing;
    try {
      existing = await this.findIdempotency(endpointKind, input.idempotencyKey);
    } catch (error) {
      if (error instanceof ContractError) throw error;
      // The initial lookup happens before a write transaction exists.
      throw new ContractError('PERSISTENCE_UNAVAILABLE', 503, true);
    }

    if (existing) {
      return {
        status: 200,
        body: resolveExistingIdempotency(existing, input.requestDigest, input.requestId),
        persistenceOutcome: 'none',
      };
    }

    try {
      const created = await create();
      // The transaction decorator has committed before the awaited call resolves.
      return { ...created, persistenceOutcome: 'committed' };
    } catch (error) {
      if (isUniqueViolation(error)) {
        try {
          const concurrent = await this.findIdempotency(endpointKind, input.idempotencyKey);
          if (concurrent) {
            return {
              status: 200,
              body: resolveExistingIdempotency(concurrent, input.requestDigest, input.requestId),
              persistenceOutcome: 'rolled_back',
            };
          }
        } catch (recoveryError) {
          if (recoveryError instanceof ContractError) throw rolledBack(recoveryError);
          throw rolledBack(new ContractError('PERSISTENCE_UNAVAILABLE', 503, true));
        }
      }
      if (error instanceof ContractError) throw rolledBack(error);
      throw rolledBack(new ContractError('PERSISTENCE_UNAVAILABLE', 503, true));
    }
  }

  private async findIdempotency(endpointKind: EndpointKind, idempotencyKey: string) {
    const records = await this.listNisIdempotencies(
      { endpoint_kind: endpointKind, idempotency_key: idempotencyKey },
      { take: 1 },
    );
    return records[0] as
      | { request_digest: string; response_body: Record<string, unknown> }
      | undefined;
  }

  @InjectTransactionManager()
  async createAssessmentTransaction_(
    input: AssessmentSubmission,
    @MedusaContext() sharedContext: Context = {},
  ): Promise<DurableResponse> {
    const { assessment: parsed, result } = input;
    const assessment = await this.createNisAssessments(
      {
        rules_version: result.rulesVersion,
        answer_digest: input.answersDigest,
        organization_type: parsed.answers.organizationType,
        sector: parsed.answers.sector,
        subsector: parsed.answers.subsector ?? null,
        employees_bucket: parsed.answers.employees,
        turnover_bucket: parsed.answers.turnover,
        assets_bucket: parsed.answers.assets,
        group_status: parsed.answers.groupStatus,
        special_conditions: parsed.answers.specialConditions,
        scope_result: result.scopeResult,
        entity_category: result.entityCategory,
        confidence: result.confidence,
        enterprise_size: result.enterpriseSize,
        annex_class: result.annexClass,
        reason_codes: result.reasonCodes,
        requires_manual_review: result.requiresManualReview,
        infrastructure_needs: parsed.infrastructureNeeds,
        ...parsed.attribution,
      },
      sharedContext,
    );

    const body = {
      assessment: {
        id: assessment.id,
        persistedAt: isoDate(assessment.created_at),
        rulesVersion: result.rulesVersion,
      },
      result,
      requestId: input.requestId,
      idempotency: { replayed: false },
    };

    await this.createIdempotency('assessment', input, assessment.id, body, sharedContext);
    return { status: 201, body };
  }

  @InjectTransactionManager()
  async createLeadTransaction_(
    input: LeadSubmission,
    @MedusaContext() sharedContext: Context = {},
  ): Promise<DurableResponse> {
    const { lead: parsed, result } = input;
    if (parsed.assessment_id) {
      const assessments = await this.listNisAssessments(
        { id: parsed.assessment_id },
        { take: 1 },
        sharedContext,
      );
      const assessment = assessments[0];
      if (!assessment) throw new ContractError('ASSESSMENT_NOT_FOUND', 404, false);
      if (
        assessment.answer_digest !== input.answersDigest ||
        assessment.rules_version !== result.rulesVersion
      ) {
        throw new ContractError('ASSESSMENT_MISMATCH', 409, false);
      }
    }

    const now = new Date();
    const lead = await this.createNisLeads(
      {
        assessment_id: parsed.assessment_id,
        name: parsed.name,
        company_name: parsed.company_name,
        job_title: parsed.job_title,
        email: parsed.email,
        phone: parsed.phone,
        preferred_contact: parsed.preferred_contact,
        privacy_consent: parsed.privacy_consent,
        privacy_notice_version: parsed.privacy_notice_version,
        consented_at: now,
        wants_consultation: parsed.wants_consultation,
        marketing_consent: parsed.marketing_consent,
        marketing_notice_version: parsed.marketing_notice_version,
        qualification: input.qualification,
        lead_status: 'NEW',
        rules_version: result.rulesVersion,
        answer_digest: input.answersDigest,
        scope_result: result.scopeResult,
        entity_category: result.entityCategory,
        confidence: result.confidence,
        enterprise_size: result.enterpriseSize,
        annex_class: result.annexClass,
        reason_codes: result.reasonCodes,
        result_snapshot: result as unknown as Record<string, unknown>,
        requires_manual_review: result.requiresManualReview,
        infrastructure_needs: parsed.infrastructureNeeds,
        ...parsed.attribution,
      },
      sharedContext,
    );

    const body = {
      lead: {
        id: lead.id,
        persistedAt: isoDate(lead.created_at),
        qualification: input.qualification,
      },
      requestId: input.requestId,
      idempotency: { replayed: false },
      delivery: { summary: 'queued', ops: 'queued', internalNotification: 'queued' },
    };

    await this.createOutbox('lead', lead.id, input.requestId, sharedContext);
    await this.createIdempotency('lead', input, lead.id, body, sharedContext);
    return { status: 201, body };
  }

  @InjectTransactionManager()
  async createConsultationTransaction_(
    input: ConsultationSubmission,
    @MedusaContext() sharedContext: Context = {},
  ): Promise<DurableResponse> {
    const leads = await this.listNisLeads(
      { id: input.consultation.lead_id },
      { take: 1 },
      sharedContext,
    );
    if (!leads[0]) throw new ContractError('LEAD_NOT_FOUND', 404, false);

    const consultation = await this.createNisConsultations(
      {
        lead_id: input.consultation.lead_id,
        ...input.consultation.attribution,
      },
      sharedContext,
    );
    const body = {
      consultation: {
        id: consultation.id,
        leadId: input.consultation.lead_id,
        persistedAt: isoDate(consultation.created_at),
      },
      requestId: input.requestId,
      idempotency: { replayed: false },
      delivery: { ops: 'queued', internalNotification: 'queued' },
    };

    await this.createOutbox('consultation', consultation.id, input.requestId, sharedContext);
    await this.createIdempotency('consultation', input, consultation.id, body, sharedContext);
    return { status: 201, body };
  }

  private async createOutbox(
    domainKind: 'lead' | 'consultation',
    domainId: string,
    requestId: string,
    sharedContext: Context,
  ): Promise<void> {
    const nextAttemptAt = new Date();
    const intents = outboxIntentsFor(domainKind).map((intentType) => ({
      request_id: requestId,
      domain_kind: domainKind,
      domain_id: domainId,
      intent_type: intentType,
      state: 'pending' as const,
      attempt_count: 0,
      next_attempt_at: nextAttemptAt,
      last_error_class: null,
      payload: { domainKind, domainId },
    }));
    await this.createNisOutboxes(intents, sharedContext);
  }

  private async createIdempotency(
    endpointKind: EndpointKind,
    input: SubmissionBase,
    domainId: string,
    body: Record<string, unknown>,
    sharedContext: Context,
  ): Promise<void> {
    await this.createNisIdempotencies(
      {
        endpoint_kind: endpointKind,
        idempotency_key: input.idempotencyKey,
        request_digest: input.requestDigest,
        response_status: 201,
        response_body: body,
        domain_id: domainId,
      },
      sharedContext,
    );
  }
}

function isoDate(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  // Medusa's create service can return before generated timestamp fields are hydrated.
  return new Date().toISOString();
}

export default Nis2ModuleService;
