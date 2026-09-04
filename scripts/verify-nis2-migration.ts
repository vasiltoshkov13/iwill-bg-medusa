import { Client } from 'pg';

import { Migration20260830111153 } from '../src/modules/nis2/migrations/Migration20260830111153';
import { Migration20260904000100 } from '../src/modules/nis2/migrations/Migration20260904000100';

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('MIGRATION_TEST_DATABASE_URL is required.');
const parsedUrl = new URL(databaseUrl);
const databaseName = parsedUrl.pathname.slice(1);
const socketHost = parsedUrl.searchParams.get('host');
if (!databaseName.startsWith('medusa_nis2_') || (parsedUrl.hostname && parsedUrl.hostname !== 'localhost') || (socketHost && socketHost !== '/tmp')) {
  throw new Error('Refusing to run outside a local medusa_nis2_* test database.');
}

async function queriesFor(migration: { up(): Promise<void>; down(): Promise<void>; reset(): void; getQueries(): unknown[] }, direction: 'up' | 'down') {
  migration.reset();
  await migration[direction]();
  return migration.getQueries().map(String);
}

async function executeAll(client: Client, queries: string[]) {
  for (const query of queries) await client.query(query);
}

async function main() {
  const client = new Client({ connectionString: databaseUrl, ssl: false });
  await client.connect();
  try {
    const initial = new Migration20260830111153(undefined as never, undefined as never);
    const expand = new Migration20260904000100(undefined as never, undefined as never);

    await client.query('drop schema public cascade');
    await client.query('create schema public');
    await executeAll(client, await queriesFor(initial, 'up'));
    await executeAll(client, await queriesFor(expand, 'up'));

    await client.query(`insert into nis2_lead (id, name, company_name, email)
      values ('nis2lead_MIGRATIONTEST', 'Migration', 'Test', 'migration@example.invalid')`);
    await client.query(`insert into nis2_idempotency
      (id, endpoint_kind, idempotency_key, request_digest, response_status, response_body, domain_id)
      values ('nis2idem_ONE', 'lead', '5d9cac03-85c8-44a9-a218-b427a42de85e', 'digest', 201, '{"ok":true}', 'nis2lead_MIGRATIONTEST')`);

    let duplicateCode: string | undefined;
    try {
      await client.query(`insert into nis2_idempotency
        (id, endpoint_kind, idempotency_key, request_digest, response_status, response_body, domain_id)
        values ('nis2idem_TWO', 'lead', '5d9cac03-85c8-44a9-a218-b427a42de85e', 'other', 201, '{"ok":true}', 'nis2lead_MIGRATIONTEST')`);
    } catch (error) {
      duplicateCode = (error as { code?: string }).code;
    }
    if (duplicateCode !== '23505') throw new Error(`Expected idempotency unique violation, got ${duplicateCode}`);

    let foreignKeyCode: string | undefined;
    try {
      await client.query(`insert into nis2_consultation (id, lead_id)
        values ('nis2consult_BAD', 'nis2lead_MISSING')`);
    } catch (error) {
      foreignKeyCode = (error as { code?: string }).code;
    }
    if (foreignKeyCode !== '23503') throw new Error(`Expected consultation FK violation, got ${foreignKeyCode}`);

    await client.query(`insert into nis2_consultation (id, lead_id)
      values ('nis2consult_OK', 'nis2lead_MIGRATIONTEST')`);
    await client.query(`insert into nis2_outbox
      (id, request_id, domain_kind, domain_id, intent_type, next_attempt_at, payload)
      values ('nis2intent_ONE', 'request-safe', 'lead', 'nis2lead_MIGRATIONTEST', 'ops_lead', now(), '{"domainId":"nis2lead_MIGRATIONTEST"}')`);

    const durableCounts = await client.query(`select
      (select count(*)::int from nis2_lead) as leads,
      (select count(*)::int from nis2_consultation) as consultations,
      (select count(*)::int from nis2_idempotency) as idempotency_records,
      (select count(*)::int from nis2_outbox) as outbox_intents`);

    await executeAll(client, await queriesFor(expand, 'down'));
    const rolledBack = await client.query(`select
      to_regclass('public.nis2_consultation') is null as consultation_removed,
      to_regclass('public.nis2_idempotency') is null as idempotency_removed,
      to_regclass('public.nis2_outbox') is null as outbox_removed`);
    if (!Object.values(rolledBack.rows[0]).every(Boolean)) throw new Error('Rollback did not remove every v1 table.');

    await executeAll(client, await queriesFor(expand, 'up'));
    const recovered = await client.query(`select
      to_regclass('public.nis2_consultation') is not null as consultation_present,
      to_regclass('public.nis2_idempotency') is not null as idempotency_present,
      to_regclass('public.nis2_outbox') is not null as outbox_present`);
    if (!Object.values(recovered.rows[0]).every(Boolean)) throw new Error('Recovery did not restore every v1 table.');

    process.stdout.write(`${JSON.stringify({
      migration: 'Migration20260904000100',
      up: 'passed',
      unique_constraint: duplicateCode,
      consultation_fk: foreignKeyCode,
      durable_counts: durableCounts.rows[0],
      down: 'passed',
      recovery_up: 'passed',
    })}\n`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Migration verification failed'}\n`);
  process.exitCode = 1;
});
