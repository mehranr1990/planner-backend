import { permits } from '../../platform/admin/admin-policy.js';
import { withEngagementContext } from '../spaces/public/engagement-availability.js';
import { engagementIdentity } from '../account/public/engagement.js';
import { checkedPolicy } from './engagement-core.js';
import {
  Injectable,
  Inject,
  ForbiddenException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  adminEngagementRoutes as routes,
  ordinaryEngagementRoutes as userRoutes,
} from '@mehran/api-contracts';
import type { RequestActor } from '../../platform/auth/request-actor.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AdminCommand } from '../../platform/admin/admin-command.js';
import { authorizeReportedContent } from '../../platform/admin/reported-content.js';
import {
  moderationTransition as pure_moderationTransition,
  moderationAppeal as pure_moderationAppeal,
  independentAppealReviewer as pure_independentAppealReviewer,
  reportedItemAccess as pure_reportedItemAccess,
  type ModerationState,
} from '../../platform/admin/moderation-policy.js';
import { AdminAccounts } from '../account/public/index.js';
import { AdminSpaces, SharedKernel } from '../spaces/public/index.js';
import { engagementContext } from '../spaces/public/engagement-context.js';
import { reportableTask, reportedTask } from '../tasks/public/moderation.js';
import { reportableNote, reportedNote } from '../notes/public/moderation.js';
import {
  messageReportHint,
  reportedMessage,
} from '../messaging/public/moderation.js';
import { MessagingService } from '../messaging/public/index.js';
import {
  EngagementCore,
  json,
  hash,
  match,
  page,
  paging,
} from './engagement-core.js';
@Injectable()
export class ModerationService {
  constructor(
    @Inject(EngagementCore) private readonly core: EngagementCore,
    @Inject(AdminAccounts) private readonly accounts: AdminAccounts,
    @Inject(AdminSpaces) private readonly spaces: AdminSpaces,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(MessagingService) private readonly messaging: MessagingService,
  ) {}
  async detail(id: string, userId?: string) {
    return this.core.db.client.$transaction(async (tx) => {
      const row = await this.core.case(tx, id, userId);
      const [evidence, history] = await Promise.all([
        tx.p4Evidence.findMany({
          where: { caseId: id!, state: 'ATTACHED' },
          take: 101,
          orderBy: { createdAt: 'asc' },
        }),
        tx.p4CaseEvent.findMany({
          where: { caseId: id!, ...(userId ? { public: true } : {}) },
          take: 101,
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      return json({
        ...row,
        evidence: evidence.slice(0, 100),
        history: history.slice(0, 100),
        truncated: evidence.length > 100 || history.length > 100,
      });
    });
  }
  async report(actor: RequestActor, key: string, raw: unknown) {
    const b = userRoutes['POST moderation/reports'].schema.parse(raw);
    if (
      ['TASK', 'NOTE', 'MESSAGE', 'WORKSPACE'].includes(b.kind) &&
      !(await engagementIdentity(this.core.db.client, actor.userId))
        .emailVerified
    )
      throw new ForbiddenException();
    const save = (inside?: Prisma.TransactionClient) =>
      this.core.userWork(
        actor,
        'moderation.report',
        key,
        json(b),
        async (tx) => {
          await this.core.restricted(tx, actor.userId, 'REPORTING');
          if (
            !(await this.core.rate(tx, [
              { key: 'reports:' + actor.userId, limit: 10, windowMs: 86400000 },
            ]))
          )
            throw new ForbiddenException({ code: 'RATE_LIMITED' });
          const targets: Prisma.ModerationCaseUncheckedCreateInput = {
            sourceKind: b.kind,
            category: b.category,
            description: b.description,
            reporterUserId: actor.userId,
            dedupHash: hash(
              actor.userId +
                ':' +
                b.kind +
                ':' +
                b.targetId +
                ':' +
                b.category +
                ':' +
                new Date().toISOString().slice(0, 10),
            ),
          };
          if (b.kind === 'TASK') {
            const r = await reportableTask(tx, actor, b.targetId);
            targets.taskId = r.id;
            targets.targetUserId = r.createdByUserId;
            targets.targetSpaceId = r.spaceId;
          } else if (b.kind === 'NOTE') {
            const r = await reportableNote(tx, actor, b.targetId);
            targets.noteId = r.id;
            targets.targetUserId = r.createdByUserId;
            targets.targetSpaceId = r.spaceId;
          } else if (b.kind === 'MESSAGE') {
            await messageReportHint(tx, b.targetId);
            targets.messageId = b.targetId;
          } else if (b.kind === 'WORKSPACE') {
            const ctx = await engagementContext(tx, actor, b.targetId);
            targets.targetSpaceId = ctx.spaceId;
            targets.targetScopeId = ctx.scopeId;
          } else {
            await engagementIdentity(tx, b.targetId);
            targets.targetUserId = b.targetId;
          }
          await this.core.lock(tx, 'p4-report-dedup:' + targets.dedupHash);
          const prior = await tx.moderationCase.findUnique({
            where: { dedupHash: targets.dedupHash },
          });
          if (prior) return { id: prior.id };
          const row = await tx.moderationCase.create({ data: targets });
          await this.core.event(
            tx,
            { caseId: row.id },
            'REPORTED',
            { userId: actor.userId },
            null,
            true,
          );
          return { id: row.id };
        },
        inside,
      );
    let result;
    if (b.kind === 'TASK') {
      const hint = await reportableTask(this.core.db.client, actor, b.targetId);
      result = hint.scopeId
        ? await this.kernel.run(
            actor,
            { userIds: [], spaceIds: [hint.spaceId] },
            [
              {
                spaceId: hint.spaceId,
                scopeId: hint.scopeId,
                capability: 'task.read',
                resource: { kind: 'TASK', id: hint.id },
              },
            ],
            save,
          )
        : await save();
    } else if (b.kind === 'MESSAGE')
      result = await this.messaging.withReportableMessage(
        actor,
        b.targetId,
        save,
      );
    else if (b.kind === 'WORKSPACE')
      result = await withEngagementContext(
        this.core.db.client,
        this.kernel,
        actor,
        b.targetId,
        save,
      );
    else result = await save();
    return json(
      await this.core.db.client.moderationCase.findUniqueOrThrow({
        where: { id: (result as { id: string }).id },
      }),
    );
  }
  async appeal(actor: RequestActor, id: string, raw: unknown, key: string) {
    const b =
      userRoutes['POST moderation/reports/:id/appeal'].schema.parse(raw);
    const r = await this.core.userWork(
      actor,
      'moderation.appeal',
      key,
      json({ id, ...b }),
      async (tx) => {
        const row = await this.core.case(tx, id, actor.userId);
        match(row.revision, b.revision);
        const policy = await this.core.policy(tx, 'MODERATION');
        moderationAppeal({
          state: row.state as ModerationState,
          now: new Date(),
          decidedAt: row.decidedAt,
          appealDays: policy.appealDays!,
          alreadyAppealed: !!row.appealedAt,
        });
        await tx.moderationCase.update({
          where: { id: id! },
          data: {
            state: 'APPEALED',
            appealedAt: new Date(),
            appealText: b.text,
            revision: { increment: 1 },
            retentionAt: null,
          },
        });
        await this.core.event(
          tx,
          { caseId: id! },
          'APPEALED',
          { userId: actor.userId },
          b.text,
          true,
        );
        return { id };
      },
    );
    return json(
      await this.core.db.client.moderationCase.findUniqueOrThrow({
        where: { id: (r as { id: string }).id },
      }),
    );
  }
  async handle(
    route: keyof typeof routes,
    id: string | undefined,
    raw: unknown,
    command: AdminCommand,
  ) {
    if (route === 'GET moderation/cases') {
      const q = routes[route].schema.parse(raw);
      return json(
        page(
          await this.core.db.client.moderationCase.findMany({
            where: { ...paging(q), ...(q.state ? { state: q.state } : {}) },
            orderBy: { id: 'asc' },
            take: q.limit + 1,
          }),
          q.limit,
        ),
      );
    }
    if (route === 'GET moderation/cases/:id') return this.detail(id!);
    if (route === 'GET moderation/cases/:id/content')
      return this.core.db.client.$transaction(async (tx) => {
        await command.verify(tx);
        const row = await this.core.case(tx, id!);
        const itemId = row.taskId ?? row.noteId ?? row.messageId;
        reportedItemAccess({
          permitted: true,
          caseId: row.id,
          requestedCaseId: id!,
          reportedItemId: itemId,
          requestedItemId: itemId ?? '',
          state: row.state as ModerationState,
          sourceAvailable: !!itemId,
        });
        const proof = await authorizeReportedContent(
          tx,
          command,
          row.sourceKind,
          itemId!,
        );
        const content = row.taskId
          ? await reportedTask(tx, proof, row.taskId, this.kernel)
          : row.noteId
            ? await reportedNote(tx, proof, row.noteId, this.kernel)
            : await reportedMessage(tx, proof, row.messageId!, this.kernel);
        await tx.adminAuditEvent.update({
          where: { id: command.auditId },
          data: {
            actorAdminId: command.adminId,
            outcome: 'SUCCEEDED',
            metadata: { caseId: row.id, sourceKind: row.sourceKind, itemId },
          },
        });
        return json({ kind: row.sourceKind, itemId, content });
      });
    const result = await this.core.adminWork(command, async (tx) => {
      if (route === 'POST moderation/reports') {
        const b = routes[route].schema.parse(raw);
        if (Number(!!b.targetUserId) + Number(!!b.targetSpaceId) !== 1)
          throw new ConflictException();
        const row = await tx.moderationCase.create({
          data: {
            sourceKind: b.targetUserId ? 'ACCOUNT' : 'WORKSPACE',
            targetUserId: b.targetUserId ?? null,
            targetSpaceId: b.targetSpaceId ?? null,
            reporterAdminId: command.adminId,
            category: b.category,
            description: b.description,
            dedupHash: hash(command.adminId + ':' + command.key),
          },
        });
        await this.core.event(
          tx,
          { caseId: row.id },
          'REPORTED',
          { adminId: command.adminId },
          null,
          true,
        );
        return { id: row.id };
      }
      const row = await this.core.case(tx, id!);
      const b = routes[route].schema.parse(raw);
      if ('revision' in b) match(row.revision, b.revision);
      const appeal = !!row.appealedAt;
      if (appeal) {
        independentAppealReviewer(row.decisionAdminId, command.adminId);
        if (
          row.appealReviewerAdminId &&
          row.appealReviewerAdminId !== command.adminId
        )
          throw new ForbiddenException();
      }
      if (route === 'POST moderation/cases/:id/state') {
        const body = routes[route].schema.parse(raw);
        moderationTransition(row.state as ModerationState, body.state);
        if (
          ['ACTION_TAKEN', 'DISMISSED'].includes(body.state) &&
          !body.publicOutcome
        )
          throw new ConflictException({ code: 'PUBLIC_OUTCOME_REQUIRED' });
        const policy = await this.core.policy(tx, 'MODERATION');
        await tx.moderationCase.update({
          where: { id: id! },
          data: {
            state: body.state,
            ...(body.state === 'DISMISSED'
              ? { restrictionKind: null, restrictionUntil: null }
              : {}),
            priority: body.priority ?? row.priority,
            publicOutcome: body.publicOutcome ?? row.publicOutcome,
            internalOutcome: body.internalOutcome ?? row.internalOutcome,
            revision: { increment: 1 },
            updatedAt: new Date(),
            ...(appeal ? { appealReviewerAdminId: command.adminId } : {}),
            ...(['ACTION_TAKEN', 'DISMISSED'].includes(body.state)
              ? {
                  decidedAt: new Date(),
                  ...(!appeal ? { decisionAdminId: command.adminId } : {}),
                  retentionAt: new Date(
                    Date.now() +
                      policy[
                        body.state === 'DISMISSED'
                          ? 'dismissedRetentionDays'
                          : 'actionRetentionDays'
                      ]! *
                        86400000,
                  ),
                }
              : {}),
          },
        });
        await this.core.event(
          tx,
          { caseId: row.id },
          body.state,
          { adminId: command.adminId },
          body.publicOutcome ?? null,
          !!body.publicOutcome,
        );
      } else if (route === 'POST moderation/cases/:id/penalty') {
        const body = routes[route].schema.parse(raw);
        if (row.state !== 'INVESTIGATING')
          throw new ConflictException({
            code: 'MANUAL_INVESTIGATION_REQUIRED',
          });
        const until = body.until ? new Date(body.until) : null;
        if (
          body.action.startsWith('RESTRICT') &&
          (!until ||
            until <= new Date() ||
            until.getTime() > Date.now() + 30 * 86400000)
        )
          throw new ConflictException();
        if (body.action === 'SUSPEND_ACCOUNT') {
          if (!row.targetUserId) throw new ConflictException();
          await AdminCommand.requireInitiator(
            tx,
            command.adminId,
            'admin.users.suspend',
          );
          const before = await this.accounts.detail(row.targetUserId, tx);
          await this.accounts.change(tx, row.targetUserId, 'suspend', {
            revision: before.revision,
            reason: body.publicReason,
            internalNote: body.reason,
            expiresAt: body.until,
          });
          await command.queueNotice(tx, row.targetUserId, 'ACCOUNT_CHANGED', {
            reason: body.publicReason,
          });
        } else if (body.action === 'SUSPEND_WORKSPACE') {
          if (!row.targetSpaceId || row.sourceKind !== 'WORKSPACE')
            throw new ConflictException();
          await AdminCommand.requireInitiator(
            tx,
            command.adminId,
            'admin.workspaces.suspend',
          );
          const before = await this.spaces.detail(
            row.targetScopeId ?? row.targetSpaceId,
            tx,
          );
          await this.spaces.change(
            tx,
            row.targetScopeId ?? row.targetSpaceId,
            'suspend',
            {
              revision: before.revision,
              reason: body.publicReason,
              expiresAt: body.until,
            },
          );
          if (before.ownerUserId)
            await command.queueNotice(
              tx,
              before.ownerUserId,
              'WORKSPACE_CHANGED',
              {
                reason: body.publicReason,
                workspaceId: row.targetScopeId ?? row.targetSpaceId,
              },
            );
        } else if (body.action === 'ESCALATE_SECURITY') {
          await AdminCommand.requireInitiator(
            tx,
            command.adminId,
            'admin.security.user_login.restrict',
          );
          const operators = await tx.adminUser.findMany({
            where: { active: true, twoFactorEnabled: true },
            select: { id: true, role: true, signInBlockedUntil: true },
            take: 1000,
          });
          for (const op of operators)
            if (
              permits(op.role, 'admin.security.read') &&
              (!op.signInBlockedUntil || op.signInBlockedUntil <= new Date())
            )
              await this.core.notice(
                tx,
                { adminId: op.id, caseId: row.id },
                'MODERATION_SECURITY_ESCALATION',
                'security-escalation:' +
                  row.id +
                  ':' +
                  row.revision +
                  ':' +
                  op.id,
              );
          await tx.adminAuditEvent.create({
            data: {
              action: 'MODERATION_SECURITY_ESCALATION',
              actorAdminId: command.adminId,
              targetUserId: row.targetUserId,
              permission: 'admin.security.user_login.restrict',
              requestId: command.requestId,
              outcome: 'SUCCEEDED',
              reason: body.reason,
              metadata: { caseId: row.id },
            },
          });
        } else if (!row.targetUserId)
          throw new ConflictException({ code: 'ACCOUNT_TARGET_REQUIRED' });
        const policy = await this.core.policy(tx, 'MODERATION');
        await tx.moderationCase.update({
          where: { id: id! },
          data: {
            state: 'ACTION_TAKEN',
            revision: { increment: 1 },
            publicOutcome: body.publicReason,
            decidedAt: new Date(),
            ...(!appeal
              ? { decisionAdminId: command.adminId }
              : { appealReviewerAdminId: command.adminId }),
            ...(body.action.startsWith('RESTRICT')
              ? {
                  restrictionUntil: until,
                  restrictionKind:
                    body.action === 'RESTRICT_REPORTING'
                      ? 'REPORTING'
                      : 'SUPPORT',
                }
              : {}),
            retentionAt: new Date(
              Date.now() + policy.actionRetentionDays! * 86400000,
            ),
          },
        });
        await this.core.event(
          tx,
          { caseId: row.id },
          body.action,
          { adminId: command.adminId },
          body.publicReason,
          true,
        );
        if (row.targetUserId)
          await this.core.notice(
            tx,
            { userId: row.targetUserId, caseId: row.id },
            'MODERATION_OUTCOME',
            'case:' + row.id + ':' + (row.revision + 1),
          );
      } else throw new NotFoundException();
      return { id: row.id };
    });
    return json(
      await this.core.db.client.moderationCase.findUniqueOrThrow({
        where: { id: result.id },
      }),
    );
  }
  async sweep() {
    const now = new Date();
    const rows = await this.core.db.client.moderationCase.findMany({
      where: {
        state: { in: ['ACTION_TAKEN', 'DISMISSED', 'CLOSED'] },
        retentionAt: { lte: now },
        OR: [{ restrictionUntil: null }, { restrictionUntil: { lte: now } }],
      },
      take: 25,
      select: { id: true },
    });
    for (const r of rows)
      await this.core.db.client.moderationCase.delete({ where: { id: r.id } });
    return rows.length > 0;
  }
}

const moderationTransition = (
  ...args: Parameters<typeof pure_moderationTransition>
) => checkedPolicy(() => pure_moderationTransition(...args));

const moderationAppeal = (...args: Parameters<typeof pure_moderationAppeal>) =>
  checkedPolicy(() => pure_moderationAppeal(...args));

const independentAppealReviewer = (
  ...args: Parameters<typeof pure_independentAppealReviewer>
) => checkedPolicy(() => pure_independentAppealReviewer(...args));

const reportedItemAccess = (
  ...args: Parameters<typeof pure_reportedItemAccess>
) => {
  try {
    return pure_reportedItemAccess(...args);
  } catch {
    throw new NotFoundException();
  }
};
