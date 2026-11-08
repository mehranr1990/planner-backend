import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Client } from 'pg';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';
import { installJobSchema } from '../../apps/api/src/platform/jobs/schema.ts';

// The real worker uses the default Prisma namespace. Give it a NEW disposable
// database, never the populated configured test/dev database or a mocked worker.
const original = isolatedTestDatabaseUrl(process.env),
  name = 'p406_' + randomUUID().replaceAll('-', '') + '_test',
  jobs = 'planner_jobs_test_' + randomUUID().replaceAll('-', ''),
  control = new Client({ connectionString: original });
const url = new URL(original);
url.pathname = '/' + name;
let owned = false;
await control.connect();
try {
  assert.match(name, /^p406_[a-f0-9]{32}_test$/);
  await control.query('CREATE DATABASE "' + name + '"');
  owned = true;
  await installJobSchema(url.toString(), jobs);
  const child = spawn(process.execPath, ['tooling/scripts/p4-06-smoke.ts'], {
    env: {
      ...process.env,
      TEST_DATABASE_URL: url.toString(),
      P406_WORKER_SMOKE: '1',
      JOBS_SCHEMA: jobs,
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  const [code] = (await once(child, 'exit')) as [number | null];
  assert.equal(code, 0, 'Compiled API/worker restart smoke failed');
} finally {
  try {
    if (owned) {
      // Only this exact newly-created fixture is eligible. No reset of an
      // existing configured database and no removal of pre-existing records.
      assert.match(name, /^p406_[a-f0-9]{32}_test$/);
      assert.notEqual(name, new URL(original).pathname.slice(1));
      await control.query('DROP DATABASE "' + name + '" WITH (FORCE)');
    }
  } finally {
    await control.end();
  }
}
