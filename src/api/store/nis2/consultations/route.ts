import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';

import { NIS2_MODULE } from '../../../../modules/nis2';
import type Nis2ModuleService from '../../../../modules/nis2/service';
import { ValidationError, requiredText } from '../validation';

/**
 * Flag an existing lead as having asked for a technical consultation.
 *
 * Updates the lead rather than creating a second one, so a single organisation
 * does not appear twice in the pipeline.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;

  try {
    const leadId = requiredText('leadId', body.leadId, 64);
    const service: Nis2ModuleService = req.scope.resolve(NIS2_MODULE);

    const [existing] = await service.listNisLeads({ id: leadId });
    if (!existing) {
      res.status(404).json({ message: 'Lead not found.' });
      return;
    }

    await service.updateNisLeads({ id: leadId, wants_consultation: true });
    res.status(200).json({ consultation: { id: leadId } });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ message: error.message, field: error.field });
      return;
    }
    throw error;
  }
}
