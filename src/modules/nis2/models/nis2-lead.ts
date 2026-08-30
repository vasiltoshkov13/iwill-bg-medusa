import { model } from '@medusajs/framework/utils';

/** Contact details a visitor left after seeing their preliminary result. */
/** Entity name is digit-free on purpose — see the note in `models/index.ts`. */
export const NisLead = model.define(
  { name: 'nis_lead', tableName: 'nis2_lead' },
  {
    id: model.id({ prefix: 'nis2lead' }).primaryKey(),

    /** Id of the assessment this lead came from, when one was recorded. */
    assessment_id: model.text().nullable(),

    name: model.text(),
    company_name: model.text(),
    job_title: model.text().nullable(),
    email: model.text(),
    phone: model.text().nullable(),
    preferred_contact: model.text().nullable(),

    wants_consultation: model.boolean().default(false),
    /** Separate from the mandatory data-processing consent, and optional. */
    marketing_consent: model.boolean().default(false),

    lead_status: model.enum([
      'NEW',
      'CONTACTED',
      'QUALIFIED',
      'PROPOSAL',
      'WON',
      'LOST',
    ]).default('NEW'),
    internal_notes: model.text().nullable(),

    // Result snapshot, so a lead stays readable without joining the assessment.
    rules_version: model.text().nullable(),
    scope_result: model.text().nullable(),
    entity_category: model.text().nullable(),
    reason_codes: model.array().nullable(),
    infrastructure_needs: model.array().nullable(),

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
