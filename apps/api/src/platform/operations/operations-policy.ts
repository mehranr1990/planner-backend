import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  OperationsPolicyInputSchema,
  OperationsPolicyValueSchema,
  HealthPolicySchema,
  JobPolicySchema,
  StoragePolicySchema,
  BackupPolicySchema,
} from '@mehran/api-contracts';
import { DatabaseService } from '../database/database.service.js';
import { AdminCommand } from '../admin/admin-command.js';
import type { Prisma } from '../../generated/prisma/client.js';

export const policySchemas = {
  HEALTH: HealthPolicySchema,
  JOBS: JobPolicySchema,
  STORAGE: StoragePolicySchema,
  BACKUP: BackupPolicySchema,
};
@Injectable()
export class OperationsPolicy {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async check(command: AdminCommand) {
    command.require('admin.health.check');
    return this.db.client.$transaction((tx) =>
      command.execute(tx, async () => ({ checked: true })),
    );
  }
  async read<K extends keyof typeof policySchemas>(
    section: K,
    tx: Prisma.TransactionClient = this.db.client,
  ) {
    const row = await tx.adminOperationalPolicy.findUniqueOrThrow({
      where: { section },
    });
    return {
      revision: row.revision,
      value: policySchemas[section].parse(row.value),
    };
  }
  async list() {
    return {
      items: (
        await this.db.client.adminOperationalPolicy.findMany({
          orderBy: { section: 'asc' },
        })
      ).map((r) => ({
        ...r,
        value: OperationsPolicyValueSchema.parse(r.value),
      })),
    };
  }
  private view(r: {
    id: string;
    section: string;
    expectedRevision: number;
    value: Prisma.JsonValue;
    impact: string;
    state: string;
    expiresAt: Date;
  }) {
    return {
      id: r.id,
      section: r.section,
      expectedRevision: r.expectedRevision,
      value: r.value,
      impact: r.impact,
      state:
        r.state === 'PREVIEW' && r.expiresAt <= new Date()
          ? 'EXPIRED'
          : r.state,
      expiresAt: r.expiresAt.toISOString(),
    };
  }
  async preview(command: AdminCommand, body: unknown) {
    command.require('admin.operations.policy.publish');
    const input = OperationsPolicyInputSchema.parse(body);
    if (
      input.section === 'HEALTH' &&
      input.value.rules.some(
        (r) =>
          r.silencedUntil &&
          (Date.parse(r.silencedUntil) <= Date.now() ||
            Date.parse(r.silencedUntil) > Date.now() + 7 * 86400000),
      )
    )
      throw new ConflictException({ code: 'ALERT_SILENCE_BOUND' });
    return this.db.client.$transaction((tx) =>
      command.execute(tx, async () => {
        const prior = await tx.adminOperationalPolicy.findUniqueOrThrow({
          where: { section: input.section },
        });
        if (prior.revision !== input.revision)
          throw new ConflictException({ code: 'STALE_REVISION' });
        const impact =
          input.section === 'JOBS'
            ? 'Future authoritative sweep cadence and queue evidence retention; no domain schedules or payloads change. Existing domain expiry remains authoritative.'
            : input.section === 'STORAGE'
              ? 'Future upload admission and orphan eligibility only. No quota-driven customer deletion. Existing upload/finalize paths recheck the policy.'
              : input.section === 'BACKUP'
                ? 'Future backup requests and restore drills only. Signed retention deadlines and key custody remain unchanged.'
                : 'Future operational alert thresholds, severity, channels, repeats and bounded silence; existing incident history is preserved.';
        return this.view(
          await tx.adminOperationalPolicyDraft.create({
            data: {
              section: input.section,
              expectedRevision: input.revision,
              value: input.value,
              impact,
              requesterAdminId: command.adminId,
              expiresAt: new Date(Date.now() + 900000),
            },
          }),
        );
      }),
    );
  }
  async publish(command: AdminCommand, id: string) {
    command.require('admin.operations.policy.publish');
    return this.db.client.$transaction((tx) =>
      command.execute(tx, async () => {
        await tx.$queryRaw`SELECT id FROM "AdminOperationalPolicyDraft" WHERE id=${id}::uuid FOR UPDATE`;
        const draft = await tx.adminOperationalPolicyDraft.findUnique({
          where: { id },
        });
        if (!draft) throw new NotFoundException();
        if (
          draft.state !== 'PREVIEW' ||
          draft.expiresAt <= new Date() ||
          draft.requesterAdminId !== command.adminId
        )
          throw new ConflictException({
            code: 'POLICY_PREVIEW_EXPIRED_OR_INELIGIBLE',
          });
        const value = policySchemas[
          draft.section as keyof typeof policySchemas
        ].parse(draft.value);
        const changed = await tx.adminOperationalPolicy.updateMany({
          where: { section: draft.section, revision: draft.expectedRevision },
          data: { value, revision: { increment: 1 } },
        });
        if (changed.count !== 1)
          throw new ConflictException({ code: 'STALE_REVISION' });
        await command.recordChange(
          tx,
          { revision: draft.expectedRevision },
          { revision: draft.expectedRevision + 1, section: draft.section },
        );
        return this.view(
          await tx.adminOperationalPolicyDraft.update({
            where: { id },
            data: { state: 'PUBLISHED' },
          }),
        );
      }),
    );
  }
}
