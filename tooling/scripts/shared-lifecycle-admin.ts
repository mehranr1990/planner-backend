import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseEnvironment } from '../../apps/api/dist/bootstrap/environment.js';
import { AppModule } from '../../apps/api/dist/app.module.js';
import { SharedLifecycleService } from '../../apps/api/dist/modules/spaces/public/index.js';
import { ProjectCleanupService } from '../../apps/api/dist/modules/projects/public/index.js';
import { TeamCleanupService } from '../../apps/api/dist/modules/teams/public/index.js';
import { DatabaseService } from '../../apps/api/dist/platform/database/database.service.js';
import * as c from '../../packages/api-contracts/dist/index.js';
import { SharedControl } from '../../apps/api/dist/platform/storage/shared-control.js';
const [command, ...args] = process.argv.slice(2);
const uuid = c.ProjectCreateSchema.shape.id;
if (command === 'init-control') {
  // One-time provisioning of the signed Shared control checkpoint for a NEW
  // installation. Idempotent; never rewrites an existing checkpoint, never
  // activates Shared features (SHARED_SECURITY_ACCEPTANCE_REFERENCE still gates
  // them) and refuses when shared custody already exists, because a missing
  // checkpoint there means lost/restored control that needs restore-replay.
  if (args.length) throw new Error('Expected init-control without arguments');
  const config = parseEnvironment(process.env);
  if (!config.SHARED_CONTROL_ACTIVE_KEY_ID || !config.SHARED_CONTROL_KEYS)
    throw new Error(
      'init-control requires SHARED_CONTROL_KEYS and SHARED_CONTROL_ACTIVE_KEY_ID',
    );
  const control = new SharedControl(config);
  const state = await control.records().then(
    () => 'present' as const,
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'Missing current shared checkpoint'
        ? ('missing' as const)
        : Promise.reject(error),
  );
  if (state === 'present') {
    process.stdout.write(
      'PASS: shared control checkpoint already initialized and verified; nothing changed.\n',
    );
    process.exit(0);
  }
  const database = new DatabaseService(config);
  try {
    const existing =
      (await database.client.sharedCustody.count()) +
      (await database.client.sharedLifecycleJob.count());
    if (existing)
      throw new Error(
        'Shared custody exists without a control checkpoint; use the restore-replay procedure, never init-control',
      );
  } finally {
    await database.onApplicationShutdown();
  }
  await control.initialize();
  await control.records();
  process.stdout.write(
    `PASS: shared control checkpoint initialized with key ID ${config.SHARED_CONTROL_ACTIVE_KEY_ID} at ${new Date().toISOString()}; Shared features remain gated by the security acceptance reference.\n`,
  );
  process.exit(0);
}
if (!['release', 'restore-replay', 'dispose-evidence'].includes(command ?? ''))
  throw new Error(
    'Expected init-control, release, restore-replay or dispose-evidence',
  );
const spaceId = uuid.parse(args[0]);
if (command === 'restore-replay' && args.length !== 1)
  throw new Error('Expected restore-replay spaceId');
if (
  command === 'dispose-evidence' &&
  (args.length !== 3 ||
    !args[1] ||
    !Number.isFinite(Date.parse(args[1])) ||
    !args[2]?.trim())
)
  throw new Error(
    'Expected dispose-evidence custodyId expired-through-UTC approval-reference',
  );
if (
  command === 'release' &&
  (args.length !== 5 ||
    !Number.isSafeInteger(Number(args[2])) ||
    Number(args[2]) < 1 ||
    Number(args[2]) > 2147483646 ||
    !args[4]?.trim())
)
  throw new Error(
    'Expected release spaceId jobId revision hold-or-obligation-id evidence-reference',
  );
const app = await NestFactory.createApplicationContext(
  AppModule.register(parseEnvironment(process.env)),
  { logger: false },
);
try {
  if (command === 'restore-replay') {
    const kind = (
      await app
        .get(DatabaseService)
        .client.sharedCustody.findUniqueOrThrow({ where: { spaceId } })
    ).kind;
    if (kind === 'COMPANY')
      throw new Error(
        'Company restore requires its separately reviewed domain reconciliation gate',
      );
    const cleanup =
      kind === 'TEAM'
        ? app.get(TeamCleanupService)
        : app.get(ProjectCleanupService);
    const result = await cleanup.restoreRestrictions(spaceId);
    if (!result.complete)
      throw new Error(
        'Restore remains restricted; rerun the bounded replay command',
      );
    process.stdout.write(
      'PASS: restrictive replay completed; deleted private files remain unavailable.\n',
    );
  } else if (command === 'dispose-evidence') {
    const result = await app
      .get(SharedLifecycleService)
      .disposeTerminalEvidence(spaceId, new Date(args[1]!), args[2]!);
    process.stdout.write(
      result.complete
        ? 'PASS: policy-bound terminal evidence disposal completed.\n'
        : 'PENDING: bounded evidence disposal made progress; rerun to complete.\n',
    );
  } else {
    await app
      .get(SharedLifecycleService)
      .release(
        spaceId,
        uuid.parse(args[1]),
        Number(args[2]),
        uuid.parse(args[3]),
        args[4]!,
      );
    process.stdout.write(
      'PASS: revisioned operator release recorded; all other gates remain effective.\n',
    );
  }
} finally {
  await app.close();
}
