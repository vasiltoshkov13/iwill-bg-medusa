import { MedusaService } from '@medusajs/framework/utils';

import { NisAssessment, NisLead } from './models';

/**
 * Generated CRUD for the NIS2 records.
 *
 * `MedusaService` produces `createNisAssessments`, `listNisLeads`,
 * `updateNisLeads` and the rest of the standard methods.
 */
class Nis2ModuleService extends MedusaService({
  NisAssessment,
  NisLead,
}) {}

export default Nis2ModuleService;
