import { parseEnvironment } from '../../apps/api/src/bootstrap/environment.ts';
import {
  installJobSchema,
  jobPlanHash,
  jobSchemaVersion,
} from '../../apps/api/src/platform/jobs/schema.ts';
const config = parseEnvironment(process.env);
await installJobSchema(config.DATABASE_URL, config.JOBS_SCHEMA);
process.stdout.write(
  JSON.stringify({
    status: 'PASS',
    schema: config.JOBS_SCHEMA,
    version: jobSchemaVersion,
    sha256: jobPlanHash,
  }) + '\n',
);
