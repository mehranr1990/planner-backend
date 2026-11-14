import 'reflect-metadata';
import { DatabaseService } from '../../apps/api/dist/platform/database/database.service.js';
import { parseEnvironment } from '../../apps/api/src/bootstrap/environment.ts';
import {
  RETENTION_CATALOG_V1_PENDING,
  seedRetentionCatalog,
} from '../retention/catalog-v1.ts';

// Development/pre-production only. Dry run unless --apply; never updates,
// deletes or triggers cleanup. Production needs operator approval instead.
const args = process.argv.slice(2),
  target = args.find((a) => a.startsWith('--target='))?.slice(9),
  apply = args.includes('--apply');
if (
  !['development', 'pre-production'].includes(target ?? '') ||
  args.some((a) => a !== '--apply' && !a.startsWith('--target='))
) {
  process.stderr.write(
    'Usage: retention-catalog-seed --target=development|pre-production [--apply]\n',
  );
  process.exit(2);
}
let database: DatabaseService | undefined;
try {
  database = new DatabaseService(parseEnvironment(process.env));
  // dist and src carry the same generated Prisma client types.
  const result = await seedRetentionCatalog(
    database.client as unknown as Parameters<typeof seedRetentionCatalog>[0],
    apply,
  );
  for (const r of result) process.stdout.write(`${r.status} ${r.version}\n`);
  for (const p of RETENTION_CATALOG_V1_PENDING)
    process.stdout.write(`NOT SEEDED ${p.context}: ${p.status}\n`);
  if (result.some((r) => r.status === 'CONFLICT')) {
    process.stderr.write(
      'A differing policy already uses a v1.0 version; nothing was written.\n',
    );
    process.exitCode = 1;
  } else if (!apply) process.stdout.write('Dry run: nothing was written.\n');
} catch {
  process.stderr.write(
    'Retention catalog seed failed; credentials withheld. Nothing was overwritten.\n',
  );
  process.exitCode = 1;
} finally {
  await database?.onApplicationShutdown();
}
