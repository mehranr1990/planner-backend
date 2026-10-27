import 'reflect-metadata';
import { DatabaseService } from '../../apps/api/dist/platform/database/database.service.js';
import { parseEnvironment } from '../../apps/api/src/bootstrap/environment.ts';

let database: DatabaseService | undefined;
try {
  database = new DatabaseService(parseEnvironment(process.env));
  await database.checkConnection();
  process.stdout.write(
    'Local PostgreSQL SELECT 1 passed. No schema or data changed.\n',
  );
} catch {
  process.stderr.write(
    'Database check failed. Verify local PostgreSQL and DATABASE_URL; credentials withheld.\n',
  );
  process.exitCode = 1;
} finally {
  await database?.onApplicationShutdown();
}
