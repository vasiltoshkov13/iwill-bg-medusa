import { model } from '@medusajs/framework/utils';

/**
 * A completed preliminary NIS2 scope assessment.
 *
 * The classification columns store the result the backend recomputed from the
 * answers, never the one a browser submitted. `rules_version` records which rule
 * set produced it, so historical assessments stay interpretable after the
 * Bulgarian Закон за киберсигурност or the underlying thresholds change.
 */
/** Entity name is digit-free on purpose — see the note in `models/index.ts`. */
export const NisAssessment = model.define(
  { name: 'nis_assessment', tableName: 'nis2_assessment' },
  {
    id: model.id({ prefix: 'nis2asm' }).primaryKey(),

    /** Browser session that produced the assessment; not a user identifier. */
    session_id: model.text().nullable(),
    rules_version: model.text(),
    answer_digest: model.text().nullable(),

    // Answers
    organization_type: model.text(),
    sector: model.text(),
    subsector: model.text().nullable(),
    employees_bucket: model.text(),
    turnover_bucket: model.text(),
    assets_bucket: model.text(),
    group_status: model.text(),
    special_conditions: model.array().nullable(),

    // Result
    scope_result: model.text(),
    entity_category: model.text(),
    confidence: model.text(),
    enterprise_size: model.text().nullable(),
    annex_class: model.text().nullable(),
    reason_codes: model.array().nullable(),
    requires_manual_review: model.boolean().default(false),

    // Commercial qualification, deliberately separate from the legal result
    infrastructure_needs: model.array().nullable(),

    // Attribution
    page_path: model.text().nullable(),
    referrer: model.text().nullable(),
    referrer_origin: model.text().nullable(),
    utm_source: model.text().nullable(),
    utm_medium: model.text().nullable(),
    utm_campaign: model.text().nullable(),
    utm_content: model.text().nullable(),
    utm_term: model.text().nullable(),
  },
);
