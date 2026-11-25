import 'reflect-metadata';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { OperatorTargetRegistrySchema } from '../../apps/api/dist/platform/operations/backup-operator.js';
import { parseEnvironment } from '../../apps/api/src/bootstrap/environment.ts';
import type { StoragePort } from '../../apps/api/src/platform/storage/storage.port.ts';
import { OperationsControl } from '../../apps/api/dist/platform/operations/operations-control.js';
import { PersonalEvidenceKeys } from '../../apps/api/dist/platform/lifecycle/personal-evidence-keys.js';
import {
  encryptBackup,
  copyEncryptedBackup,
  verifyEncryptedBackup,
} from '../../apps/api/dist/platform/operations/encrypted-backup.js';

// This operator console is never reachable from HTTP. Paths, keys and target
// connection settings come from protected local provisioning, never Admin input.
const config = parseEnvironment(process.env),
  command = process.argv[2],
  id = process.argv[3];
let app: Awaited<ReturnType<typeof application>> | undefined;
async function application(environment = config) {
  const { NestFactory } = await import('@nestjs/core'),
    { AppModule } = await import('../../apps/api/dist/app.module.js');
  return NestFactory.createApplicationContext(AppModule.register(environment), {
    logger: false,
  });
}
async function key() {
  const name = process.env.BACKUP_ENCRYPTION_KEY_FILE;
  if (!name) throw new Error('Configure the separate encryption key file');
  const stat = await fs.lstat(name);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > 128 ||
    (process.platform !== 'win32' && stat.mode & 0o077)
  )
    throw new Error('Unsafe key file');
  const bytes = Buffer.from(
    (await fs.readFile(name, 'utf8')).trim(),
    'base64url',
  );
  if (bytes.length !== 32) throw new Error('Invalid encryption key');
  return bytes;
}
async function target(reference: string) {
  const registry = process.env.RESTORE_TARGET_REGISTRY_FILE;
  if (!registry) throw new Error('Operator target registry required');
  const stat = await fs.lstat(registry);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768)
    throw new Error('Unsafe registry');
  const entries = OperatorTargetRegistrySchema.parse(
      JSON.parse(await fs.readFile(registry, 'utf8')),
    ),
    entry = entries[reference];
  if (!entry) throw new Error('Unregistered restore target');
  const { parseEnv } = await import('node:util');
  const restored = parseEnvironment(
    parseEnv(await fs.readFile(entry.environmentFile, 'utf8')),
  );
  const a = new URL(config.DATABASE_URL),
    b = new URL(restored.DATABASE_URL);
  if (
    a.hostname === b.hostname &&
    a.port === b.port &&
    a.pathname === b.pathname
  )
    throw new Error(
      'Restore verification requires a distinct isolated database',
    );
  const original = path.resolve(config.STORAGE_ROOT),
    destination = path.resolve(restored.STORAGE_ROOT);
  if (
    original === destination ||
    original.startsWith(destination + path.sep) ||
    destination.startsWith(original + path.sep)
  )
    throw new Error('Restore file roots overlap');
  if (
    !restored.OPERATIONS_CONTROL_ROOT ||
    (config.OPERATIONS_CONTROL_ROOT &&
      path.resolve(restored.OPERATIONS_CONTROL_ROOT) ===
        path.resolve(config.OPERATIONS_CONTROL_ROOT))
  )
    throw new Error(
      'Isolated target needs its own independent operational status',
    );
  // Current erasure/shared controls are separately mounted, never restored from
  // control.tar.gz. Matching canonical roots prove the registry did not roll back them.
  if (
    path.resolve(restored.ERASURE_CONTROL_ROOT!) !==
      path.resolve(config.ERASURE_CONTROL_ROOT!) ||
    !config.SHARED_CONTROL_ROOT ||
    !restored.SHARED_CONTROL_ROOT ||
    path.resolve(restored.SHARED_CONTROL_ROOT) !==
      path.resolve(config.SHARED_CONTROL_ROOT)
  )
    throw new Error('Current independent controls must be mounted');
  return restored;
}
try {
  if (command === 'status' || command === 'emergency-pause') {
    // Works with PostgreSQL/API offline. No DB bootstrap, credentials or secrets.
    const control = new OperationsControl(config);
    if (command === 'emergency-pause') {
      if (!/^[a-f0-9-]{36}$/i.test(id ?? ''))
        throw new Error('Run ID required');
      await control.write('MAINTENANCE', id!);
    }
    const state = await control.status();
    process.stdout.write(
      JSON.stringify(state ?? { state: 'UNCONFIGURED' }) + '\n',
    );
  } else {
    if (
      command !== 'backup-next' &&
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        id ?? '',
      )
    )
      throw new Error('Invalid run ID');
    const { BackupRuns } =
        await import('../../apps/api/dist/platform/operations/backup-runs.js'),
      { BackupOperator } =
        await import('../../apps/api/dist/platform/operations/backup-operator.js'),
      { DatabaseService } =
        await import('../../apps/api/dist/platform/database/database.service.js');
    app = await application();
    const runs = app.get(BackupRuns),
      operator = app.get(BackupOperator),
      db = app.get(DatabaseService),
      keys = new PersonalEvidenceKeys(config);
    if (command === 'backup-next') {
      const next = await db.client.adminBackupRun.findFirst({
        where: { state: 'QUEUED' },
        orderBy: { createdAt: 'asc' },
      });
      if (next) {
        const run = await runs.claim('backup', next.id);
        const capture = spawnSync('sh', [path.resolve('deploy/backup.sh')], {
          env: {
            ...process.env,
            PLATFORM_BACKUP_REQUEST_ID: run.id,
            PLATFORM_BACKUP_OPERATOR_LEASE_ID: run.operatorLeaseId!,
          },
          stdio: 'ignore',
          timeout: 3500000,
        });
        if (
          capture.status !== 0 ||
          (
            await db.client.adminBackupRun.findUniqueOrThrow({
              where: { id: run.id },
            })
          ).state !== 'VERIFIED'
        ) {
          await operator.failed('backup', run.id, run.operatorLeaseId!);
          throw new Error('Coordinated backup failed');
        }
        process.stdout.write(
          'PASS: queued backup captured, encrypted, copied and verified by the fixed operator procedure.\n',
        );
      } else process.stdout.write('No queued backup.\n');
    } else if (command === 'backup-seal') {
      const source = process.argv[4],
        local = process.env.BACKUP_LOCAL_SEALED_ROOT,
        remote = process.env.BACKUP_OFFHOST_ROOT,
        approval = process.env.BACKUP_OFFHOST_APPROVAL;
      if (!source || !local || !remote || !approval)
        throw new Error(
          'Provision sealed and independently approved off-host roots',
        );
      const from = path.resolve(local),
        to = path.resolve(remote);
      if (
        from === to ||
        to.startsWith(from + path.sep) ||
        from.startsWith(to + path.sep)
      )
        throw new Error('Off-host roots overlap');
      const inheritedLease = process.env.PLATFORM_BACKUP_OPERATOR_LEASE_ID;
      const run = inheritedLease
        ? await db.client.adminBackupRun.findUniqueOrThrow({
            where: { id: id! },
          })
        : await runs.claim('backup', id!);
      if (
        inheritedLease &&
        (run.state !== 'RUNNING' ||
          run.operatorLeaseId !== inheritedLease ||
          !run.leaseUntil ||
          run.leaseUntil <= new Date())
      )
        throw new Error('Backup capture lease changed');
      try {
        const encryptionKey = await key(),
          destination = path.join(from, run.id),
          offHost = path.join(to, run.id);
        const bundle = await encryptBackup({
          runId: run.id,
          source,
          destination,
          key: encryptionKey,
          keys,
          expiresNoLaterThan: new Date(
            +run.createdAt +
              ('retentionDays' in run ? run.retentionDays : 0) * 86400000,
          ),
        });
        await copyEncryptedBackup(destination, offHost, encryptionKey, keys);
        await operator.backupVerified(
          run.id,
          run.operatorLeaseId!,
          bundle,
          approval,
        );
      } catch (error) {
        await operator.failed('backup', run.id, run.operatorLeaseId!);
        throw error;
      }
      process.stdout.write(
        'PASS: encrypted backup and approved destination bytes verified; request evidence recorded. Physical failure-domain/expiry checks remain operational gates.\n',
      );
    } else if (command === 'restore-claim') {
      const row = await db.client.adminRestoreRun.findUniqueOrThrow({
        where: { id: id! },
      });
      const restoredConfig = await target(row.targetReference); // before claiming or maintenance effects
      if (
        row.mode === 'RESTORE' &&
        (!config.OPERATIONS_CONTROL_ROOT ||
          !(await app.get(OperationsControl).status()))
      )
        throw new Error('Independent operational status required');
      const run = await runs.claim('restore', id!);
      await new OperationsControl(restoredConfig).write('RESTORING', run.id);
      if ('mode' in run && run.mode === 'RESTORE')
        await app.get(OperationsControl).write('RESTORING', run.id);
      process.stdout.write(
        'Restore authority claimed for the registered isolated target. Follow the runbook; no database or files were restored by this command.\n',
      );
    } else if (command === 'restore-verify') {
      const row = await db.client.adminRestoreRun.findUniqueOrThrow({
        where: { id: id! },
      });
      if (
        row.state !== 'RUNNING' ||
        !row.operatorLeaseId ||
        !row.leaseUntil ||
        row.leaseUntil <= new Date()
      )
        throw new Error('Current operator lease required');
      const remote = process.env.BACKUP_OFFHOST_ROOT;
      if (!remote) throw new Error('Off-host root required');
      const restoredConfig = await target(row.targetReference),
        bundle = await verifyEncryptedBackup(
          path.join(remote, row.backupId),
          await key(),
          keys,
        );
      if (bundle.runId !== row.backupId)
        throw new Error('Backup identity mismatch');
      const backup = await db.client.adminBackupRun.findUniqueOrThrow({
        where: { id: row.backupId },
      });
      if (
        (backup.evidence as { bundleDigest?: string } | null)?.bundleDigest !==
        createHash('sha256').update(JSON.stringify(bundle)).digest('hex')
      )
        throw new Error('Registered backup differs');
      let restored: Awaited<ReturnType<typeof application>> | undefined;
      try {
        await new OperationsControl(restoredConfig).write('VERIFYING', row.id);
        if (row.mode === 'RESTORE')
          await app.get(OperationsControl).write('VERIFYING', row.id);
        restored = await application(restoredConfig);
        const { PersonalLifecycle } =
            await import('../../apps/api/dist/modules/account/public/index.js'),
          { PrivacyGate } =
            await import('../../apps/api/dist/platform/authorization/privacy-gate.js'),
          { SharedControl } =
            await import('../../apps/api/dist/platform/storage/shared-control.js'),
          { STORAGE_PORT } =
            await import('../../apps/api/dist/platform/storage/storage.port.js');
        const shared = restored.get(SharedControl);
        if (bundle.capturedAt <= (await shared.restoreFloor()))
          throw new Error('Backup predates restrictive checkpoint');
        if (!(await restored.get(PersonalLifecycle).restoreReplay()))
          throw new Error('Restrictive replay incomplete');
        restored.get(PrivacyGate).assert();
        const { QueueControl } =
            await import('../../apps/api/dist/platform/operations/queue-control.js'),
          { IdentityMailService } =
            await import('../../apps/api/dist/platform/auth/mail.service.js');
        await restored.get(QueueControl).verify();
        await restored.get(IdentityMailService).check();
        const restoredDb = restored.get(DatabaseService);
        await restoredDb.checkConnection();
        const migrations = await restoredDb.client.$queryRaw<
          { migration_name: string; checksum: string }[]
        >`SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
        for (const m of migrations)
          if (
            createHash('sha256')
              .update(
                await fs.readFile(
                  path.join(
                    'prisma/migrations',
                    m.migration_name,
                    'migration.sql',
                  ),
                ),
              )
              .digest('hex') !== m.checksum
          )
            throw new Error('Restored migration checksum mismatch');
        const files = await restoredDb.client.storedFile.findMany({
          where: { status: 'READY', purgedAt: null },
          take: 100001,
          select: { objectKey: true, sha256: true, actualSize: true },
        });
        if (files.length > 100000) throw new Error('Restore inventory bound');
        const storage = restored.get<StoragePort>(STORAGE_PORT);
        if (!storage.capacity) throw new Error('Storage readiness unavailable');
        await storage.capacity();
        for (const file of files) {
          if (!file.sha256 || file.actualSize === null)
            throw new Error('Invalid READY metadata');
          const stream = await storage.open(file.objectKey, {
            size: file.actualSize,
            sha256: file.sha256,
            verified: false,
          });
          for await (const chunk of stream) {
            void chunk;
          }
        }
        const current = await shared.currentEvidence(),
          replayDigest = createHash('sha256')
            .update(JSON.stringify(current))
            .digest('hex');
        await operator.restoreVerified(row.id, row.operatorLeaseId, {
          backupId: row.backupId,
          targetReference: row.targetReference,
          bundleDigest: createHash('sha256')
            .update(JSON.stringify(bundle))
            .digest('hex'),
          migrations: migrations.length,
          files: files.length,
          replayDigest,
          readiness: true,
        });
        // Target may reopen only after actual replay, scans and DB checks. Source
        // stays in maintenance for a separately authorized live traffic switch.
        if (restoredConfig.OPERATIONS_CONTROL_ROOT)
          await restored.get(OperationsControl).write('READY', row.id);
      } catch (error) {
        await operator.failed('restore', row.id, row.operatorLeaseId);
        await new OperationsControl(restoredConfig).write('FAILED', row.id);
        if (row.mode === 'RESTORE')
          await app.get(OperationsControl).write('FAILED', row.id);
        throw error;
      } finally {
        await restored?.close();
      }
      process.stdout.write(
        'PASS: isolated target replay, migration checksums, READY bytes and readiness verified; drill evidence recorded. No live traffic switched.\n',
      );
    } else
      throw new Error(
        'Expected status, emergency-pause, backup-next, backup-seal, restore-claim or restore-verify',
      );
  }
} catch {
  process.stderr.write(
    'Operational command failed safely; secrets, paths and private artifacts withheld.\n',
  );
  process.exitCode = 1;
} finally {
  await app?.close();
}
