import 'reflect-metadata';
import { DatabaseService } from '../../apps/api/dist/platform/database/database.service.js';
import {
  localCompanyEnvironment,
  LOCAL_COMPANY_POLICY,
  seedLocalCompanyPolicy,
} from '../retention/local-company.ts';

const args = process.argv.slice(2);
let database: DatabaseService | undefined;
try {
  if (args.length > 1 || args.some((arg) => arg !== '--apply'))
    throw new Error('Invalid arguments');
  database = new DatabaseService(localCompanyEnvironment(process.env));
  const result = await seedLocalCompanyPolicy(
    database.client as unknown as Parameters<typeof seedLocalCompanyPolicy>[0],
    process.env,
    args.includes('--apply'),
  );
  process.stdout.write(`${result} ${LOCAL_COMPANY_POLICY.policyVersion}\n`);
  if (result === 'CONFLICT') process.exitCode = 1;
} catch {
  process.stderr.write(
    'Local Company seed refused or failed; credentials withheld. Requires explicit local Shared test mode. Usage: node --env-file=.env tooling/scripts/retention-company-local-seed.ts [--apply]\n',
  );
  process.exitCode = 1;
} finally {
  await database?.onApplicationShutdown();
}
