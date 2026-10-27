import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';

const url = isolatedTestDatabaseUrl(process.env);
for (const entry of fs.readdirSync('prisma/migrations', {
  withFileTypes: true,
})) {
  if (!entry.isDirectory()) continue;
  const sql = fs.readFileSync(
    path.join('prisma/migrations', entry.name, 'migration.sql'),
    'utf8',
  );
  if (
    !sql.trim() ||
    /\b(?:DROP\s+(?:TABLE|TYPE|SCHEMA|COLUMN)|TRUNCATE|DELETE\s+FROM)\b/i.test(
      sql.replace(/--[^\n]*/g, ''),
    )
  )
    throw new Error('Empty or destructive migration requires explicit review.');
}
for (const command of ['deploy', 'status']) {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      command,
      '--config',
      'prisma.config.ts',
    ],
    { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' },
  );
  if (result.status !== 0)
    throw new Error(
      `Isolated migration ${command} failed; credentials withheld.`,
    );
}
process.stdout.write(
  'Additive migrations deploy/status passed against the isolated test database; no reset.\n',
);
