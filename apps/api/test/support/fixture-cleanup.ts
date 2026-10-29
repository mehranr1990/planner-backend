import { Pool } from 'pg';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
/** Administrative fixture teardown, never an API client or business assertion.
 * Only exact identities recorded by this test run; never prefixes, times or a reset.
 * Keep the API's deliberately short health/query deadlines out of multi-table teardown.
 */
export async function cleanupFixtureIdentities(
  databaseUrl: string,
  fixture: { ids?: string[]; emails?: string[]; requestIds?: string[] },
) {
  if (databaseUrl !== isolatedTestDatabaseUrl(process.env))
    throw new Error('Fixture cleanup requires the guarded isolated database');
  const ids = [...new Set(fixture.ids ?? [])],
    emails = [...new Set(fixture.emails ?? [])],
    requests = [...new Set(fixture.requestIds ?? [])],
    uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  if (
    ids.length + emails.length > 100 ||
    ids.some((v) => !uuid.test(v)) ||
    requests.some((v) => !uuid.test(v)) ||
    emails.some((v) => !/^[^\s@]+@example\.test$/.test(v))
  )
    throw new Error('Invalid exact fixture identities');
  if (!ids.length && !emails.length && !requests.length) return;
  const root = fileURLToPath(
    new URL('../../../../.tools/fixture-cleanup/', import.meta.url),
  );
  await fs.mkdir(root, { recursive: true });
  const manifest = path.join(root, randomUUID() + '.json');
  await fs.writeFile(
    manifest,
    JSON.stringify({
      database: 'isolated-test',
      ids,
      emails,
      requestIds: requests,
    }),
    { flag: 'wx', mode: 0o600 },
  );
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
    query_timeout: 5500,
    options: '-c search_path=public -c timezone=UTC -c lock_timeout=1000',
    application_name: 'planner-fixture-cleanup',
  });
  let stage = 'BEGIN';
  try {
    await pool.query('BEGIN');
    const owners = (
      await pool.query<{ id: string }>(
        'SELECT id FROM "User" WHERE id=ANY($1::uuid[]) OR email=ANY($2::text[])',
        [ids, emails],
      )
    ).rows.map((r) => r.id);
    await pool.query(
      'DELETE FROM "SecurityAuditEvent" WHERE "actorUserId"=ANY($1::uuid[]) OR "requestId"=ANY($2::uuid[])',
      [owners, requests],
    );
    const spaces = (
      await pool.query<{ id: string }>(
        'SELECT id FROM "Space" WHERE "ownerUserId"=ANY($1::uuid[])',
        [owners],
      )
    ).rows.map((v) => v.id);
    // Preserve the existing owner suites' child-first ordering across NO ACTION links.
    stage = 'CAPTURE_FINANCE';
    await pool.query(
      'WITH captures AS (DELETE FROM "CaptureItem" WHERE "spaceId"=ANY($1::uuid[]) RETURNING id) DELETE FROM "Transaction" WHERE "spaceId"=ANY($1::uuid[])',
      [spaces],
    );
    for (const table of [
      'Note',
      'MoodEntry',
      'JournalEntry',
      'NoteFolder',
      'Goal',
      'Routine',
      'TimeEntry',
      'FocusSession',
    ]) {
      stage = 'CHILD_' + table;
      await pool.query(
        'DELETE FROM "' + table + '" WHERE "spaceId"=ANY($1::uuid[])',
        [spaces],
      );
    }
    stage = 'SPACE';
    await pool.query(
      'DELETE FROM "Space" WHERE "ownerUserId"=ANY($1::uuid[])',
      [owners],
    );
    await pool.query('DELETE FROM "User" WHERE id=ANY($1::uuid[])', [owners]);
    await pool.query('COMMIT');
    await fs.unlink(manifest);
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => undefined);
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      /^[A-Z0-9]{5}$/.test(String(error.code))
        ? String(error.code)
        : 'DATABASE_ERROR';
    await fs.writeFile(
      manifest,
      JSON.stringify({
        database: 'isolated-test',
        ids,
        emails,
        requestIds: requests,
        error: { stage, code },
      }),
    );
    throw new Error(
      'Exact fixture cleanup failed at ' +
        stage +
        ' (' +
        code +
        '); isolated data and ignored ownership manifest retained.',
    );
  } finally {
    await pool.end();
  }
}
