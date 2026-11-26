import { Inject, Injectable, HttpException } from '@nestjs/common';
import { AnalyticsFilterSchema } from '@mehran/api-contracts';
import { AnalyticsService, analyticsLock } from './analytics.service.js';
import { AdminCommand } from '../../platform/admin/admin-command.js';
import { analyticsCsv, financialAnalyticsCsv } from './analytics-engine.js';
@Injectable()
export class AnalyticsWorker {
  constructor(@Inject(AnalyticsService) readonly service: AnalyticsService) {}
  async consume() {
    this.service.privacy.assert();
    const refreshed = await this.refresh();
    for (let attempt = 0; ; attempt++) {
      try {
        return (await this.report()) || refreshed;
      } catch (error) {
        if (
          attempt >= 2 ||
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 'P2034'
        )
          throw error;
      }
    }
  }
  private async refresh() {
    this.service.privacy.assert();
    return this.service.db.client.$transaction(
      async (tx) => {
        await analyticsLock(tx);
        await tx.$queryRaw`SELECT id FROM "ProductAnalyticsPolicy" WHERE id='GLOBAL' FOR UPDATE`;
        const p = await this.service.policy(tx),
          now = new Date();
        let changed = false;
        if (!p.refreshedAt || +p.refreshedAt <= +now - 3600000) {
          // Suppressed aggregates never persist identifiers, sketches or user lists.
          await tx.$executeRaw`INSERT INTO "ProductAnalyticsAggregate"(day,"workspaceType",feature,users,events)
      SELECT ("occurredAt" AT TIME ZONE 'UTC')::date,"workspaceType",feature,count(DISTINCT "userId")::integer,count(*)::integer
      FROM "ProductAnalyticsEvent" WHERE "occurredAt">=clock_timestamp()-make_interval(days=>${p.rawDays})
      GROUP BY 1,2,3 HAVING count(DISTINCT "userId")>=${p.minimumCohort}
      ON CONFLICT(day,"workspaceType",feature) DO UPDATE SET users=EXCLUDED.users,events=EXCLUDED.events,"refreshedAt"=clock_timestamp()`;
          await tx.$executeRaw`INSERT INTO "ProductAnalyticsAggregate"(day,"workspaceType",feature,users,events)
      SELECT ("occurredAt" AT TIME ZONE 'UTC')::date,coalesce("workspaceType",'ALL'),coalesce(feature,'ALL'),
      (CASE WHEN GROUPING(feature)=0 THEN count(DISTINCT "userId") ELSE count(DISTINCT "userId") FILTER(WHERE meaningful) END)::integer,
      (CASE WHEN GROUPING(feature)=0 THEN count(*) ELSE count(*) FILTER(WHERE meaningful) END)::integer
      FROM "ProductAnalyticsEvent" WHERE "occurredAt">=clock_timestamp()-make_interval(days=>${p.rawDays})
      GROUP BY GROUPING SETS ((1,"workspaceType"),(1,feature),(1))
      HAVING (CASE WHEN GROUPING(feature)=0 THEN count(DISTINCT "userId") ELSE count(DISTINCT "userId") FILTER(WHERE meaningful) END)>=${p.minimumCohort}
      ON CONFLICT(day,"workspaceType",feature) DO UPDATE SET users=EXCLUDED.users,events=EXCLUDED.events,"refreshedAt"=clock_timestamp()`;
          await tx.$executeRaw`SELECT set_config('planner.analytics_retention','on',true)`;
          await tx.productAnalyticsEvent.deleteMany({
            where: {
              occurredAt: { lt: new Date(+now - p.rawDays * 86400000) },
            },
          });
          await tx.productAnalyticsAggregate.deleteMany({
            where: { day: { lt: new Date(+now - p.aggregateDays * 86400000) } },
          });
          await tx.productAnalyticsReport.deleteMany({
            where: { expiresAt: { lte: now }, intervalHours: null },
          });
          await tx.productAnalyticsPolicy.update({
            where: { id: 'GLOBAL' },
            data: { refreshedAt: now },
          });
          changed = true;
        }
        return changed;
      },
      { timeout: 60000 },
    );
  }
  private async report() {
    this.service.privacy.assert();
    return this.service.db.client.$transaction(
      async (tx) => {
        await analyticsLock(tx);
        await tx.$queryRaw`SELECT id FROM "ProductAnalyticsPolicy" WHERE id='GLOBAL' FOR SHARE`;
        const now = new Date();
        const report = await tx.productAnalyticsReport.findFirst({
          where: {
            nextAt: { lte: now },
            OR: [{ intervalHours: { not: null } }, { expiresAt: { gt: now } }],
          },
          orderBy: [{ nextAt: 'asc' }, { id: 'asc' }],
        });
        if (!report) return false;
        const saved = AnalyticsFilterSchema.parse(report.filter);
        try {
          await AdminCommand.requireInitiator(
            tx,
            report.adminId,
            'admin.analytics.export',
          );
          await this.service.authorizeReport(
            tx,
            report.adminId,
            report.type,
            saved,
          );
        } catch {
          await tx.productAnalyticsReport.update({
            where: { id: report.id },
            data: {
              content: null,
              state: 'DENIED',
              nextAt: null,
              intervalHours: null,
            },
          });
          return true;
        }
        const duration = Date.parse(saved.to) - Date.parse(saved.from);
        const filter = report.intervalHours
          ? {
              ...saved,
              from: new Date(+now - duration).toISOString(),
              to: now.toISOString(),
            }
          : saved;
        const result = await (
          report.type === 'FINANCIAL'
            ? this.service.financial(tx, filter)
            : this.service.query(tx, filter)
        ).catch(async (error: unknown) => {
          if (!(error instanceof HttpException) || error.getStatus() >= 500)
            throw error;
          await tx.productAnalyticsReport.update({
            where: { id: report.id },
            data: {
              content: null,
              state: 'DENIED',
              nextAt: null,
              intervalHours: null,
            },
          });
          await tx.adminAuditEvent.create({
            data: {
              actorAdminId: report.adminId,
              action: 'ANALYTICS_REPORT_REJECTED',
              outcome: 'FAILED',
              permission: 'admin.analytics.export',
              requestId: report.id,
              metadata: { reportId: report.id, status: error.getStatus() },
            },
          });
          return null;
        });
        if (!result) return true;
        const content =
          report.format === 'CSV'
            ? report.type === 'FINANCIAL'
              ? financialAnalyticsCsv(result)
              : analyticsCsv(result)
            : JSON.stringify(result);
        if (Buffer.byteLength(content) > 2000000)
          throw new Error('ANALYTICS_EXPORT_LIMIT');
        await tx.productAnalyticsReport.update({
          where: { id: report.id },
          data: {
            content,
            state: 'READY',
            expiresAt: new Date(+now + 7 * 86400000),
            nextAt: report.intervalHours
              ? new Date(+now + report.intervalHours * 3600000)
              : null,
          },
        });
        await tx.adminAuditEvent.create({
          data: {
            actorAdminId: report.adminId,
            action: 'ANALYTICS_REPORT_READY',
            outcome: 'SUCCEEDED',
            permission: 'admin.analytics.export',
            requestId: report.id,
            metadata: {
              reportId: report.id,
              type: report.type,
              format: report.format,
              bytes: Buffer.byteLength(content),
            },
          },
        });
        return true;
      },
      { timeout: 60000, isolationLevel: 'RepeatableRead' },
    );
  }
}
