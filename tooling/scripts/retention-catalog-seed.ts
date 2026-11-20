import 'reflect-metadata';
import { DatabaseService } from '../../apps/api/dist/platform/database/database.service.js';
import { parseEnvironment } from '../../apps/api/src/bootstrap/environment.ts';
import {
  RETENTION_CATALOG_V1_PENDING,
  seedRetentionCatalog,
} from '../retention/catalog-v1.ts';
import {
  RETENTION_CATALOG_V2_PENDING,
  buildRetentionCatalogV2,
} from '../retention/catalog-v2.ts';

// Dry run unless --apply; never updates, deletes or triggers cleanup.
// v1 (default): development/pre-production only.
// v2 (ADR 0069, 7-day recovery): any target, but only with the accountable
// owner's genuine --approval-reference and --accountable-operator.
const args = process.argv.slice(2),
  flag = (name: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3),
  target = flag('target'),
  catalogName = flag('catalog') ?? 'v1',
  apply = args.includes('--apply'),
  known = ['target', 'catalog', 'approval-reference', 'accountable-operator'];
const targets =
  catalogName === 'v1'
    ? ['development', 'pre-production']
    : catalogName === 'v2'
      ? ['development', 'pre-production', 'production']
      : [];
if (
  !targets.includes(target ?? '') ||
  args.some(
    (a) => a !== '--apply' && !known.some((k) => a.startsWith(`--${k}=`)),
  ) ||
  (catalogName === 'v2') !==
    Boolean(flag('approval-reference') && flag('accountable-operator'))
) {
  process.stderr.write(
    'Usage: retention-catalog-seed --target=development|pre-production [--apply]\n' +
      '       retention-catalog-seed --catalog=v2 --target=development|pre-production|production\n' +
      '         --approval-reference=<ref> --accountable-operator=<name/role> [--apply]\n',
  );
  process.exit(2);
}
let database: DatabaseService | undefined;
try {
  const catalog =
    catalogName === 'v2'
      ? buildRetentionCatalogV2({
          approvalReference: flag('approval-reference')!,
          accountableOperator: flag('accountable-operator')!,
        })
      : undefined;
  database = new DatabaseService(parseEnvironment(process.env));
  // dist and src carry the same generated Prisma client types.
  const result = await seedRetentionCatalog(
    database.client as unknown as Parameters<typeof seedRetentionCatalog>[0],
    apply,
    catalog,
  );
  for (const r of result) process.stdout.write(`${r.status} ${r.version}\n`);
  for (const p of catalog
    ? RETENTION_CATALOG_V2_PENDING
    : RETENTION_CATALOG_V1_PENDING)
    process.stdout.write(`NOT SEEDED ${p.context}: ${p.status}\n`);
  if (result.some((r) => r.status === 'CONFLICT')) {
    process.stderr.write(
      'A differing policy already uses one of these versions; nothing was written.\n',
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
