import { model } from '@medusajs/framework/utils';

/**
 * An application to the IWILL NIS2 Infrastructure Partner Program.
 *
 * The programme is an IWILL commercial partnership. Nothing here records or
 * implies a NIS2 certification or a regulatory approval.
 */
/** Entity name is digit-free on purpose — see the note in `models/index.ts`. */
export const NisPartnerApplication = model.define(
  { name: 'nis_partner_application', tableName: 'nis2_partner_application' },
  {
    id: model.id({ prefix: 'nis2ptr' }).primaryKey(),

    company_name: model.text(),
    website: model.text().nullable(),
    contact_person: model.text(),
    role: model.text().nullable(),
    email: model.text(),
    phone: model.text().nullable(),
    city: model.text().nullable(),
    regions_served: model.text().nullable(),

    company_types: model.array().nullable(),
    team_size: model.text().nullable(),
    expertise_areas: model.array().nullable(),
    typical_customer_size: model.text().nullable(),
    sectors_served: model.array().nullable(),

    interested_in_poc: model.boolean().default(false),
    interested_in_joint_projects: model.boolean().default(false),
    message: model.text().nullable(),
    marketing_consent: model.boolean().default(false),

    application_status: model.enum([
      'NEW',
      'REVIEWING',
      'CONTACTED',
      'APPROVED',
      'REJECTED',
      'ONBOARDING',
      'ACTIVE',
    ]).default('NEW'),
    internal_notes: model.text().nullable(),

    // Attribution
    session_id: model.text().nullable(),
    page_path: model.text().nullable(),
    referrer: model.text().nullable(),
    utm_source: model.text().nullable(),
    utm_medium: model.text().nullable(),
    utm_campaign: model.text().nullable(),
    utm_content: model.text().nullable(),
    utm_term: model.text().nullable(),
  },
);
