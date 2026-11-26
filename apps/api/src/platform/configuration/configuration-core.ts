import {
  Injectable,
  Inject,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ConfigurationCatalog,
  ConfigurationPayloadSchema,
  MaintenanceValueSchema,
  type ConfigurationPayload,
  type ConfigurationContext,
} from '@mehran/api-contracts';
import { DatabaseService } from '../database/database.service.js';
import type {
  Prisma,
  PlatformConfigDefinition,
  PlatformConfigVersion,
} from '../../generated/prisma/client.js';
import { AdminCommand } from '../admin/admin-command.js';
import {
  evaluateRules,
  configurationDiff,
  type EvaluationSubject,
} from './domain/evaluation.js';
export const configJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const configHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const configurationLock = (tx: Prisma.TransactionClient) =>
  tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('platform-config',0))::text`;
export const configPage = <T extends { id: string }>(
  rows: T[],
  limit: number,
) => ({
  items: rows.slice(0, limit),
  nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
});
export function configFail(code: string): never {
  throw new ConflictException({ code });
}
@Injectable()
export class ConfigurationCore {
  constructor(@Inject(DatabaseService) readonly db: DatabaseService) {}
  async definition(tx: Prisma.TransactionClient, id: string) {
    const d = await tx.platformConfigDefinition.findUnique({ where: { id } });
    if (!d) throw new NotFoundException();
    return d;
  }
  catalog(key: string) {
    return ConfigurationCatalog[key as keyof typeof ConfigurationCatalog];
  }
  validate(
    d: Pick<PlatformConfigDefinition, 'category' | 'key'>,
    payload: ConfigurationPayload,
  ) {
    const c = this.catalog(d.key);
    if (d.category !== 'FLAG' && (!c || c.category !== d.category))
      throw new BadRequestException({
        code: 'CONFIGURATION_KEY_NOT_ALLOWLISTED',
      });
    const values = [payload.value, ...payload.rules.map((r) => r.value)];
    for (const value of values) {
      const valid =
        d.category === 'FLAG'
          ? typeof value === 'boolean'
          : c?.type === 'integer'
            ? typeof value === 'number' &&
              Number.isSafeInteger(value) &&
              value >= 1 &&
              value <= 104857600
            : c?.type === 'boolean'
              ? typeof value === 'boolean'
              : c?.type === 'priority'
                ? ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(
                    String(value),
                  )
                : c?.type === 'locale'
                  ? typeof value === 'string' &&
                    /^[a-z]{2}(?:-[A-Z]{2})?$/.test(value)
                  : c?.type === 'maintenance'
                    ? MaintenanceValueSchema.safeParse(value).success
                    : false;
      if (!valid)
        throw new BadRequestException({ code: 'CONFIGURATION_VALUE_INVALID' });
    }
    if (
      d.key === 'platform.maintenance' &&
      (payload.rules.length || payload.expiresAt)
    )
      throw new BadRequestException({
        code: 'MAINTENANCE_USE_BINDINGS_AND_ESTIMATE',
      });
    for (const r of payload.rules) {
      let prior = -Infinity,
        bps = r.basisPoints;
      for (const step of r.steps) {
        const at = Date.parse(step.at);
        if (at <= prior || step.basisPoints < bps)
          throw new BadRequestException({
            code: 'ROLLOUT_STEPS_NOT_MONOTONIC',
          });
        prior = at;
        bps = step.basisPoints;
      }
    }
  }
  subject = configurationSubject;
  async impact(
    tx: Prisma.TransactionClient,
    d: PlatformConfigDefinition,
    p: ConfigurationPayload,
  ) {
    this.validate(d, p);
    const targets = [];
    for (const r of p.rules) {
      const t = r.target;
      if (t.kind === 'USER') {
        if (
          !(await tx.user.findUnique({
            where: { id: t.userId },
            select: { id: true },
          }))
        )
          throw new NotFoundException();
        targets.push({ kind: t.kind, id: t.userId });
      } else if (t.kind === 'WORKSPACE') {
        const s = await this.subject(tx, {
          workspaceId: t.workspaceId,
          clientVersion: 1,
        });
        if (
          !s.scopeType ||
          !['PERSONAL', 'TEAM', 'COMPANY'].includes(s.scopeType) ||
          s.workspaceId !== t.workspaceId.toLowerCase()
        )
          throw new BadRequestException({
            code: 'CONFIGURATION_WORKSPACE_TARGET_INVALID',
          });
        targets.push({
          kind: t.kind,
          id: t.workspaceId,
          scopeType: s.scopeType,
          admissions: await tx.contextAccess.findMany({
            where: { scopeId: t.workspaceId },
            orderBy: { id: 'asc' },
            select: {
              id: true,
              generation: true,
              revision: true,
              state: true,
              memberRole: true,
            },
          }),
        });
      } else if (t.kind === 'GROUP') {
        const group = await tx.socialGroup.findUnique({
          where: { scopeId: t.groupId },
          select: { scopeId: true },
        });
        if (!group) throw new NotFoundException();
        targets.push({
          kind: t.kind,
          id: t.groupId,
          members: await tx.contextAccess.findMany({
            where: {
              scopeId: t.groupId,
              state: 'ACTIVE',
              memberRole: { not: null },
              SharedActor: { state: 'ACTIVE' },
            },
            orderBy: { id: 'asc' },
            select: {
              id: true,
              generation: true,
              revision: true,
              actorId: true,
            },
          }),
        });
      } else targets.push(t);
    }
    const users = await tx.user.count(),
      workspaces =
        (await tx.space.count({
          where: { kind: 'PERSONAL', accessClosedAt: null },
        })) +
        (await tx.sharedCustody.count({
          where: {
            kind: { in: ['TEAM', 'COMPANY'] },
            state: { in: ['ACTIVE', 'ARCHIVED'] },
          },
        })) +
        (await tx.domainScopeCustody.count({
          where: { kind: 'TEAM', state: { in: ['ACTIVE', 'ARCHIVED'] } },
        })),
      groups = await tx.socialGroup.count();
    const limits =
      d.key === 'uploads.maxBytes'
        ? [p.value, ...p.rules.map((r) => r.value)].filter(
            (v): v is number => typeof v === 'number',
          )
        : [];
    const existingOversizeFiles = limits.length
      ? await tx.storedFile.count({
          where: { status: 'READY', actualSize: { gt: Math.min(...limits) } },
        })
      : 0;
    const result = {
      users,
      workspaces,
      groups,
      existingOversizeFiles,
      effect:
        'Population counts are conservative exposure bounds; oversize files are a global upper bound at the lowest proposed limit. Future admission/defaults only. No content deletion or permission, entitlement, retention or infrastructure-ceiling change.',
      sensitive: this.catalog(d.key)?.sensitive ?? false,
    };
    return {
      ...result,
      fingerprint: configHash({
        definitionId: d.id,
        revision: d.revision,
        payload: p,
        targets,
        ...result,
      }),
    };
  }
  async event(
    tx: Prisma.TransactionClient,
    definitionId: string,
    kind: string,
    reason: string,
    actorAdminId: string | null,
    versionId: string | null = null,
    metadata: Prisma.InputJsonValue = {},
  ) {
    return tx.platformConfigEvent.create({
      data: { definitionId, kind, reason, actorAdminId, versionId, metadata },
    });
  }
  async bump(tx: Prisma.TransactionClient) {
    return tx.platformConfigEpoch.update({
      where: { id: 'GLOBAL' },
      data: { generation: { increment: 1 }, observedAt: new Date() },
    });
  }
  async consumeApproval(
    tx: Prisma.TransactionClient,
    command: AdminCommand,
    approvalId: string | undefined,
    action: string,
    targetId: string,
    fingerprint: string,
  ) {
    if (!approvalId)
      throw new ForbiddenException({ code: 'DISTINCT_APPROVAL_REQUIRED' });
    await tx.$queryRaw`SELECT id FROM "AdminSecurityApproval" WHERE id=${approvalId}::uuid FOR UPDATE`;
    const a = await tx.adminSecurityApproval.findUnique({
        where: { id: approvalId },
      }),
      input = a?.input as
        { targetId?: string; fingerprint?: string } | undefined;
    if (
      !a ||
      a.action !== action ||
      a.state !== 'APPROVED' ||
      a.requesterAdminId !== command.adminId ||
      !a.approverAdminId ||
      a.approverAdminId === command.adminId ||
      a.expiresAt <= new Date() ||
      input?.targetId !== targetId ||
      input.fingerprint !== fingerprint
    )
      throw new ForbiddenException({ code: 'CONFIGURATION_APPROVAL_INVALID' });
    await AdminCommand.requireInitiator(
      tx,
      a.approverAdminId,
      'admin.security.critical.approve',
    );
    await tx.adminSecurityApproval.update({
      where: { id: a.id },
      data: { state: 'EXECUTED', completedAt: new Date() },
    });
  }
  async reconcile(tx: Prisma.TransactionClient, now = new Date()) {
    await configurationLock(tx);
    const rows = await tx.platformConfigVersion.findMany({
      where: {
        OR: [
          {
            startsAt: { lte: now },
            r_PlatformConfigEvent_versionId: {
              none: { kind: { in: ['ACTIVATED', 'ACTIVATION_DENIED'] } },
            },
          },
          {
            expiresAt: { lte: now },
            r_PlatformConfigEvent_versionId: { none: { kind: 'EXPIRED' } },
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    for (const v of rows) {
      const events = await tx.platformConfigEvent.findMany({
        where: { versionId: v.id },
        select: { kind: true },
      });
      if (
        !events.some((e) => ['ACTIVATED', 'ACTIVATION_DENIED'].includes(e.kind))
      ) {
        let ok = true;
        try {
          await AdminCommand.requireInitiator(
            tx,
            v.actorAdminId,
            'admin.configuration.publish',
          );
          if (v.approvalId) {
            const a = await tx.adminSecurityApproval.findUniqueOrThrow({
              where: { id: v.approvalId },
            });
            if (!a.approverAdminId || a.state !== 'EXECUTED') throw new Error();
            await AdminCommand.requireInitiator(
              tx,
              a.approverAdminId,
              'admin.security.critical.approve',
            );
          }
        } catch {
          ok = false;
        }
        await this.event(
          tx,
          v.definitionId,
          ok ? 'ACTIVATED' : 'ACTIVATION_DENIED',
          'Scheduled activation authority rechecked',
          null,
          v.id,
        );
      }
      if (
        v.expiresAt &&
        v.expiresAt <= now &&
        !events.some((e) => e.kind === 'EXPIRED')
      )
        await this.event(
          tx,
          v.definitionId,
          'EXPIRED',
          'Previous eligible value restored by time evaluation',
          null,
          v.id,
        );
    }
    if (rows.length) await this.bump(tx);
    return rows.length > 0;
  }
  effective = effectiveConfiguration;
  async consume() {
    return this.db.client.$transaction((tx) => this.reconcile(tx));
  }
  diff = configurationDiff;
}

export async function configurationSubject(
  tx: Prisma.TransactionClient,
  context: ConfigurationContext,
): Promise<EvaluationSubject> {
  context = {
    ...context,
    ...(context.userId ? { userId: context.userId.toLowerCase() } : {}),
    ...(context.workspaceId
      ? { workspaceId: context.workspaceId.toLowerCase() }
      : {}),
  };
  const result: EvaluationSubject = {
    userId: context.userId,
    workspaceId: context.workspaceId,
    groups: [],
  };
  if (
    context.userId &&
    !(await tx.user.findUnique({
      where: { id: context.userId },
      select: { id: true },
    }))
  )
    throw new NotFoundException();
  if (context.workspaceId) {
    const s = await tx.space.findUnique({
      where: { id: context.workspaceId },
      select: { kind: true, accessClosedAt: true },
    });
    const scope = await tx.accessScope.findUnique({
      where: { id: context.workspaceId },
      select: { kind: true, state: true, spaceId: true },
    });
    const domain = scope
      ? await tx.domainScopeCustody.findUnique({
          where: { scopeId: context.workspaceId },
          select: { kind: true, state: true, parentScopeId: true },
        })
      : null;
    if (s?.kind === 'PERSONAL' && !s.accessClosedAt)
      result.scopeType = 'PERSONAL';
    else if (scope && ['ACTIVE', 'ARCHIVED'].includes(scope.state)) {
      const custody = await tx.sharedCustody.findUnique({
        where: { spaceId: scope.spaceId },
        select: { kind: true },
      });
      if (domain?.kind === 'TEAM') {
        result.scopeType = 'TEAM';
      } else {
        const parent = domain?.parentScopeId
          ? await tx.domainScopeCustody.findUnique({
              where: { scopeId: domain.parentScopeId },
              select: { scopeId: true, kind: true },
            })
          : null;
        if (parent?.kind === 'TEAM') {
          result.scopeType = 'TEAM';
          result.workspaceId = parent.scopeId;
        } else if (custody && ['TEAM', 'COMPANY'].includes(custody.kind)) {
          result.scopeType = custody.kind;
          result.workspaceId = scope.spaceId;
        }
      }
    } else throw new NotFoundException();
  }
  if (context.userId) {
    const groups = await tx.contextAccess.findMany({
      where: {
        state: 'ACTIVE',
        memberRole: { not: null },
        SharedActor: { userId: context.userId, state: 'ACTIVE' },
        AccessScope: { state: 'ACTIVE', socialGroup: { isNot: null } },
      },
      select: { scopeId: true },
    });
    result.groups = groups.map((g) => g.scopeId);
  }
  return result;
}

export async function effectiveConfiguration(
  tx: Prisma.TransactionClient,
  d: PlatformConfigDefinition,
  context: ConfigurationContext,
  now = new Date(),
) {
  const subject = await configurationSubject(tx, context),
    generation = (
      await tx.platformConfigEpoch.findUniqueOrThrow({
        where: { id: 'GLOBAL' },
      })
    ).generation.toString();
  const v = await currentConfigurationVersion(
    tx,
    d.id,
    now,
    d.key === 'platform.maintenance',
  );
  const defaultValue =
    d.category === 'FLAG'
      ? true
      : (ConfigurationCatalog[d.key as keyof typeof ConfigurationCatalog]
          ?.defaultValue ?? false);
  const payload = v ? ConfigurationPayloadSchema.parse(v.payload) : null;
  const evaluated = evaluateRules(
    d.id,
    payload?.value ?? defaultValue,
    (v?.r_PlatformConfigTarget_versionId ?? []).map((r) => ({
      position: r.position,
      target: {
        kind: r.kind,
        scopeType: r.scopeType,
        workspaceId: r.scopeId ?? r.spaceId,
        userId: r.userId,
        groupId: r.groupId,
      },
      value: r.value,
      priority: r.priority,
      basisPoints: r.basisPoints,
      steps: r.steps as { at: string; basisPoints: number }[],
    })),
    subject,
    now,
  );
  const future = await tx.platformConfigVersion.findFirst({
    where: { definitionId: d.id, startsAt: { gt: now } },
    orderBy: { startsAt: 'asc' },
  });
  const times = [
    future?.startsAt,
    payload?.expiresAt ? new Date(payload.expiresAt) : null,
    ...(payload?.rules.flatMap((r) => r.steps.map((s) => new Date(s.at))) ??
      []),
  ]
    .filter((t): t is Date => !!t && t > now)
    .sort((a, b) => +a - +b);
  return {
    definitionId: d.id,
    key: d.key,
    value: d.killed ? false : evaluated.value,
    source: d.killed
      ? 'KILL'
      : evaluated.source === 'DEFAULT' && v
        ? 'GLOBAL'
        : evaluated.source,
    rulePosition: d.killed ? null : evaluated.rulePosition,
    versionId: v?.id ?? null,
    version: v?.version ?? null,
    generation,
    evaluatedAt: now.toISOString(),
    nextChangeAt: times[0]?.toISOString() ?? null,
    bucket: evaluated.bucket,
    restrictedOnly: true as const,
  };
}
export async function configurationVersionEligible(
  tx: Prisma.TransactionClient,
  v: PlatformConfigVersion,
  now = new Date(),
) {
  if (v.startsAt > now) return false;
  const events = await tx.platformConfigEvent.findMany({
    where: {
      versionId: v.id,
      kind: { in: ['ACTIVATED', 'ACTIVATION_DENIED'] },
    },
    select: { kind: true },
  });
  if (events.some((e) => e.kind === 'ACTIVATION_DENIED')) return false;
  if (events.some((e) => e.kind === 'ACTIVATED')) return true;
  try {
    await AdminCommand.requireInitiator(
      tx,
      v.actorAdminId,
      'admin.configuration.publish',
    );
    if (v.approvalId) {
      const a = await tx.adminSecurityApproval.findUniqueOrThrow({
        where: { id: v.approvalId },
      });
      if (a.state !== 'EXECUTED' || !a.approverAdminId) return false;
      await AdminCommand.requireInitiator(
        tx,
        a.approverAdminId,
        'admin.security.critical.approve',
      );
    }
    return true;
  } catch {
    return false;
  }
}
async function currentConfigurationVersion(
  tx: Prisma.TransactionClient,
  definitionId: string,
  now: Date,
  maintenance = false,
) {
  let ceiling: number | undefined;
  while (true) {
    const rows = await tx.platformConfigVersion.findMany({
      where: {
        definitionId,
        startsAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        ...(maintenance
          ? { r_PlatformMaintenanceRelease_versionId: { none: {} } }
          : {}),
        ...(ceiling ? { version: { lt: ceiling } } : {}),
      },
      orderBy: { version: 'desc' },
      take: 25,
      include: {
        r_PlatformConfigTarget_versionId: { orderBy: { position: 'asc' } },
      },
    });
    for (const v of rows)
      if (await configurationVersionEligible(tx, v, now)) return v;
    if (rows.length < 25) return undefined;
    ceiling = rows[rows.length - 1]!.version;
  }
}
