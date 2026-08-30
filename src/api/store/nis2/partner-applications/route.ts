import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';

import { NIS2_MODULE } from '../../../../modules/nis2';
import type Nis2ModuleService from '../../../../modules/nis2/service';
import {
  ValidationError,
  booleanFlag,
  email,
  optionalText,
  parseAttribution,
  requiredText,
  stringArray,
} from '../validation';

/** Store an application to the IWILL NIS2 Infrastructure Partner Program. */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;

  try {
    const companyTypes = stringArray('companyTypes', body.companyTypes);
    if (companyTypes.length === 0) {
      throw new ValidationError('companyTypes', 'At least one company type is required.');
    }

    const service: Nis2ModuleService = req.scope.resolve(NIS2_MODULE);
    const application = await service.createNisPartnerApplications({
      company_name: requiredText('companyName', body.companyName, 160),
      website: optionalText('website', body.website, 200),
      contact_person: requiredText('contactPerson', body.contactPerson, 120),
      role: optionalText('role', body.role, 120),
      email: email('email', body.email),
      phone: optionalText('phone', body.phone, 40),
      city: optionalText('city', body.city, 80),
      regions_served: optionalText('regionsServed', body.regionsServed, 200),
      company_types: companyTypes,
      team_size: optionalText('teamSize', body.teamSize, 40),
      expertise_areas: stringArray('expertiseAreas', body.expertiseAreas),
      typical_customer_size: optionalText('typicalCustomerSize', body.typicalCustomerSize, 40),
      sectors_served: stringArray('sectorsServed', body.sectorsServed),
      interested_in_poc: booleanFlag(body.interestedInPoc),
      interested_in_joint_projects: booleanFlag(body.interestedInJointProjects),
      message: optionalText('message', body.message, 2000),
      marketing_consent: booleanFlag(body.marketingConsent),
      application_status: 'NEW' as const,
      ...parseAttribution(body.attribution),
    });

    res.status(201).json({ application: { id: application.id } });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ message: error.message, field: error.field });
      return;
    }
    throw error;
  }
}
