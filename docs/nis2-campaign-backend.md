# NIS2 campaign backend 1.0.0

This module implements the Medusa side of `NIS2-CAMPAIGN-CONTRACT 1.0.0` for:

- `POST /store/nis2/assessments`
- `POST /store/nis2/leads`
- `POST /store/nis2/consultations`

Versioned callers send `Content-Type: application/json`, `X-NIS2-Contract-Version: 1.0.0`, and a lowercase canonical UUID v4 `Idempotency-Key`. V1 bodies are limited to 16 KiB. Every v1 response includes `X-NIS2-Contract-Version: 1.0.0`; replays also include `Idempotency-Replayed: true`.

## Runtime configuration

Set `NIS2_IDEMPOTENCY_SECRET` to a deployment-specific random value of at least 32 characters. Do not reuse JWT, cookie, database, or provider credentials. Requests fail closed with `503 PERSISTENCE_UNAVAILABLE` if the secret is absent or too short.

Set `NIS2_MARKETING_NOTICE_VERSION` to the legal-approved marketing notice identifier before accepting any lead with `marketingConsent=true`. The backend requires an exact match and fails closed when no approved version is configured. Leave the variable unset if marketing consent is not yet enabled; `marketingConsent=false` still requires `marketingNoticeVersion=null`.

`NIS2_CAMPAIGN_ALLOWLIST` is optional JSON with this exact shape:

```json
{
  "sources": ["google"],
  "media": ["cpc"],
  "campaigns": ["nis2-bg"],
  "contents": [],
  "terms": []
}
```

Every member must be a lower-case campaign token. Unknown keys, malformed JSON, non-array values, duplicates, or invalid tokens abort Medusa configuration loading. An omitted variable produces empty lists, so no UTM dimension is persisted. Keep the configured taxonomy aligned with the storefront contract.

The Store API retains the pre-existing unversioned request path for the migration window. That compatibility path retains legacy consent semantics and must not be treated as a v1-compliant public path; route access and the announced cutoff must be controlled operationally. Its attribution parser still reduces referrers to HTTP(S) origins and omits invalid or non-allowlisted campaign data. An explicit unsupported contract version returns HTTP 426. The public v1 path must not be activated until the coordinated storefront, shared abuse-control, outbox-processing, monitoring, and Security/QA release gates pass.

## Durability and privacy behavior

A first successful write commits the domain row and idempotency result in one database transaction. Leads and consultations also commit every required outbox intent in that transaction. Replays return the committed response; key reuse with changed material data returns 409 and creates no additional domain or outbox record.

The persistence schema stores consent facts, canonical answer digests, reduced referrer origins, allowlisted campaign dimensions, and server-recomputed qualification metadata. Unknown-field errors expose only known container names, never attacker-controlled field names. Public errors and general operational events do not include request bodies, contact data, answer values, campaign dimensions, idempotency keys, session IDs, IP addresses, or provider details.

This implementation queues protected outbox intents; it does not enable provider delivery for public v1 traffic. NIS2-05 must prove processing, provider idempotency, exponential retry with jitter, dead-letter alerting, reconciliation, shared throttling, and notification-path isolation before the first public v1 request.

## Migration and verification

`Migration20260904000100` is expand-only for normal rollout. It adds nullable/backward-compatible fields, a consultation table with a lead foreign key, an endpoint-scoped idempotency table, and the outbox table/indexes. The MikroORM snapshot is generated from the current models so later schema generation starts from the expanded state.

Run the targeted checks from the repository root:

```sh
npm run test:unit -- --runTestsByPath \
  src/api/store/nis2/__tests__/contract.unit.spec.ts \
  src/api/store/nis2/__tests__/validation.unit.spec.ts \
  src/api/store/nis2/__tests__/handler.unit.spec.ts \
  src/modules/nis2/__tests__/durability.unit.spec.ts \
  src/modules/nis2/__tests__/service.unit.spec.ts

DB_USERNAME="$USER" STRIPE_API_KEY=dummy \
  npm run test:integration:http -- --runTestsByPath integration-tests/http/nis2.spec.ts

MIGRATION_TEST_DATABASE_URL='postgres://USER@HOST:PORT/ISOLATED_DB' \
  ./node_modules/.bin/ts-node scripts/verify-nis2-migration.ts

./node_modules/.bin/tsc --noEmit
```

The migration verifier requires an isolated disposable PostgreSQL database. It exercises `up`, validates constraints and foreign-key behavior, exercises `down`, and reapplies `up` to prove recovery. Never point it at a shared, staging, or production database.

## Rollout

1. Apply the expand migration while legacy traffic remains supported.
2. Verify schema, route health, structured logs, idempotent retries, transaction rollback, and production-like reconciliation counts.
3. Complete the NIS2-05 abuse-control and outbox worker gate with isolated records.
4. Atomically switch the storefront to versioned headers and its v1-only outbox path; a v1 request must never also use a direct notification path.
5. Observe duplicate rate, 4xx/5xx rate, pending/dead-letter intents, and reconciliation before enabling campaign traffic.
6. Activation still requires QA, Security, and explicit deployment approval.

## Rollback and recovery

Runtime rollback keeps the expanded schema:

1. Stop paid traffic and new v1 submissions. Return an honest retryable 503 rather than acknowledging an uncommitted lead.
2. Revert the storefront experience or v1 adapter while preserving legacy compatibility.
3. Repair or roll forward the backend.
4. Drain and reconcile pending/dead-letter intents and compare domain, idempotency, and outbox counts.

Do not run the migration `down` while any v1 writer is active. Do not drop uniqueness, consultation, or outbox data as an application rollback. Destructive `down` is reserved for an isolated rollback exercise or a separately approved maintenance window after writers are stopped, retention obligations are satisfied, and records/intents are reconciled and exported.
