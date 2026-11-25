import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  ForbiddenException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { z } from 'zod';
import {
  PrivateFileQuerySchema,
  StoragePolicySchema,
} from '@mehran/api-contracts';
import { DatabaseService } from '../database/database.service.js';
import { AdminCommand } from '../admin/admin-command.js';
import { PrivacyGate } from '../authorization/privacy-gate.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import type {
  Prisma,
  AdminStorageCleanupPreview,
} from '../../generated/prisma/client.js';
import {
  STORAGE_PORT,
  StorageFailure,
  type StoragePort,
} from './storage.port.js';
import { FileScanRecords } from './file-scan-records.js';
import { assertFileContentAvailable } from './file-content-policy.js';
export const ADMIN_FILE_SCOPE_AUTHORITY = Symbol('ADMIN_FILE_SCOPE_AUTHORITY');
export const EXPORT_STORAGE_REFERENCES = Symbol('EXPORT_STORAGE_REFERENCES');
export type ExportStorageReferences = (
  tx: Prisma.TransactionClient,
  key: string,
) => Promise<boolean>;
export type AdminFileScopeAuthority = (
  tx: Prisma.TransactionClient,
  command: AdminCommand,
  file: { spaceId: string; scopeId: string | null; ownerUserId: string | null },
) => Promise<void>;

const Target = z.strictObject({
  key: z.uuid(),
  attempt: z.uuid().nullable(),
  size: z.number().int().nonnegative(),
  modifiedAt: z.iso.datetime(),
});
const fingerprint = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
@Injectable()
export class StorageOperations {
  constructor(
    @Inject(EXPORT_STORAGE_REFERENCES)
    private readonly exportReferences: ExportStorageReferences,
    @Inject(ADMIN_FILE_SCOPE_AUTHORITY)
    private readonly scopeAuthority: AdminFileScopeAuthority,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(FileScanRecords) private readonly scans: FileScanRecords,
    @Inject(PrivacyGate) private readonly privacy: PrivacyGate,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  async capacity() {
    if (!this.storage.capacity) throw new ServiceUnavailableException();
    return this.storage.capacity();
  }
  async usage(q: {
    groupBy: 'SPACE' | 'TYPE' | 'DAY';
    spaceId?: string | undefined;
    from?: string | undefined;
    until?: string | undefined;
    limit: number;
  }) {
    if (q.from && q.until && Date.parse(q.from) >= Date.parse(q.until))
      throw new ConflictException({ code: 'INVALID_RANGE' });
    const grouping = {
      SPACE: 'COALESCE("scopeId","spaceId")::text',
      TYPE: '"mimeType"',
      DAY: "to_char(\"createdAt\" AT TIME ZONE 'UTC','YYYY-MM-DD')",
    }[q.groupBy];
    const filter = `FROM "StoredFile" WHERE "purgedAt" IS NULL AND status='READY' AND ($1::uuid IS NULL OR "spaceId"=$1::uuid OR "scopeId"=$1::uuid) AND ($2::timestamptz IS NULL OR "createdAt">=$2::timestamptz) AND ($3::timestamptz IS NULL OR "createdAt"<$3::timestamptz)`;
    const values = [q.spaceId ?? null, q.from ?? null, q.until ?? null];
    const [items, totals] = await this.db.client.$transaction(
      [
        this.db.client.$queryRawUnsafe<
          { key: string; files: bigint; bytes: bigint }[]
        >(
          `SELECT ${grouping} key,count(*) files,COALESCE(sum("actualSize"),0)::bigint bytes ${filter} GROUP BY 1 ORDER BY 1 LIMIT $4`,
          ...values,
          q.limit + 1,
        ),
        this.db.client.$queryRawUnsafe<{ files: bigint; bytes: bigint }[]>(
          `SELECT count(*) files,COALESCE(sum("actualSize"),0)::bigint bytes ${filter}`,
          ...values,
        ),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      total: {
        key: 'TOTAL',
        files: Number(totals[0]!.files),
        bytes: String(totals[0]!.bytes),
      },
      items: items.slice(0, q.limit).map((r) => ({
        key: r.key,
        files: Number(r.files),
        bytes: String(r.bytes),
      })),
      truncated: items.length > q.limit,
    };
  }
  private async referenced(
    tx: Prisma.TransactionClient,
    target: z.infer<typeof Target>,
  ) {
    // Every business file, in-flight upload, export publication and retained
    // export attempt remains protected. Metadata owners keep their own cleanup.
    const file = await tx.storedFile.findUnique({
      where: { objectKey: target.key },
      select: { uploadAttemptId: true },
    });
    if (
      file &&
      (target.attempt === null || file.uploadAttemptId === target.attempt)
    )
      return true;
    return this.exportReferences(tx, target.key);
  }
  private view(r: AdminStorageCleanupPreview) {
    return {
      id: r.id,
      fingerprint: r.fingerprint,
      candidates: z.array(Target).parse(r.targets).length,
      bytes: r.bytes.toString(),
      expiresAt: r.expiresAt.toISOString(),
      state:
        r.state === 'PREVIEW' && r.expiresAt <= new Date()
          ? 'EXPIRED'
          : r.state,
      removed: r.removed,
    };
  }
  async preview(command: AdminCommand) {
    command.require('admin.storage.cleanup');
    this.privacy.assert();
    if (!this.storage.inventory || !this.storage.removeOrphan)
      throw new ServiceUnavailableException({
        code: 'STORAGE_INVENTORY_UNAVAILABLE',
      });
    const inventory = await this.storage.inventory();
    return this.db.client.$transaction(
      (tx) =>
        command.execute(tx, async () => {
          const row = await tx.adminOperationalPolicy.findUniqueOrThrow({
              where: { section: 'STORAGE' },
            }),
            policy = StoragePolicySchema.parse(row.value),
            targets: z.infer<typeof Target>[] = [];
          for (const entry of inventory) {
            const parsed = Target.safeParse(entry);
            if (
              !parsed.success ||
              Date.parse(parsed.data.modifiedAt) >
                Date.now() - policy.cleanupAgeHours * 3600000 ||
              (await this.referenced(tx, parsed.data))
            )
              continue;
            targets.push(parsed.data);
            if (targets.length === 100) break;
          }
          targets.sort((a, b) =>
            (a.key + (a.attempt ?? '')).localeCompare(
              b.key + (b.attempt ?? ''),
            ),
          );
          return this.view(
            await tx.adminStorageCleanupPreview.create({
              data: {
                actorAdminId: command.adminId,
                fingerprint: fingerprint(targets),
                targets,
                bytes: targets.reduce((sum, r) => sum + BigInt(r.size), 0n),
                expiresAt: new Date(Date.now() + 900000),
              },
            }),
          );
        }),
      { timeout: 30000 },
    );
  }
  async cleanup(command: AdminCommand, id: string, expected: string) {
    command.require('admin.storage.cleanup');
    this.privacy.assert();
    if (!this.storage.removeOrphan || !this.storage.inventory)
      throw new ServiceUnavailableException();
    return this.db.client.$transaction(
      (tx) =>
        command.execute(tx, async () => {
          await tx.$queryRaw`SELECT id FROM "AdminStorageCleanupPreview" WHERE id=${id}::uuid FOR UPDATE`;
          const row = await tx.adminStorageCleanupPreview.findUnique({
            where: { id },
          });
          if (!row) throw new NotFoundException();
          if (
            row.actorAdminId !== command.adminId ||
            row.state !== 'PREVIEW' ||
            row.expiresAt <= new Date() ||
            row.fingerprint !== expected
          )
            throw new ConflictException({ code: 'CLEANUP_PREVIEW_CHANGED' });
          const targets = z.array(Target).max(100).parse(row.targets),
            policy = StoragePolicySchema.parse(
              (
                await tx.adminOperationalPolicy.findUniqueOrThrow({
                  where: { section: 'STORAGE' },
                })
              ).value,
            );
          if (fingerprint(targets) !== row.fingerprint)
            throw new ConflictException();
          // Preflight all live references and retention again before the first unlink.
          for (const target of targets) {
            if (
              (await this.referenced(tx, target)) ||
              Date.parse(target.modifiedAt) >
                Date.now() - policy.cleanupAgeHours * 3600000
            )
              throw new ConflictException({
                code: 'CLEANUP_REFERENCE_OR_RETENTION_CHANGED',
              });
          }
          const inventory = await this.storage.inventory!();
          let removed = 0;
          for (const target of targets) {
            this.privacy.assert();
            await command.verify(tx);
            // A crash after unlink leaves a missing orphan, safe to acknowledge on retry.
            if (
              inventory.some(
                (v) => v.key === target.key && v.attempt === target.attempt,
              )
            )
              await this.storage.removeOrphan!(
                target.key,
                target.attempt,
                target,
              );
            removed++;
          }
          return this.view(
            await tx.adminStorageCleanupPreview.update({
              where: { id },
              data: { state: 'APPLIED', removed },
            }),
          );
        }),
      { timeout: 30000 },
    );
  }
  async privateFile(
    command: AdminCommand,
    id: string,
    query: z.infer<typeof PrivateFileQuerySchema>,
  ) {
    command.require('admin.storage.private_files.read');
    this.privacy.assert();
    assertFileContentAvailable(this.config);
    const check = async (tx: Prisma.TransactionClient) => {
      await command.verify(tx);
      this.privacy.assert();
      const admin = await tx.adminUser.findUniqueOrThrow({
        where: { id: command.adminId },
        select: { role: true },
      });
      if (admin.role !== 'SUPER_ADMIN') throw new ForbiddenException();
      const file = await tx.storedFile.findFirst({
        where: {
          id,
          spaceId: query.spaceId,
          scopeId: query.scopeId ?? null,
          status: 'READY',
          purgedAt: null,
        },
      });
      if (!file || !file.sha256 || file.actualSize === null)
        throw new NotFoundException();
      await this.scopeAuthority(tx, command, file);
      return file;
    };
    const file = await this.db.client.$transaction(async (tx) => {
      const file = await check(tx);
      await tx.adminAuditEvent.update({
        where: { id: command.auditId },
        data: {
          actorAdminId: command.adminId,
          targetSpaceId: file.spaceId,
          metadata: {
            fileId: file.id,
            scopeId: file.scopeId,
            disposition: query.disposition,
          },
        },
      });
      return file;
    });
    let source: Readable;
    try {
      source = await this.storage.open(
        file.objectKey,
        await this.scans.expectation(file),
      );
    } catch (error) {
      if (error instanceof StorageFailure)
        throw new ServiceUnavailableException({
          code: 'FILE_CONTENT_UNAVAILABLE',
        });
      throw error;
    }
    const database = this.db.client;
    const stream = Readable.from(
      (async function* () {
        try {
          for await (const chunk of source) {
            const current = await check(database);
            if (
              current.revision !== file.revision ||
              current.sha256 !== file.sha256
            )
              throw new NotFoundException();
            yield chunk;
          }
        } finally {
          source.destroy();
        }
      })(),
    );
    // Inline is limited to safe raster formats. Every other type downloads.
    return {
      stream,
      size: file.actualSize!,
      mimeType: ['image/png', 'image/jpeg'].includes(file.mimeType)
        ? file.mimeType
        : 'application/octet-stream',
      disposition:
        query.disposition === 'inline' &&
        ['image/png', 'image/jpeg'].includes(file.mimeType)
          ? 'inline'
          : 'attachment',
    };
  }
}
