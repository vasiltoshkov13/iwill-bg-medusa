import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260830103325 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "nis2_assessment" ("id" text not null, "session_id" text null, "rules_version" text not null, "organization_type" text not null, "sector" text not null, "subsector" text null, "employees_bucket" text not null, "turnover_bucket" text not null, "assets_bucket" text not null, "group_status" text not null, "special_conditions" text[] null, "scope_result" text not null, "entity_category" text not null, "confidence" text not null, "enterprise_size" text null, "annex_class" text null, "reason_codes" text[] null, "requires_manual_review" boolean not null default false, "infrastructure_needs" text[] null, "page_path" text null, "referrer" text null, "utm_source" text null, "utm_medium" text null, "utm_campaign" text null, "utm_content" text null, "utm_term" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "nis2_assessment_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_nis2_assessment_deleted_at" ON "nis2_assessment" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "nis2_lead" ("id" text not null, "assessment_id" text null, "name" text not null, "company_name" text not null, "job_title" text null, "email" text not null, "phone" text null, "preferred_contact" text null, "wants_consultation" boolean not null default false, "marketing_consent" boolean not null default false, "lead_status" text check ("lead_status" in ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST')) not null default 'NEW', "internal_notes" text null, "rules_version" text null, "scope_result" text null, "entity_category" text null, "reason_codes" text[] null, "infrastructure_needs" text[] null, "session_id" text null, "page_path" text null, "referrer" text null, "utm_source" text null, "utm_medium" text null, "utm_campaign" text null, "utm_content" text null, "utm_term" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "nis2_lead_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_nis2_lead_deleted_at" ON "nis2_lead" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "nis2_partner_application" ("id" text not null, "company_name" text not null, "website" text null, "contact_person" text not null, "role" text null, "email" text not null, "phone" text null, "city" text null, "regions_served" text null, "company_types" text[] null, "team_size" text null, "expertise_areas" text[] null, "typical_customer_size" text null, "sectors_served" text[] null, "interested_in_poc" boolean not null default false, "interested_in_joint_projects" boolean not null default false, "message" text null, "marketing_consent" boolean not null default false, "application_status" text check ("application_status" in ('NEW', 'REVIEWING', 'CONTACTED', 'APPROVED', 'REJECTED', 'ONBOARDING', 'ACTIVE')) not null default 'NEW', "internal_notes" text null, "session_id" text null, "page_path" text null, "referrer" text null, "utm_source" text null, "utm_medium" text null, "utm_campaign" text null, "utm_content" text null, "utm_term" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "nis2_partner_application_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_nis2_partner_application_deleted_at" ON "nis2_partner_application" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "nis2_assessment" cascade;`);

    this.addSql(`drop table if exists "nis2_lead" cascade;`);

    this.addSql(`drop table if exists "nis2_partner_application" cascade;`);
  }

}
