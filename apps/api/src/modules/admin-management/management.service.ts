import { EmailDiagnosticsService } from './email-diagnostics.service.js';
import {
  Inject,
  Injectable,
  ForbiddenException,
  HttpException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { AdminAccounts } from '../account/public/index.js';
import {
  AdminSpaces,
  AdminCollaboration,
  SharedKernel,
} from '../spaces/public/index.js';
import { TeamsService } from '../teams/public/index.js';
import { CompaniesService } from '../companies/public/index.js';
import { AdminCommand } from '../../platform/admin/admin-command.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import * as contracts from '@mehran/api-contracts';
import { AdminService } from '../../platform/admin/admin.service.js';
import { permits } from '../../platform/admin/admin-policy.js';
import { dashboardRange } from '../../platform/admin/management-policy.js';
import { DatabaseService } from '../../platform/database/database.service.js';
import type { ContextRequest } from '../../bootstrap/request-context.js';
import {
  adminManagementRoutes,
  AdminBulkPreviewSchema,
  AdminBulkExecuteSchema,
  AdminDashboardQuerySchema,
  AdminPageSchema,
} from '@mehran/api-contracts';
import { ZodValidationPipe } from '../../bootstrap/zod-validation.pipe.js';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';

type Route = keyof typeof adminManagementRoutes;
const targetId = z.uuid();
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
@Injectable()
export class ManagementService {
  private async workspaceDetail(
    id: string,
    tx: Prisma.TransactionClient = this.db.client,
  ) {
    const data = await this.spaces.detail(id, tx);
    return {
      ...data,
      profile:
        data.type === 'TEAM'
          ? await this.teams.adminMetadata(tx, id)
          : data.type === 'COMPANY'
            ? await this.companies.adminMetadata(tx, id)
            : null,
    };
  }
  constructor(
    @Inject(EmailDiagnosticsService)
    private readonly emailDiagnostics: EmailDiagnosticsService,
    @Inject(TeamsService) private readonly teams: TeamsService,
    @Inject(CompaniesService) private readonly companies: CompaniesService,
    @Inject(AdminCollaboration)
    private readonly collaboration: AdminCollaboration,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AdminAccounts) private readonly accounts: AdminAccounts,
    @Inject(AdminSpaces) private readonly spaces: AdminSpaces,
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(DatabaseService) private readonly db: DatabaseService,
  ) {}
  async handle(route: Route, id: string | undefined, req: ContextRequest) {
    const spec = adminManagementRoutes[route];
    const write = !route.startsWith('GET') || route.endsWith('/export');
    const event =
      write || route.startsWith('GET system-emails')
        ? await this.db.client.adminAuditEvent.create({
            data: {
              action: route,
              outcome: 'ATTEMPTED',
              permission: spec.permission,
              requestId: req.id,
            },
          })
        : null;
    let actor: Awaited<ReturnType<AdminService['authorize']>> | undefined;
    try {
      actor = await this.admin.authorize(req.headers, spec.permission);
      if (write && !route.endsWith('/export')) this.admin.requireRecent(actor);
      const input = new ZodValidationPipe(spec.schema).transform(
        route.startsWith('GET') ? req.query : req.body,
      );
      if (id) id = new ZodValidationPipe(targetId).transform(id) as string;
      if (event)
        await this.db.client.adminAuditEvent.update({
          where: { id: event.id },
          data: {
            actorAdminId: actor.user.id,
            ...(!route.startsWith('GET') &&
            input &&
            typeof input === 'object' &&
            'reason' in input
              ? {
                  reason: String(input.reason),
                  internalNote:
                    'internalNote' in input &&
                    typeof input.internalNote === 'string'
                      ? input.internalNote
                      : null,
                }
              : {}),
            ...(id && !route.includes('system-emails')
              ? route.includes('users/')
                ? { targetUserId: id }
                : { targetSpaceId: id }
              : {}),
          },
        });
      const command = () =>
        new AdminCommand(
          actor!.user.id,
          actor!.session.id,
          spec.permission,
          req.id,
          event!.id,
          typeof req.headers['idempotency-key'] === 'string'
            ? req.headers['idempotency-key']
            : '',
          json({ route, id: id ?? null, input }),
        );
      if (route.includes('system-emails')) {
        this.admin.requireRecent(actor);
        new ZodValidationPipe(contracts.EmptyQuerySchema).transform(
          route.startsWith('GET') ? {} : req.query,
        );
        const result =
          route === 'GET system-emails'
            ? await this.emailDiagnostics.list(
                actor.user.id,
                contracts.AdminEmailQuerySchema.parse(input),
              )
            : route === 'GET system-emails/:id'
              ? await this.emailDiagnostics.detail(id!)
              : await this.emailDiagnostics.retry(
                  command(),
                  id!,
                  contracts.AdminEmailRetrySchema.parse(input),
                );
        if (route.startsWith('GET'))
          await this.admin.auditOutcome(event!.id, 'SUCCEEDED', actor.user.id);
        return result;
      }
      if (route === 'POST users/:id/resend-verification') {
        new ZodValidationPipe(contracts.EmptyQuerySchema).transform(req.query);
        return this.emailDiagnostics.resendVerification(
          command(),
          id!,
          contracts.AdminReasonSchema.parse(input),
        );
      }
      if (route === 'GET workspaces/retention-policies')
        return this.spaces.retentionCatalog(
          contracts.AdminWorkspaceRetentionQuerySchema.parse(input),
        );
      if (route === 'POST workspaces') {
        const body = contracts.AdminWorkspaceCreateSchema.parse(input),
          cmd = command();
        if (body.type === 'TEAM')
          await this.teams.adminCreate(cmd, body.ownerUserId, body);
        else await this.companies.adminCreate(cmd, body.ownerUserId, body);
        return this.workspaceDetail(body.id);
      }
      if (route === 'PATCH workspaces/:id') {
        const body = contracts.AdminWorkspaceProfileSchema.parse(input),
          cmd = command();
        return this.kernel.administer(
          cmd,
          id!,
          [],
          async (tx, attribution, audit) => {
            const workspace = await this.spaces.detail(id!, tx);
            const changed =
              workspace.type === 'TEAM'
                ? await this.teams.adminProfile(tx, cmd, id!, body)
                : await this.companies.adminProfile(tx, cmd, id!, body);
            await this.kernel.adminEffect(
              tx,
              cmd,
              id!,
              attribution,
              audit,
              'workspace.profile',
              id!,
            );
            if (workspace.ownerUserId)
              await tx.adminDelivery.create({
                data: {
                  auditId: event!.id,
                  targetUserId: workspace.ownerUserId,
                  kind: 'WORKSPACE_CHANGED',
                  payload: { workspaceId: id! },
                },
              });
            return json({ id, ...changed });
          },
          { action: 'workspace.profile', resourceId: id! },
        );
      }
      if (route === 'POST workspaces/:id/owner-transfers')
        return this.collaboration.handover(
          command(),
          id!,
          contracts.AdminHandoverInitiateSchema.parse(input),
        );
      if (route === 'POST workspaces/:id/memberships')
        return this.collaboration.invitation(
          command(),
          id!,
          contracts.AdminMemberAddSchema.parse(input),
        );
      if (
        route === 'POST workspaces/:id/memberships/remove' ||
        route === 'PATCH workspaces/:id/memberships/role'
      )
        return this.collaboration.membership(
          command(),
          id!,
          contracts.AdminMemberChangeSchema.parse(input),
          route.startsWith('POST'),
        );
      if (
        route === 'POST workspaces/:id/invitations/cancel' ||
        route === 'POST workspaces/:id/invitations/resend'
      )
        return this.collaboration.invitationAction(
          command(),
          id!,
          contracts.AdminInvitationActionSchema.parse(input),
          route.endsWith('resend'),
        );
      if (
        route === 'POST workspaces/:id/suspend' ||
        route === 'POST workspaces/:id/reactivate'
      ) {
        const workspace = await this.spaces.detail(id!);
        if (workspace.type !== 'PERSONAL') {
          const body = contracts.AdminSuspensionSchema.parse(input),
            cmd = command();
          return this.kernel.administer(
            cmd,
            id!,
            [],
            async (tx, attribution, audit) => {
              const before = await this.spaces.detail(id!, tx);
              await this.spaces.change(
                tx,
                id!,
                route.endsWith('suspend') ? 'suspend' : 'reactivate',
                body,
              );
              await this.kernel.adminEffect(
                tx,
                cmd,
                id!,
                attribution,
                audit,
                'workspace.suspension',
                id!,
              );
              if (before.ownerUserId)
                await tx.adminDelivery.create({
                  data: {
                    auditId: event!.id,
                    targetUserId: before.ownerUserId,
                    kind: 'WORKSPACE_CHANGED',
                    payload: { workspaceId: id!, reason: body.reason },
                  },
                });
              return json(await this.workspaceDetail(id!, tx));
            },
            { action: 'workspace.suspension', resourceId: id! },
          );
        }
      }
      if (route.startsWith('GET dashboard')) {
        const q = input as z.infer<typeof AdminDashboardQuerySchema>;
        const range = dashboardRange(q);
        let workspaces: Awaited<ReturnType<AdminSpaces['metrics']>> | undefined;
        if (permits(actor.user.role, 'admin.workspaces.read'))
          workspaces = await this.spaces.metrics(range.from, range.until);
        const workspaceMetrics = workspaces
          ? {
              personal: workspaces.personal,
              team: workspaces.team,
              company: workspaces.company,
              growth: workspaces.growth,
              ...(permits(actor.user.role, 'admin.memberships.read')
                ? {
                    activeMemberships: workspaces.activeMemberships,
                    invitations: workspaces.invitations,
                  }
                : {}),
            }
          : undefined;
        const data = {
          range: {
            from: range.from.toISOString(),
            until: range.until.toISOString(),
            timezone: 'UTC',
            boundaries: '[from,until)',
          },
          ...(permits(actor.user.role, 'admin.users.read')
            ? { users: await this.accounts.metrics(range.from, range.until) }
            : {}),
          ...(workspaceMetrics ? { workspaces: workspaceMetrics } : {}),
          securityWarnings: permits(
            actor.user.role,
            'admin.users.sessions.revoke',
          )
            ? {
                available: true,
                deniedAdminRequests: await this.db.client.adminAuditEvent.count(
                  {
                    where: {
                      outcome: 'DENIED',
                      createdAt: { gte: range.from, lt: range.until },
                    },
                  },
                ),
              }
            : undefined,
          operationalWarnings: {
            available: true,
            failedAdministrativeDeliveries:
              await this.db.client.adminDelivery.count({
                where: {
                  state: 'FAILED',
                  createdAt: { gte: range.from, lt: range.until },
                },
              }),
          },
          usage: permits(actor.user.role, 'admin.workspaces.read')
            ? await this.spaces.usageMetrics(range.from, range.until)
            : {
                available: false,
                reason: 'Workspace metadata permission required',
              },
        };
        if (event)
          await this.admin.auditOutcome(event.id, 'SUCCEEDED', actor.user.id);
        return data;
      }
      if (route === 'GET users')
        return this.accounts.list(
          actor.user.id,
          input as z.infer<typeof contracts.AdminUserQuerySchema>,
        );
      if (route === 'GET users/:id') return this.accounts.detail(id!);
      if (route === 'GET workspaces') {
        const result = await this.spaces.list(
          actor.user.id,
          input as z.infer<typeof AdminPageSchema>,
        );
        return {
          ...result,
          items: await Promise.all(
            result.items.map((row) => this.workspaceDetail(row.id)),
          ),
        };
      }
      if (route === 'GET workspaces/:id') return this.workspaceDetail(id!);
      if (route.startsWith('GET') && route.endsWith('/memberships'))
        return this.spaces.memberships(
          actor.user.id,
          contracts.AdminMembershipQuerySchema.parse(input),
          route.includes('users/') ? { userId: id! } : { spaceId: id! },
        );
      if (route.endsWith('/invitations'))
        return this.spaces.invitations(
          actor.user.id,
          id!,
          contracts.AdminInvitationQuerySchema.parse(input),
        );
      if (route === 'POST users/bulk/preview') {
        const body = AdminBulkPreviewSchema.parse(input);
        if (body.userIds.length > this.config.ADMIN_BULK_MAX)
          throw new BadRequestException({ code: 'BULK_LIMIT_EXCEEDED' });
        const permission =
          body.operation === 'suspend'
            ? 'admin.users.suspend'
            : 'admin.users.reactivate';
        if (!permits(actor.user.role, permission))
          throw new ForbiddenException();
        const targets = await Promise.all(
          body.userIds.map(async (userId) => {
            try {
              const user = await this.accounts.detail(userId);
              return { id: userId, revision: user.revision, eligible: true };
            } catch {
              return { id: userId, revision: 0, eligible: false };
            }
          }),
        );
        const row = await this.db.client.adminBulkOperation.create({
          data: {
            actorAdminId: actor.user.id,
            input: json(body),
            targets: json(targets),
            expiresAt: new Date(Date.now() + 300000),
          },
        });
        await this.admin.auditOutcome(event!.id, 'SUCCEEDED', actor.user.id);
        return { previewId: row.id, expiresAt: row.expiresAt, targets };
      }
      if (route === 'POST users/bulk/execute') {
        const body = AdminBulkExecuteSchema.parse(input);
        const row = await this.db.client.adminBulkOperation.findUnique({
          where: { id: body.previewId },
        });
        if (!row || row.actorAdminId !== actor.user.id)
          throw new ForbiddenException();
        const batch = AdminBulkPreviewSchema.parse(row.input);
        if (batch.userIds.length > this.config.ADMIN_BULK_MAX)
          throw new BadRequestException({ code: 'BULK_LIMIT_EXCEEDED' });
        if (
          !permits(
            actor.user.role,
            batch.operation === 'suspend'
              ? 'admin.users.suspend'
              : 'admin.users.reactivate',
          )
        )
          throw new ForbiddenException();
        if (
          body.confirmation.length !== batch.userIds.length ||
          new Set(body.confirmation).size !== batch.userIds.length ||
          batch.userIds.some((i) => !body.confirmation.includes(i))
        )
          throw new BadRequestException();
        const targets = z
          .array(
            z.object({
              id: z.uuid(),
              revision: z.number(),
              eligible: z.boolean(),
            }),
          )
          .parse(row.targets);
        const outcomes = [];
        for (const target of targets) {
          try {
            const outcome = await this.db.client.$transaction(async (tx) => {
              await tx.$queryRaw`SELECT id FROM "AdminBulkOperation" WHERE id=${row.id}::uuid FOR UPDATE`;
              const current = await tx.adminBulkOperation.findUniqueOrThrow({
                where: { id: row.id },
              });
              const results = z
                .record(z.string(), z.object({ outcome: z.string() }))
                .parse(current.results);
              if (results[target.id])
                return { id: target.id, ...results[target.id] };
              if (current.expiresAt <= new Date() || !target.eligible)
                throw new ConflictException();
              const changed = await this.accounts.change(
                tx,
                target.id,
                batch.operation,
                { ...batch, revision: target.revision },
              );
              await tx.adminAuditEvent.create({
                data: {
                  actorAdminId: actor!.user.id,
                  action: 'BULK_' + batch.operation,
                  outcome: 'SUCCEEDED',
                  targetUserId: target.id,
                  requestId: req.id,
                  reason: batch.reason,
                  internalNote: batch.internalNote ?? null,
                  permission: spec.permission,
                  metadata: json({
                    previewId: row.id,
                    revision: changed.revision,
                  }),
                },
              });
              results[target.id] = { outcome: 'SUCCEEDED' };
              await tx.adminBulkOperation.update({
                where: { id: row.id },
                data: { results },
              });
              await tx.adminDelivery.create({
                data: {
                  auditId: event!.id,
                  targetUserId: target.id,
                  kind: 'ACCOUNT_CHANGED',
                  payload: { reason: batch.reason },
                },
              });
              return { id: target.id, outcome: 'SUCCEEDED' };
            });
            outcomes.push(outcome);
          } catch (error) {
            const outcome =
              error instanceof HttpException && error.getStatus() < 500
                ? 'DENIED'
                : 'FAILED';
            await this.db.client.adminAuditEvent.create({
              data: {
                actorAdminId: actor.user.id,
                action: 'BULK_' + batch.operation,
                outcome,
                targetUserId: target.id,
                requestId: req.id,
                reason: batch.reason,
                permission: spec.permission,
              },
            });
            outcomes.push({ id: target.id, outcome });
          }
        }
        await this.admin.auditOutcome(event!.id, 'SUCCEEDED', actor.user.id);
        return { previewId: row.id, outcomes };
      }
      const body = input as {
        revision: number;
        reason: string;
        internalNote?: string;
        name?: string;
        email?: string;
        expiresAt?: string;
      };
      const operation = route.startsWith('PATCH')
        ? 'update'
        : route.split('/').at(-1)!;
      const userOperation = route.includes('users/');
      const result = await this.db.client.$transaction(async (tx) => {
        // Account mutation uses the same Personal fence as ordinary domain transactions.
        if (userOperation) {
          const personal = await tx.space.findFirst({
            where: { ownerUserId: id!, kind: 'PERSONAL' },
            select: { id: true },
          });
          if (!personal) throw new BadRequestException();
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'personal-access:' + personal.id},0))::text`;
        }
        const before = userOperation
          ? await this.accounts.detail(id!, tx)
          : await this.spaces.detail(id!, tx);
        const after = userOperation
          ? await this.accounts.change(tx, id!, operation, body)
          : await this.spaces.change(tx, id!, operation, body);
        if (userOperation)
          await tx.adminDelivery.create({
            data: {
              auditId: event!.id,
              targetUserId: id!,
              kind:
                operation === 'recovery'
                  ? 'PASSWORD_RECOVERY'
                  : 'ACCOUNT_CHANGED',
              payload: { reason: body.reason },
            },
          });
        await tx.adminAuditEvent.update({
          where: { id: event!.id },
          data: {
            outcome: 'SUCCEEDED',
            reason: body.reason,
            internalNote: body.internalNote ?? null,
            metadata: json({
              before: {
                revision: before.revision,
                status: before.status,
                ...('name' in before
                  ? {
                      name: before.name,
                      emailVerified: before.emailVerified,
                      email: before.email,
                    }
                  : {}),
              },
              after: {
                revision: after.revision,
                status: after.status,
                ...('name' in after
                  ? {
                      name: after.name,
                      emailVerified: after.emailVerified,
                      email: after.email,
                    }
                  : {}),
              },
            }),
          },
        });
        return after;
      });
      return userOperation ? result : this.workspaceDetail(id!);
    } catch (error) {
      if (event)
        await this.admin.auditOutcome(
          event.id,
          error instanceof HttpException && error.getStatus() < 500
            ? 'DENIED'
            : 'FAILED',
          actor?.user.id ?? null,
        );
      throw error;
    }
  }
}
