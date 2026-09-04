import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';

import { NIS2_MODULE } from '../../../../modules/nis2';
import type Nis2ModuleService from '../../../../modules/nis2/service';
import { evaluateNis2 } from '../../../../modules/nis2/rules/evaluate';
import { ContractError } from '../contract';
import { handleV1Request } from '../handler';
import {
  ValidationError,
  parseLegacyAnswers,
  parseLegacyAttribution,
  parseLegacyInfrastructureNeeds,
} from '../validation';

/**
 * Store a preliminary NIS2 assessment.
 *
 * The classification is recomputed here from the submitted answers. A caller's
 * own `result` is used only to detect drift between the storefront and backend
 * copies of the rule engine — never to decide what is stored.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (await handleV1Request('assessment', req, res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;

  try {
    const answers = parseLegacyAnswers(body.answers);
    const infrastructureNeeds = parseLegacyInfrastructureNeeds(body.infrastructureNeeds);
    const attribution = parseLegacyAttribution(body.attribution);
    const result = evaluateNis2(answers);

    const submitted = (body.result ?? null) as { scopeResult?: string; rulesVersion?: string } | null;
    const drifted =
      submitted !== null &&
      (submitted.scopeResult !== result.scopeResult ||
        submitted.rulesVersion !== result.rulesVersion);

    if (drifted) {
      req.scope.resolve('logger').warn('[nis2] Legacy rule drift detected.');
    }

    const service: Nis2ModuleService = req.scope.resolve(NIS2_MODULE);
    const assessment = await service.createNisAssessments({
      rules_version: result.rulesVersion,
      organization_type: answers.organizationType,
      sector: answers.sector,
      subsector: answers.subsector ?? null,
      employees_bucket: answers.employees,
      turnover_bucket: answers.turnover,
      assets_bucket: answers.assets,
      group_status: answers.groupStatus,
      special_conditions: answers.specialConditions,
      scope_result: result.scopeResult,
      entity_category: result.entityCategory,
      confidence: result.confidence,
      enterprise_size: result.enterpriseSize,
      annex_class: result.annexClass,
      reason_codes: result.reasonCodes,
      requires_manual_review: result.requiresManualReview || drifted,
      infrastructure_needs: infrastructureNeeds,
      ...attribution,
    });

    res.status(201).json({ assessment: { id: assessment.id } });
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ContractError) {
      res.status(400).json({ message: error.message, field: error.field });
      return;
    }
    throw error;
  }
}
