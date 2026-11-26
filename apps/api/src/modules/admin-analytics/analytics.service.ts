import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import {
  AnalyticsCatalog,
  AnalyticsPolicySchema,
  AnalyticsFilterSchema,
  AnalyticsDefinitionInputSchema,
  AnalyticsReportInputSchema,
  type AnalyticsFilter,
  adminAnalyticsRoutes,
  AnalyticsPolicyPreviewSchema,
} from '@mehran/api-contracts';
import { DatabaseService } from '../../platform/database/database.service.js';
import { PrivacyGate } from '../../platform/authorization/privacy-gate.js';
import { AdminCommand } from '../../platform/admin/admin-command.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { CommerceAnalytics } from '../admin-commerce/public/index.js';
import {
  analyticsRegistrations,
  analyticsRegistrationCohort,
} from '../account/public/product-analytics.js';
import { analyticsFlagCohort } from '../../platform/configuration/public/analytics.js';
import type { RequestActor } from '../../platform/auth/request-actor.js';
import { randomUUID } from 'node:crypto';
export const ANALYTICS_SCOPE_AUTHORITY = Symbol('ANALYTICS_SCOPE_AUTHORITY');
export type AnalyticsScopeAuthority = (
  tx: Prisma.TransactionClient,
  actor: RequestActor,
  selector?: string,
) => Promise<{ spaceId: string; scopeId: string | null; kind: string }>;
const policyView = (p: {
  revision: number;
  product: boolean;
  navigation: boolean;
  rawDays: number;
  aggregateDays: number;
  minimumCohort: number;
}) =>
  AnalyticsPolicySchema.parse({
    revision: p.revision,
    product: p.product,
    navigation: p.navigation,
    rawDays: p.rawDays,
    aggregateDays: p.aggregateDays,
    minimumCohort: p.minimumCohort,
  });
import {
  analyticsMetrics,
  definitionMetrics,
  measure,
  uniqueUsers,
} from './analytics-engine.js';
const json = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export const analyticsLock = (tx: Prisma.TransactionClient) =>
  tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('product-analytics',0))::text`;
export const reportView = (r: {
  id: string;
  state: string;
  nextAt: Date | null;
  expiresAt: Date;
  format: string;
  type: string;
  intervalHours: number | null;
}) => ({
  id: r.id,
  state: r.state,
  format: r.format,
  type: r.type,
  intervalHours: r.intervalHours,
  nextAt: r.nextAt?.toISOString() ?? null,
  expiresAt: r.expiresAt.toISOString(),
});
@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(DatabaseService) readonly db: DatabaseService,
    @Inject(PrivacyGate) readonly privacy: PrivacyGate,
    @Inject(CommerceAnalytics) readonly commerce: CommerceAnalytics,
    @Inject(ANALYTICS_SCOPE_AUTHORITY)
    readonly authority: AnalyticsScopeAuthority,
  ) {}
  async policy(tx: Prisma.TransactionClient) {
    return tx.productAnalyticsPolicy.findUniqueOrThrow({
      where: { id: 'GLOBAL' },
    });
  }
  async authorizeFilter(
    tx: Prisma.TransactionClient,
    adminId: string,
    filter: AnalyticsFilter,
  ) {
    await AdminCommand.requireInitiator(
      tx,
      adminId,
      'admin.analytics.product.read',
    );
    if (
      filter.registeredFrom ||
      filter.registeredTo ||
      filter.firstFeature ||
      filter.flagId
    )
      await AdminCommand.requireInitiator(
        tx,
        adminId,
        'admin.analytics.sensitive.read',
      );
  }
  async authorizeReport(
    tx: Prisma.TransactionClient,
    adminId: string,
    type: string,
    filter: AnalyticsFilter,
  ) {
    if (type === 'PRODUCT') return this.authorizeFilter(tx, adminId, filter);
    if (type !== 'FINANCIAL') throw new ForbiddenException();
    await AdminCommand.requireInitiator(
      tx,
      adminId,
      'admin.analytics.financial.read',
    );
    if (Object.keys(filter).some((k) => k !== 'from' && k !== 'to'))
      throw new ConflictException({ code: 'FINANCIAL_REPORT_RANGE_ONLY' });
  }
  async financial(tx: Prisma.TransactionClient, filter: AnalyticsFilter) {
    this.privacy.assert();
    const p = await this.policy(tx);
    return this.commerce.financial(tx, filter.from, filter.to, p.minimumCohort);
  }
  async retentionImpact(
    tx: Prisma.TransactionClient,
    policy: { rawDays: number; aggregateDays: number; minimumCohort: number },
  ) {
    return {
      rawEligible: await tx.productAnalyticsEvent.count({
        where: {
          occurredAt: { lt: new Date(Date.now() - policy.rawDays * 86400000) },
        },
      }),
      aggregateEligible: await tx.productAnalyticsAggregate.count({
        where: {
          OR: [
            {
              day: {
                lt: new Date(Date.now() - policy.aggregateDays * 86400000),
              },
            },
            { users: { lt: policy.minimumCohort } },
          ],
        },
      }),
      reportsInvalidated: await tx.productAnalyticsReport.count(),
    };
  }
  async navigation(
    actor: RequestActor,
    workspaceId: string | undefined,
    id: string,
  ) {
    this.privacy.assert();
    await this.db.client.$transaction(async (tx) => {
      const scope = await this.authority(tx, actor, workspaceId);
      await tx.$queryRaw`SELECT id FROM "ProductAnalyticsPolicy" WHERE id='GLOBAL' FOR SHARE`;
      const p = await this.policy(tx);
      if (!p.navigation) return;
      const prior = await tx.productAnalyticsEvent.findUnique({
        where: { id },
      });
      if (prior) {
        if (
          prior.userId !== actor.userId ||
          prior.spaceId !== scope.spaceId ||
          prior.scopeId !== scope.scopeId
        )
          throw new ConflictException({ code: 'ANALYTICS_EVENT_CONFLICT' });
        return;
      }
      await tx.productAnalyticsEvent.create({
        data: {
          id,
          userId: actor.userId,
          spaceId: scope.spaceId,
          scopeId: scope.scopeId,
          workspaceType: scope.kind,
          name: 'navigation.viewed',
          version: 1,
          feature: 'navigation',
          meaningful: false,
        },
      });
    });
  }
  async query(tx: Prisma.TransactionClient, filter: AnalyticsFilter) {
    this.privacy.assert();
    await tx.$queryRaw`SELECT id FROM "ProductAnalyticsPolicy" WHERE id='GLOBAL' FOR SHARE`;
    const p = await this.policy(tx),
      to = new Date(filter.to),
      from = new Date(filter.from),
      minimum = p.minimumCohort;
    if (to > new Date())
      throw new ConflictException({ code: 'ANALYTICS_FUTURE_RANGE' });
    const floor = new Date(
      Math.max(+p.startedAt, Date.now() - p.rawDays * 86400000),
    );
    // Distinct rolling users require raw evidence; daily distinct totals are never summed.
    const start = new Date(
      filter.registeredFrom || filter.registeredTo
        ? +floor
        : Math.max(+floor, Math.min(+from, +to - 30 * 86400000)),
    );
    let rows = await tx.productAnalyticsEvent.findMany({
      where: {
        occurredAt: { gte: start, lt: to },
        ...(filter.workspaceType
          ? { workspaceType: filter.workspaceType }
          : {}),
        ...(filter.feature ? { feature: filter.feature } : {}),
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: 100001,
    });
    if (rows.length > 100000)
      throw new ConflictException({ code: 'ANALYTICS_ROW_LIMIT' });
    const ids = [...new Set(rows.map((r) => r.userId))];
    const registration = await analyticsRegistrationCohort(
      tx,
      ids,
      filter.registeredFrom,
      filter.registeredTo,
    );
    const eligible = new Set(registration.map((r) => r.id));
    if (registration.length > 10000)
      throw new ConflictException({ code: 'ANALYTICS_ROW_LIMIT' });
    rows = rows.filter((r) => eligible.has(r.userId));
    if (filter.firstFeature) {
      const first = await tx.productAnalyticsEvent.findMany({
        where: {
          userId: { in: ids },
          feature: filter.firstFeature,
          occurredAt: { gte: floor, lt: to },
        },
        distinct: ['userId'],
        orderBy: { occurredAt: 'asc' },
        take: 10001,
      });
      if (first.length > 10000)
        throw new ConflictException({ code: 'ANALYTICS_ROW_LIMIT' });
      const firstIds = new Set(
        first
          .filter((r) => r.occurredAt >= from && r.occurredAt < to)
          .map((r) => r.userId),
      );
      rows = rows.filter((r) => firstIds.has(r.userId));
    }
    if (filter.planId) {
      const scopes = new Set(await this.commerce.segments(tx, filter.planId));
      rows = rows.filter((r) => scopes.has(r.scopeId ?? r.spaceId));
    }
    if (filter.flagId) {
      const distinct = new Map(
        rows.map((r) => [
          r.userId + ':' + (r.scopeId ?? r.spaceId),
          { userId: r.userId, workspaceId: r.scopeId ?? r.spaceId },
        ]),
      );
      const subjects = [...distinct.values()],
        values = await analyticsFlagCohort(tx, filter.flagId, subjects);
      const matches = new Map(
        subjects.map((s, i) => [
          s.userId + ':' + s.workspaceId,
          values[i] === (filter.flagValue ?? true),
        ]),
      );
      rows = rows.filter((r) =>
        matches.get(r.userId + ':' + (r.scopeId ?? r.spaceId)),
      );
    }
    const observed = new Set(rows.map((r) => r.userId)),
      segmented = Boolean(
        filter.workspaceType ||
        filter.feature ||
        filter.planId ||
        filter.flagId ||
        filter.firstFeature,
      );
    const registrationAnchors =
      filter.registeredFrom || filter.registeredTo
        ? new Map(
            registration
              .filter((r) => !segmented || observed.has(r.id))
              .map((r) => [r.id, r.createdAt]),
          )
        : undefined;
    const period = rows.filter((r) => r.occurredAt >= from),
      metrics = analyticsMetrics(rows, filter, minimum, registrationAnchors);
    const warnings: (
      | 'RAW_COVERAGE_PARTIAL'
      | 'CURRENT_FLAG_MEMBERSHIP'
      | 'CURRENT_PLAN_MEMBERSHIP'
    )[] = [];
    if (from < floor) {
      warnings.push('RAW_COVERAGE_PARTIAL');
      for (const m of metrics) {
        m.value = null;
        m.denominator = null;
        m.suppressed = true;
      }
    }
    if (
      registrationAnchors &&
      [...registrationAnchors.values()].some((at) => at < floor)
    ) {
      if (!warnings.includes('RAW_COVERAGE_PARTIAL'))
        warnings.push('RAW_COVERAGE_PARTIAL');
      for (const m of metrics)
        if (m.key.startsWith('registration_return_day_')) {
          m.value = null;
          m.denominator = null;
          m.suppressed = true;
        }
    }
    if (filter.flagId) warnings.push('CURRENT_FLAG_MEMBERSHIP');
    if (filter.planId) warnings.push('CURRENT_PLAN_MEMBERSHIP');
    const population = await analyticsRegistrations(tx, from, to);
    // Growth is a platform registration metric, separately labelled from segmented event users.
    metrics.push(
      measure(
        'platform_new_registrations',
        population.newUsers,
        population.newUsers,
        minimum,
      ),
      measure(
        'platform_registered_users',
        population.population,
        population.population,
        minimum,
      ),
    );
    const definitions = await tx.productAnalyticsDefinition.findMany({
      orderBy: { id: 'asc' },
      take: 101,
    });
    if (definitions.length > 100)
      throw new ConflictException({ code: 'ANALYTICS_DEFINITION_LIMIT' });
    const trends = [];
    for (
      let at = +new Date(filter.from.slice(0, 10) + 'T00:00:00Z');
      at < +to;
      at += 86400000
    ) {
      const daily = period.filter(
        (r) =>
          +r.occurredAt >= at &&
          +r.occurredAt < at + 86400000 &&
          (filter.feature === 'navigation' || r.meaningful),
      );
      const n = uniqueUsers(daily),
        suppressed = n < minimum || from < floor;
      trends.push({
        date: new Date(at).toISOString().slice(0, 10),
        activeUsers: suppressed || filter.feature === 'navigation' ? null : n,
        events: suppressed ? null : daily.length,
        suppressed,
      });
    }
    const features = [
      ...new Set(Object.values(AnalyticsCatalog).map((c) => c.feature)),
    ].map((feature) => {
      const selected = period.filter((r) => r.feature === feature),
        n = uniqueUsers(selected),
        suppressed = n < minimum || from < floor;
      return {
        feature,
        users: suppressed ? null : n,
        events: suppressed ? null : selected.length,
        suppressed,
      };
    });
    if (
      !filter.flagId &&
      !filter.planId &&
      !filter.firstFeature &&
      !filter.registeredFrom &&
      !filter.registeredTo
    ) {
      const old = await tx.productAnalyticsAggregate.findMany({
        where: {
          day: { gte: new Date(filter.from.slice(0, 10)), lt: floor },
          workspaceType: filter.workspaceType ?? 'ALL',
          feature: filter.feature ?? 'ALL',
        },
        take: 367,
      });
      for (const t of trends) {
        const match = old.find(
          (r) => r.day.toISOString().slice(0, 10) === t.date,
        );
        if (match && match.users >= minimum) {
          t.activeUsers = filter.feature === 'navigation' ? null : match.users;
          t.events = match.events;
          t.suppressed = false;
        }
      }
    }
    return {
      from: filter.from,
      to: filter.to,
      refreshedAt: new Date().toISOString(),
      lastAggregatedAt: p.refreshedAt?.toISOString() ?? null,
      coverageFrom: floor.toISOString(),
      minimumCohort: minimum,
      warnings,
      metrics,
      trends,
      features,
      definitions: definitions.map((d) => ({
        id: d.id,
        kind: d.kind,
        values: definitionMetrics(
          period,
          { ...d, events: d.events as string[] },
          minimum,
          new Date(filter.to),
        ).map((m) =>
          from < floor
            ? { ...m, value: null, denominator: null, suppressed: true }
            : m,
        ),
      })),
    };
  }
  async handle(
    route: keyof typeof adminAnalyticsRoutes,
    id: string | undefined,
    input: unknown,
    command: AdminCommand,
  ) {
    this.privacy.assert();
    command.require(adminAnalyticsRoutes[route].permission);
    return this.db.client.$transaction(
      async (tx) => {
        await command.verify(tx);
        if (
          route === 'GET analytics/reports/:id' ||
          route === 'POST analytics/financial'
        )
          await tx.$queryRaw`SELECT id FROM "ProductAnalyticsPolicy" WHERE id='GLOBAL' FOR SHARE`;
        const b = input as {
          filter?: unknown;
          type?: string;
          current?: unknown;
          previous?: unknown;
        };
        for (const filter of route === 'POST analytics/compare'
          ? [b.current, b.previous]
          : route === 'POST analytics/query'
            ? [b.filter]
            : [])
          await this.authorizeFilter(
            tx,
            command.adminId,
            AnalyticsFilterSchema.parse(filter),
          );
        if (route === 'POST analytics/reports')
          await this.authorizeReport(
            tx,
            command.adminId,
            b.type ?? 'PRODUCT',
            AnalyticsFilterSchema.parse(b.filter),
          );
        if (route === 'POST analytics/financial') {
          const b = input as { from: string; to: string };
          return this.financial(tx, b);
        }
        if (route === 'GET analytics/catalog')
          return {
            events: Object.entries(AnalyticsCatalog).map(([name, spec]) => ({
              name,
              ...spec,
            })),
          };
        if (route === 'GET analytics/policy')
          return policyView(await this.policy(tx));
        if (route === 'POST analytics/query')
          return this.query(
            tx,
            AnalyticsFilterSchema.parse((input as { filter: unknown }).filter),
          );
        if (route === 'POST analytics/compare') {
          const b = input as { current: unknown; previous: unknown };
          return {
            current: await this.query(
              tx,
              AnalyticsFilterSchema.parse(b.current),
            ),
            previous: await this.query(
              tx,
              AnalyticsFilterSchema.parse(b.previous),
            ),
          };
        }
        if (route === 'GET analytics/definitions')
          return {
            items: await tx.productAnalyticsDefinition.findMany({
              take: 100,
              orderBy: { id: 'asc' },
            }),
          };
        if (route === 'GET analytics/reports')
          return {
            items: (
              await tx.productAnalyticsReport.findMany({
                where: {
                  adminId: command.adminId,
                  OR: [
                    { intervalHours: { not: null } },
                    { expiresAt: { gt: new Date() } },
                  ],
                },
                take: 100,
                orderBy: { id: 'asc' },
              })
            ).map(reportView),
          };
        if (route === 'GET analytics/reports/:id') {
          const r = await tx.productAnalyticsReport.findFirst({
            where: {
              id: id!,
              adminId: command.adminId,
              OR: [
                { intervalHours: { not: null } },
                { expiresAt: { gt: new Date() } },
              ],
            },
          });
          if (!r) throw new NotFoundException();
          await this.authorizeReport(
            tx,
            command.adminId,
            r.type,
            AnalyticsFilterSchema.parse(r.filter),
          );
          await command.recordChange(tx, null, {
            reportId: r.id,
            type: r.type,
            format: r.format,
            state: r.state,
          });
          return {
            ...reportView(r),
            content: r.expiresAt > new Date() ? r.content : null,
          };
        }
        return command.execute(
          tx,
          async () => {
            await analyticsLock(tx);
            const {
              reason: _,
              previewId,
              ...payload
            } = input as Record<string, unknown>;
            if (route === 'POST analytics/policy/preview') {
              const policy = AnalyticsPolicySchema.parse(payload),
                p = await this.policy(tx);
              if (policy.revision !== p.revision)
                throw new ConflictException({ code: 'ANALYTICS_STALE_POLICY' });
              return json({
                previewId: randomUUID(),
                policy,
                ...(await this.retentionImpact(tx, policy)),
                expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
              });
            }
            if (route === 'POST analytics/reports/:id/cancel') {
              const report = await tx.productAnalyticsReport.findFirst({
                where: { id: id!, adminId: command.adminId },
              });
              if (!report) throw new NotFoundException();
              return json(
                reportView(
                  await tx.productAnalyticsReport.update({
                    where: { id: report.id },
                    data: {
                      content: null,
                      state: 'DENIED',
                      nextAt: null,
                      intervalHours: null,
                      expiresAt: new Date(),
                    },
                  }),
                ),
              );
            }
            if (route === 'POST analytics/policy') {
              const b = AnalyticsPolicySchema.parse(payload),
                p = await this.policy(tx);
              if (b.revision !== p.revision)
                throw new ConflictException({ code: 'ANALYTICS_STALE_POLICY' });
              if (
                b.rawDays !== p.rawDays ||
                b.aggregateDays !== p.aggregateDays ||
                b.minimumCohort !== p.minimumCohort
              ) {
                const receipt =
                  typeof previewId === 'string'
                    ? await tx.adminMutationReceipt.findFirst({
                        where: {
                          actorAdminId: command.adminId,
                          operation: 'admin.analytics.configure',
                          result: { path: ['previewId'], equals: previewId },
                        },
                      })
                    : null;
                const preview = AnalyticsPolicyPreviewSchema.safeParse(
                    receipt?.result,
                  ),
                  impact = await this.retentionImpact(tx, b);
                if (
                  !preview.success ||
                  Date.parse(preview.data.expiresAt) <= Date.now() ||
                  JSON.stringify(preview.data.policy) !== JSON.stringify(b) ||
                  preview.data.rawEligible !== impact.rawEligible ||
                  preview.data.aggregateEligible !== impact.aggregateEligible ||
                  preview.data.reportsInvalidated !== impact.reportsInvalidated
                )
                  throw new ConflictException({
                    code: 'ANALYTICS_RETENTION_PREVIEW_REQUIRED',
                  });
              }
              const r = await tx.productAnalyticsPolicy.update({
                where: { id: 'GLOBAL' },
                data: { ...b, revision: { increment: 1 }, refreshedAt: null },
              });
              await command.recordChange(
                tx,
                json(policyView(p)),
                json(policyView(r)),
              );
              await tx.productAnalyticsAggregate.deleteMany({
                where: {
                  OR: [
                    {
                      day: {
                        lt: new Date(Date.now() - b.aggregateDays * 86400000),
                      },
                    },
                    { users: { lt: b.minimumCohort } },
                  ],
                },
              });
              await tx.productAnalyticsReport.updateMany({
                data: { content: null, state: 'PENDING', nextAt: new Date() },
              });
              return json(policyView(r));
            }
            if (route === 'POST analytics/definitions') {
              if ((await tx.productAnalyticsDefinition.count()) >= 100)
                throw new ConflictException({
                  code: 'ANALYTICS_DEFINITION_LIMIT',
                });
              const b = AnalyticsDefinitionInputSchema.parse(payload);
              if (b.formula === 'RATIO' && b.events.length !== 2)
                throw new ConflictException({
                  code: 'ANALYTICS_RATIO_REQUIRES_TWO_EVENTS',
                });
              return json(
                await tx.productAnalyticsDefinition.create({
                  data: { ...b, events: b.events },
                }),
              );
            }
            if (route === 'POST analytics/reports') {
              const b = AnalyticsReportInputSchema.parse(payload);
              await this.authorizeReport(tx, command.adminId, b.type, b.filter);
              if (
                (await tx.productAnalyticsReport.count({
                  where: { adminId: command.adminId },
                })) >= 100
              )
                throw new ConflictException({ code: 'ANALYTICS_REPORT_LIMIT' });
              return json(
                reportView(
                  await tx.productAnalyticsReport.create({
                    data: {
                      ...b,
                      filter: json(b.filter),
                      adminId: command.adminId,
                      nextAt: new Date(),
                      expiresAt: new Date(Date.now() + 7 * 86400000),
                    },
                  }),
                ),
              );
            }
            throw new ForbiddenException();
          },
          (result) => ({
            operation: route,
            resourceId:
              id ??
              (result &&
              typeof result === 'object' &&
              !Array.isArray(result) &&
              'id' in result &&
              typeof result.id === 'string'
                ? result.id
                : null),
          }),
        );
      },
      { isolationLevel: 'RepeatableRead', timeout: 60000 },
    );
  }
}
