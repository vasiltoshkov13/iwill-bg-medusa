import { MedusaService } from '@medusajs/framework/utils';

import { NisAssessment, NisLead, NisPartnerApplication } from './models';

/**
 * Generated CRUD for the NIS2 records.
 *
 * `MedusaService` produces `createNisAssessments`, `listNisLeads`,
 * `updateNisPartnerApplications` and the rest of the standard methods.
 */
class Nis2ModuleService extends MedusaService({
  NisAssessment,
  NisLead,
  NisPartnerApplication,
}) {}

export default Nis2ModuleService;
