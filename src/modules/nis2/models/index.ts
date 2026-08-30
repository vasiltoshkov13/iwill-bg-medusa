/*
 * Entity names here are deliberately digit-free (`nis_assessment`) while the
 * tables keep the `nis2_` prefix.
 *
 * Medusa derives the container registration name for a model's internal service
 * by camel-casing the entity name, and its camel-case helper is not idempotent
 * for names containing a digit: `nis2_assessment` becomes `nis2Assessment` and
 * then `nis2assessment`, which no longer matches the `nis2AssessmentService`
 * that the generated module service looks up — every create/list call then
 * fails with an Awilix resolution error at runtime.
 *
 * A digit-free entity name sidesteps that. Database naming is unaffected, since
 * `tableName` is set explicitly on each model.
 */

export { NisAssessment } from './nis2-assessment';
export { NisLead } from './nis2-lead';
export { NisPartnerApplication } from './nis2-partner-application';
