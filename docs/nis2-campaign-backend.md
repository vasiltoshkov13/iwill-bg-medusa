# NIS2 campaign backend 1.0.0

This module implements the Medusa side of `NIS2-CAMPAIGN-CONTRACT 1.0.0` for:

- `POST /store/nis2/assessments`
- `POST /store/nis2/leads`
- `POST /store/nis2/consultations`

Versioned callers send `Content-Type: application/json`, `X-NIS2-Contract-Version: 1.0.0`, and a lowercase canonical UUID v4 `Idempotency-Key`. V1 bodies are limited to 16 KiB. Every v1 response includes `X-NIS2-Contract-Version: 1.0.0`; replays also include `Idempotency-Replayed: true`.

## Runtime configuration

Set `NIS2_IDEMPOTENCY_SECRET` to a deployment-specific random value of at least 32 characters. It is a stable-secret invariant: the value must remain byte-for-byte identical across replicas and deployments for the full lifetime of retained idempotency records. Changing it while records remain would make an identical replay look like changed material. Do not reuse JWT, cookie, database, or provider credentials. Requests fail closed with `503 PERSISTENCE_UNAVAILABLE` if the secret is absent or too short.

The public Medusa boundary also requires a shared Redis REST limiter. Configure `NIS2_RATE_LIMIT_REST_URL`, `NIS2_RATE_LIMIT_REST_TOKEN`, and a deployment-specific `NIS2_RATE_LIMIT_HMAC_SECRET` of at least 32 characters. The URL must use HTTPS in production. `KV_REST_API_URL` / `KV_REST_API_TOKEN` and `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are accepted provider aliases. The backend fails closed with `503 PERSISTENCE_UNAVAILABLE` if configuration, transport, or the shared service is unavailable; it never falls back to process-local counters.

The default fixed window is 600 seconds. Optional positive-integer overrides are `NIS2_RATE_LIMIT_WINDOW_SECONDS`, `NIS2_RATE_LIMIT_TIMEOUT_MS`, and per-endpoint `NIS2_RATE_LIMIT_{ASSESSMENT|LEAD|CONSULTATION}_{GLOBAL|NETWORK|KEY}_MAX`. Counters cover the backend fleet, the direct socket peer network, and the logical submission key. Fleet and peer-network denials stop before storage access. When only the logical-key ceiling is exceeded, the backend performs one read-only idempotency lookup: an identical committed request is replayed, changed material returns 409, and an absent record returns 429 without entering a write path. Forwarding headers are ignored because an origin caller can forge them. Only truncated HMAC bucket identifiers leave the process; raw addresses and idempotency keys are not sent to the limiter or written to application logs.

Set `NIS2_MARKETING_NOTICE_VERSION` to the legal-approved marketing notice identifier before accepting any lead with `marketingConsent=true`. The backend requires an exact match and fails closed when no approved version is configured. Leave the variable unset if marketing consent is not yet enabled; `marketingConsent=false` still requires `marketingNoticeVersion=null`.

Lead privacy acknowledgement is bound immutably to `nis2-privacy-2026-09-08-93ba2f3d8256`, the canonical notice identifier shipped by storefront candidate `34d404509a5cbedda22f42ea908b2f7cb97873cb`. The legacy compatibility field `privacyConsent` must be `true` and `privacyNoticeVersion` must match that literal byte-for-byte. Missing, former (`nis2-privacy-2026-09-04`), superseded (`nis2-privacy-2026-09-08-5090901008de`), changed (including whitespace-modified), and unknown versions return HTTP 400 `VALIDATION_FAILED` on `privacyNoticeVersion` before any lead, idempotency, or outbox write. The exact Medusa-bound storefront fixture is `integration-tests/fixtures/storefront-34d404509a5cbedda22f42ea908b2f7cb97873cb-lead.json`.

Example lead request (with the standard v1 headers and a fresh canonical UUID v4 idempotency key):

```json
{
  "assessmentId": null,
  "name": "Private Person",
  "companyName": "Private Company",
  "jobTitle": null,
  "email": "private.person@example.bg",
  "phone": null,
  "preferredContact": "EMAIL",
  "privacyConsent": true,
  "privacyNoticeVersion": "nis2-privacy-2026-09-08-93ba2f3d8256",
  "marketingConsent": false,
  "marketingNoticeVersion": null,
  "wantsConsultation": false,
  "answers": {
    "organizationType": "PRIVATE_ENTERPRISE",
    "sector": "FOOD",
    "subsector": null,
    "employees": "E_50_249",
    "turnover": "T_10_50M",
    "assets": "A_10_43M",
    "groupStatus": "NO",
    "specialConditions": ["NONE"]
  },
  "infrastructureNeeds": ["NETWORK_SEGMENTATION_VLAN"],
  "attribution": {
    "sessionId": null,
    "pagePath": null,
    "referrerOrigin": null,
    "utmSource": null,
    "utmMedium": null,
    "utmCampaign": null,
    "utmContent": null,
    "utmTerm": null
  }
}
```

Example first-write response (HTTP 201):

```json
{
  "lead": {
    "id": "nis2lead_01J9K4F6Y8M2Q7R3T5V0W1X2Z3",
    "persistedAt": "2026-09-08T15:30:00.000Z",
    "qualification": "qualified"
  },
  "requestId": "10000000-0000-4000-8000-000000000017",
  "idempotency": { "replayed": false },
  "delivery": {
    "summary": "queued",
    "ops": "queued",
    "internalNotification": "queued"
  }
}
```

The Yarn-canonical runtime dependency graph pins `qs` to `6.16.0` through the root `resolutions` field. This covers the public Express parser path while preserving Medusa `2.20.1`; use the repository-pinned Yarn `4.12.0` and do not use the stale noncanonical `package-lock.json` for installation.

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

The compatibility window is closed. An absent or unsupported contract version returns HTTP 426 before rate-limit consumption or any durable write. CORS is browser policy only and is not treated as authorization or an abuse-control boundary. The public v1 path must not be activated until the coordinated storefront, shared abuse-control, outbox-processing, monitoring, and Security/QA release gates pass.

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

npm run test:integration:http

MIGRATION_TEST_DATABASE_URL='postgres://USER@HOST:PORT/ISOLATED_DB' \
  ./node_modules/.bin/ts-node scripts/verify-nis2-migration.ts

./node_modules/.bin/tsc --noEmit
```

The HTTP integration runner requires a local or explicitly configured PostgreSQL role with `CREATEDB`. When `DB_USERNAME` is unset, its preflight tries `PGUSER`, the operating-system username, and then Medusa's `postgres` default, selecting only a role that can connect and create disposable databases. Explicit `DB_USERNAME`/`DB_PASSWORD` values always win. The runner supplies a non-secret Stripe placeholder only when the test process has no configured key; it never writes that placeholder to runtime configuration.

The migration verifier requires an isolated disposable PostgreSQL database. It exercises `up`, validates constraints and foreign-key behavior, exercises `down`, and reapplies `up` to prove recovery. Never point it at a shared, staging, or production database.

## Rollout

1. Apply the expand migration before routing versioned traffic to this candidate.
2. Verify schema, route health, structured logs, idempotent retries, transaction rollback, and production-like reconciliation counts.
3. Complete the NIS2-05 abuse-control and outbox worker gate with isolated records.
4. Atomically switch the storefront to versioned headers and its v1-only outbox path; a v1 request must never also use a direct notification path.
5. Observe duplicate rate, 4xx/5xx rate, pending/dead-letter intents, and reconciliation before enabling campaign traffic.
6. Activation still requires QA, Security, and explicit deployment approval.

## Rollback and recovery

Runtime rollback keeps the expanded schema:

1. Stop paid traffic and new v1 submissions. Return an honest retryable 503 rather than acknowledging an uncommitted lead.
2. Revert the storefront experience or disable the public route; do not reopen the unversioned compatibility path.
3. Repair or roll forward the backend.
4. Drain and reconcile pending/dead-letter intents and compare domain, idempotency, and outbox counts.

Do not run the migration `down` while any v1 writer is active. Do not drop uniqueness, consultation, or outbox data as an application rollback. Destructive `down` is reserved for an isolated rollback exercise or a separately approved maintenance window after writers are stopped, retention obligations are satisfied, and records/intents are reconciled and exported.
