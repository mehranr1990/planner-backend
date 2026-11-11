import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { normalizedAuthModel } from '../testing/auth-provider-model.ts';

fs.mkdirSync('.tools', { recursive: true });
const generatedFile = '.tools/p0-02-auth-schema-check.prisma';
const result = spawnSync(
  process.execPath,
  [
    'node_modules/auth/dist/index.mjs',
    'generate',
    '--config',
    'tooling/auth/schema-config.ts',
    '--output',
    generatedFile,
    '--yes',
  ],
  { encoding: 'utf8' },
);
if (result.status !== 0 || !fs.existsSync(generatedFile))
  throw new Error(
    'Official Better Auth schema generation failed; no database changes made.',
  );
const generated = fs.readFileSync(generatedFile, 'utf8');
const actual = fs.readFileSync('prisma/schema.prisma', 'utf8');
for (const name of ['User', 'AuthSession', 'AuthAccount', 'AuthVerification'])
  if (
    normalizedAuthModel(generated, name) !== normalizedAuthModel(actual, name)
  )
    throw new Error(
      `Auth schema drift in ${name}; regenerate with the pinned provider CLI and review a migration.`,
    );
process.stdout.write(
  'Provider-owned auth fields, indexes and relations match the pinned official schema generator.\n',
);
