import { Migration } from '@medusajs/framework/mikro-orm/migrations';

/**
 * Expand-only NIS2-CAMPAIGN-CONTRACT 1.0.0 schema.
 *
 * The down migration is intentionally destructive and is only for an isolated
 * rollback exercise or a later maintenance window after v1 writers are stopped
 * and outbox/domain records are reconciled and exported. Runtime rollback keeps
 * this expanded schema in place and fails closed with 503.
 */
export class Migration20260904000100 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "nis2_assessment" add column if not exists "answer_digest" text null;');
    this.addSql('alter table "nis2_assessment" add column if not exists "referrer_origin" text null;');

    this.addSql('alter table "nis2_lead" add column if not exists "privacy_consent" boolean not null default false;');
    this.addSql('alter table "nis2_lead" add column if not exists "privacy_notice_version" text null;');
    this.addSql('alter table "nis2_lead" add column if not exists "consented_at" timestamptz null;');
    this.addSql('alter table "nis2_lead" add column if not exists "marketing_notice_version" text null;');
    this.addSql("alter table \"nis2_lead\" add column if not exists \"qualification\" text not null default 'review_required';");
    this.addSql("alter table \"nis2_lead\" drop constraint if exists \"nis2_lead_qualification_check\";");
    this.addSql("alter table \"nis2_lead\" add constraint \"nis2_lead_qualification_check\" check (\"qualification\" in ('qualified', 'review_required', 'unqualified'));");
    this.addSql('alter table "nis2_lead" add column if not exists "answer_digest" text null;');
    this.addSql('alter table "nis2_lead" add column if not exists "confidence" text null;');
    this.addSql('alter table "nis2_lead" add column if not exists "enterprise_size" text null;');
    this.addSql('alter table "nis2_lead" add column if not exists "annex_class" text null;');
    this.addSql('alter table "nis2_lead" add column if not exists "result_snapshot" jsonb null;');
    this.addSql('alter table "nis2_lead" add column if not exists "requires_manual_review" boolean not null default false;');
    this.addSql('alter table "nis2_lead" add column if not exists "referrer_origin" text null;');

    this.addSql(`create table if not exists "nis2_consultation" (
      "id" text not null,
      "lead_id" text not null,
      "session_id" text null,
      "page_path" text null,
      "referrer_origin" text null,
      "utm_source" text null,
      "utm_medium" text null,
      "utm_campaign" text null,
      "utm_content" text null,
      "utm_term" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "nis2_consultation_pkey" primary key ("id"),
      constraint "nis2_consultation_lead_fk" foreign key ("lead_id") references "nis2_lead" ("id") on delete cascade
    );`);
    this.addSql('create index if not exists "IDX_nis2_consultation_lead_id" on "nis2_consultation" ("lead_id") where "deleted_at" is null;');
    this.addSql('create index if not exists "IDX_nis2_consultation_deleted_at" on "nis2_consultation" ("deleted_at") where "deleted_at" is null;');

    this.addSql(`create table if not exists "nis2_idempotency" (
      "id" text not null,
      "endpoint_kind" text not null,
      "idempotency_key" text not null,
      "request_digest" text not null,
      "response_status" integer not null,
      "response_body" jsonb not null,
      "domain_id" text not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "nis2_idempotency_pkey" primary key ("id"),
      constraint "nis2_idempotency_endpoint_check" check ("endpoint_kind" in ('assessment', 'lead', 'consultation'))
    );`);
    this.addSql('create unique index if not exists "IDX_nis2_idempotency_endpoint_kind_idempotency_key_unique" on "nis2_idempotency" ("endpoint_kind", "idempotency_key") where "deleted_at" is null;');
    this.addSql('create index if not exists "IDX_nis2_idempotency_domain_id" on "nis2_idempotency" ("domain_id") where "deleted_at" is null;');
    this.addSql('create index if not exists "IDX_nis2_idempotency_deleted_at" on "nis2_idempotency" ("deleted_at") where "deleted_at" is null;');

    this.addSql(`create table if not exists "nis2_outbox" (
      "id" text not null,
      "request_id" text not null,
      "domain_kind" text not null,
      "domain_id" text not null,
      "intent_type" text not null,
      "state" text not null default 'pending',
      "attempt_count" integer not null default 0,
      "next_attempt_at" timestamptz not null,
      "last_error_class" text null,
      "payload" jsonb not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "nis2_outbox_pkey" primary key ("id"),
      constraint "nis2_outbox_domain_kind_check" check ("domain_kind" in ('lead', 'consultation')),
      constraint "nis2_outbox_intent_type_check" check ("intent_type" in ('ops_lead', 'visitor_summary', 'internal_lead', 'ops_consultation', 'internal_consultation')),
      constraint "nis2_outbox_state_check" check ("state" in ('pending', 'processing', 'delivered', 'dead_letter')),
      constraint "nis2_outbox_error_class_check" check ("last_error_class" is null or "last_error_class" in ('timeout', 'rate_limited', 'authentication', 'provider_4xx', 'provider_5xx', 'network', 'unknown'))
    );`);
    this.addSql('create unique index if not exists "IDX_nis2_outbox_domain_id_intent_type_unique" on "nis2_outbox" ("domain_id", "intent_type") where "deleted_at" is null;');
    this.addSql('create index if not exists "IDX_nis2_outbox_state_next_attempt_at" on "nis2_outbox" ("state", "next_attempt_at") where "deleted_at" is null;');
    this.addSql('create index if not exists "IDX_nis2_outbox_request_id" on "nis2_outbox" ("request_id") where "deleted_at" is null;');
    this.addSql('create index if not exists "IDX_nis2_outbox_deleted_at" on "nis2_outbox" ("deleted_at") where "deleted_at" is null;');
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "nis2_outbox" cascade;');
    this.addSql('drop table if exists "nis2_idempotency" cascade;');
    this.addSql('drop table if exists "nis2_consultation" cascade;');

    this.addSql('alter table "nis2_lead" drop column if exists "referrer_origin";');
    this.addSql('alter table "nis2_lead" drop column if exists "requires_manual_review";');
    this.addSql('alter table "nis2_lead" drop column if exists "annex_class";');
    this.addSql('alter table "nis2_lead" drop column if exists "result_snapshot";');
    this.addSql('alter table "nis2_lead" drop column if exists "enterprise_size";');
    this.addSql('alter table "nis2_lead" drop column if exists "confidence";');
    this.addSql('alter table "nis2_lead" drop column if exists "answer_digest";');
    this.addSql('alter table "nis2_lead" drop column if exists "qualification";');
    this.addSql('alter table "nis2_lead" drop column if exists "marketing_notice_version";');
    this.addSql('alter table "nis2_lead" drop column if exists "consented_at";');
    this.addSql('alter table "nis2_lead" drop column if exists "privacy_notice_version";');
    this.addSql('alter table "nis2_lead" drop column if exists "privacy_consent";');

    this.addSql('alter table "nis2_assessment" drop column if exists "referrer_origin";');
    this.addSql('alter table "nis2_assessment" drop column if exists "answer_digest";');
  }
}
