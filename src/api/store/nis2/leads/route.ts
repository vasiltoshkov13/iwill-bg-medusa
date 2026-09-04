import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';

import { NIS2_MODULE } from '../../../../modules/nis2';
import type Nis2ModuleService from '../../../../modules/nis2/service';
import { evaluateNis2 } from '../../../../modules/nis2/rules/evaluate';
import { ContractError } from '../contract';
import { handleV1Request } from '../handler';
import {
  ValidationError,
  booleanFlag,
  email,
  parseLegacyAnswers,
  parseLegacyAttribution,
  parseLegacyInfrastructureNeeds,
  optionalText,
  requiredText,
} from '../validation';

const PREFERRED_CONTACT = ['EMAIL', 'PHONE', 'WHATSAPP'];

/**
 * Store a NIS2 lead.
 *
 * The result snapshot kept on the lead is recomputed from the answers, so the
 * scoring a salesperson sees cannot be set by the browser that submitted it.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (await handleV1Request('lead', req, res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;

  try {
    const answers = parseLegacyAnswers(body.answers);
    const result = evaluateNis2(answers);
    const infrastructureNeeds = parseLegacyInfrastructureNeeds(body.infrastructureNeeds);
    const attribution = parseLegacyAttribution(body.attribution);

    const preferredContact = optionalText('preferredContact', body.preferredContact, 20);
    if (preferredContact && !PREFERRED_CONTACT.includes(preferredContact)) {
      throw new ValidationError('preferredContact', 'Invalid preferred contact method.');
    }

    const service: Nis2ModuleService = req.scope.resolve(NIS2_MODULE);
    const lead = await service.createNisLeads({
      assessment_id: optionalText('assessmentId', body.assessmentId, 64),
      name: requiredText('name', body.name, 120),
      company_name: requiredText('companyName', body.companyName, 160),
      job_title: optionalText('jobTitle', body.jobTitle, 120),
      email: email('email', body.email),
      phone: optionalText('phone', body.phone, 40),
      preferred_contact: preferredContact,
      wants_consultation: booleanFlag(body.wantsConsultation),
      marketing_consent: booleanFlag(body.marketingConsent),
      lead_status: 'NEW' as const,
      rules_version: result.rulesVersion,
      scope_result: result.scopeResult,
      entity_category: result.entityCategory,
      reason_codes: result.reasonCodes,
      infrastructure_needs: infrastructureNeeds,
      ...attribution,
    });

    res.status(201).json({ lead: { id: lead.id } });
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ContractError) {
      res.status(400).json({ message: error.message, field: error.field });
      return;
    }
    throw error;
  }
}
