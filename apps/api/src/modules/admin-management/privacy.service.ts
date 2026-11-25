import {
  Inject,
  Injectable,
  ForbiddenException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../platform/database/database.service.js';
import { AdminCommand } from '../../platform/admin/admin-command.js';
import { PersonalLifecycle } from '../account/public/index.js';
import { SharedKernel } from '../spaces/public/index.js';
import { TeamsService } from '../teams/public/index.js';
import { CompaniesService } from '../companies/public/index.js';
import {
  AdminDeletionRequestSchema,
  AdminDeletionImpactSchema,
} from '@mehran/api-contracts';
import type {
  Prisma,
  AdminPrivacyDeletionRequest,
} from '../../generated/prisma/client.js';

@Injectable()
export class AdminPrivacyService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PersonalLifecycle) private readonly personal: PersonalLifecycle,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(TeamsService) private readonly teams: TeamsService,
    @Inject(CompaniesService) private readonly companies: CompaniesService,
  ) {}
  private view(row: AdminPrivacyDeletionRequest) {
    return {
      id: row.id,
      kind: row.kind,
      targetId: row.targetId,
      expectedRevision: row.expectedRevision,
      impactFingerprint: row.impactFingerprint,
      impact: AdminDeletionImpactSchema.parse(row.impact),
      recoveryDays: row.recoveryDays,
      state:
        ['REQUESTED', 'APPROVED'].includes(row.state) &&
        row.expiresAt <= new Date()
          ? 'EXPIRED'
          : row.state,
      requesterAdminId: row.requesterAdminId,
      approverAdminId: row.approverAdminId,
      reason: row.reason,
      expiresAt: row.expiresAt.toISOString(),
      resultJobId: row.resultJobId,
      job: null,
    };
  }
  async detail(id: string) {
    const row = await this.db.client.adminPrivacyDeletionRequest.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException();
    return {
      ...this.view(row),
      job: row.resultJobId
        ? await (row.kind === 'ACCOUNT'
            ? this.personal.adminDeletionStatus(row.resultJobId)
            : this.kernel.adminDeletionStatus(row.resultJobId))
        : null,
    };
  }
  async history(id: string) {
    await this.detail(id);
    return {
      items: (
        await this.db.client.adminPrivacyDeletionHistory.findMany({
          where: { requestId: id },
          select: {
            id: true,
            state: true,
            actorAdminId: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 100,
        })
      ).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    };
  }
  private async lock(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM "AdminPrivacyDeletionRequest" WHERE id=${id}::uuid FOR UPDATE`;
    const row = await tx.adminPrivacyDeletionRequest.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  private async preview(
    tx: Prisma.TransactionClient,
    kind: string,
    id: string,
  ) {
    if (kind === 'ACCOUNT') return this.personal.adminDeletionPreview(tx, id);
    const state = await this.kernel.adminDeletionPreview(tx, id),
      profile =
        kind === 'TEAM'
          ? await this.teams.adminMetadata(tx, id)
          : await this.companies.adminMetadata(tx, id);
    if (!profile || state.kind !== kind) throw new NotFoundException();
    return { ...state, revision: profile.revision };
  }
  private async approved(
    tx: Prisma.TransactionClient,
    id: string,
    requester: string,
  ) {
    const row = await this.lock(tx, id);
    if (
      row.state !== 'APPROVED' ||
      row.requesterAdminId !== requester ||
      !row.approverAdminId
    )
      throw new ForbiddenException();
    if (row.expiresAt <= new Date())
      throw new ConflictException({ code: 'DELETION_APPROVAL_EXPIRED' });
    await AdminCommand.requireInitiator(
      tx,
      row.approverAdminId,
      'admin.privacy.deletions.approve',
    );
    return row;
  }
  private async complete(
    tx: Prisma.TransactionClient,
    row: AdminPrivacyDeletionRequest,
    command: AdminCommand,
    jobId: string,
  ) {
    await tx.adminAuditEvent.update({
      where: { id: command.auditId },
      data:
        row.kind === 'ACCOUNT'
          ? { targetUserId: row.targetId }
          : { targetSpaceId: row.targetId },
    });
    const next = await tx.adminPrivacyDeletionRequest.update({
      where: { id: row.id },
      data: { state: 'APPLIED', resultJobId: jobId },
    });
    await tx.adminPrivacyDeletionHistory.create({
      data: {
        requestId: row.id,
        actorAdminId: command.adminId,
        state: 'APPLIED',
      },
    });
    return this.view(next);
  }
  async mutate(
    command: AdminCommand,
    operation: string,
    id: string | undefined,
    body: unknown,
  ) {
    command.require(
      operation === 'recover'
        ? 'admin.privacy.accounts.recover'
        : 'admin.privacy.deletions.' +
            (operation === 'request' ? 'request' : operation),
    );
    if (operation === 'execute') return this.execute(command, id!);
    return this.db.client.$transaction((tx) =>
      command.execute(tx, async () => {
        if (operation === 'request') {
          const input = AdminDeletionRequestSchema.parse(body),
            preview = await this.preview(tx, input.kind, input.targetId);
          if (!preview.eligible || preview.revision !== input.revision)
            throw new ConflictException({
              code: 'DELETION_INELIGIBLE_OR_STALE',
            });
          const now = (
            await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
          )[0]!.now;
          const row = await tx.adminPrivacyDeletionRequest.create({
            data: {
              kind: input.kind,
              targetId: input.targetId,
              targetUserId: input.kind === 'ACCOUNT' ? input.targetId : null,
              targetTeamId: input.kind === 'TEAM' ? input.targetId : null,
              targetCompanyId: input.kind === 'COMPANY' ? input.targetId : null,
              expectedRevision: input.revision,
              recoveryDays: input.recoveryDays,
              impactFingerprint: preview.fingerprint,
              impact:
                'dependencies' in preview
                  ? {
                      members: null,
                      ownedBoundaries: preview.dependencies.length,
                      children: null,
                      ...(input.kind === 'ACCOUNT' && preview.policyVersion
                        ? {
                            retentionAcknowledged: input.retentionAcknowledged,
                            personalPolicyVersion: preview.policyVersion,
                          }
                        : {}),
                    }
                  : {
                      members: preview.members,
                      ownedBoundaries: 0,
                      children: preview.children,
                    },
              requesterAdminId: command.adminId,
              reason: input.reason,
              createdAt: now,
              expiresAt: new Date(+now + 1800000),
            },
          });
          await tx.adminPrivacyDeletionHistory.create({
            data: {
              requestId: row.id,
              actorAdminId: command.adminId,
              state: 'REQUESTED',
            },
          });
          return this.view(row);
        }
        const row = await this.lock(tx, id!);
        if (operation === 'recover') {
          if (
            row.kind !== 'ACCOUNT' ||
            row.state !== 'APPLIED' ||
            !row.resultJobId
          )
            throw new ConflictException({ code: 'DELETION_NOT_RECOVERABLE' });
          await this.personal.adminRecoverInside(tx, command, row.resultJobId);
          const next = await tx.adminPrivacyDeletionRequest.update({
            where: { id: row.id },
            data: { state: 'RECOVERED' },
          });
          await tx.adminPrivacyDeletionHistory.create({
            data: {
              requestId: row.id,
              actorAdminId: command.adminId,
              state: 'RECOVERED',
            },
          });
          return this.view(next);
        }
        if (
          operation !== 'approve' ||
          row.state !== 'REQUESTED' ||
          row.requesterAdminId === command.adminId
        )
          throw new ForbiddenException();
        if (row.expiresAt <= new Date())
          throw new ConflictException({ code: 'DELETION_APPROVAL_EXPIRED' });
        const input = body as {
          targetId: string;
          impactFingerprint: string;
          recoveryDays: number;
          reason: string;
        };
        if (
          input.targetId !== row.targetId ||
          input.impactFingerprint !== row.impactFingerprint ||
          input.recoveryDays !== row.recoveryDays
        )
          throw new ConflictException({
            code: 'DELETION_CONFIRMATION_MISMATCH',
          });
        await AdminCommand.requireInitiator(
          tx,
          row.requesterAdminId,
          'admin.privacy.deletions.request',
        );
        const next = await tx.adminPrivacyDeletionRequest.update({
          where: { id: row.id },
          data: {
            state: 'APPROVED',
            approverAdminId: command.adminId,
            approvalReason: input.reason,
          },
        });
        await tx.adminPrivacyDeletionHistory.create({
          data: {
            requestId: row.id,
            actorAdminId: command.adminId,
            state: 'APPROVED',
          },
        });
        return this.view(next);
      }),
    );
  }
  private async execute(command: AdminCommand, id: string) {
    const hint = await this.db.client.adminPrivacyDeletionRequest.findUnique({
      where: { id },
    });
    if (!hint) throw new NotFoundException();
    const narrow = new AdminCommand(
      command.adminId,
      command.sessionId,
      hint.kind === 'ACCOUNT'
        ? 'admin.privacy.accounts.delete'
        : 'admin.privacy.workspaces.delete',
      command.requestId,
      command.auditId,
      command.key,
      command.input,
    );
    if (hint.kind === 'ACCOUNT')
      return this.db.client.$transaction(
        (tx) =>
          command.execute(tx, async () => {
            const row = await this.approved(tx, id, command.adminId);
            const impact = AdminDeletionImpactSchema.parse(row.impact);
            if (!impact.retentionAcknowledged || !impact.personalPolicyVersion)
              throw new ConflictException({
                code: 'RETENTION_REVIEW_REQUIRED',
              });
            const job = await this.personal.adminDeleteInside(
              tx,
              narrow,
              row.targetId,
              {
                policyVersion: impact.personalPolicyVersion,
                retentionAcknowledged: impact.retentionAcknowledged,
                revision: row.expectedRevision,
                fingerprint: row.impactFingerprint,
                recoveryDays: row.recoveryDays,
                requestId: row.id,
                reason: row.reason,
              },
            );
            return this.complete(tx, row, command, job.jobId);
          }),
        { timeout: 30000 },
      );
    let authorized: AdminPrivacyDeletionRequest | undefined;
    const authorize = async (tx: Prisma.TransactionClient) => {
      await command.verify(tx);
      authorized = await this.approved(tx, id, command.adminId);
      return {
        revision: authorized.expectedRevision,
        fingerprint: authorized.impactFingerprint,
        recoveryDays: authorized.recoveryDays,
      };
    };
    const complete = async (tx: Prisma.TransactionClient, jobId: string) =>
      this.complete(tx, authorized!, command, jobId);
    return hint.kind === 'TEAM'
      ? this.teams.adminDelete(narrow, hint.targetId, authorize, complete)
      : this.companies.adminDelete(narrow, hint.targetId, authorize, complete);
  }
}
