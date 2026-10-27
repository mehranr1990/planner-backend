import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { isolatedTestDatabaseUrl } from './test-database.ts';

export default function setup() {
  const databaseUrl = isolatedTestDatabaseUrl(process.env);
  const result = spawnSync(
    process.execPath,
    [
      path.resolve('node_modules/prisma/build/index.js'),
      'migrate',
      'deploy',
      '--config',
      'prisma.config.ts',
    ],
    { env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8' },
  );
  if (result.status !== 0)
    throw new Error(
      'Isolated test database migration failed; credentials withheld. Inspect reviewed migration and local PostgreSQL.',
    );
  process.stdout.write(
    'Isolated test migrations deployed (no reset or schema push).\n',
  );
}
