import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { AnalyticsTasks } from '../public/analytics.js';
import { localDateAt } from '../domain/recurrence.js';
import type { InsightReadModel } from '@mehran/api-contracts';
function boundary(date: string, timezone: string) {
  let lo = Date.parse(date + 'T00:00:00Z') - 3 * 86400000,
    hi = lo + 6 * 86400000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDateAt(new Date(mid), timezone) < date) lo = mid + 1;
    else hi = mid;
  }
  return new Date(lo);
}
@Injectable()
export class AnalyticsTasksRepository extends AnalyticsTasks {
  async read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    r: Parameters<AnalyticsTasks['read']>[2],
  ): Promise<InsightReadModel> {
    const start = boundary(r.from, r.timezone),
      end = boundary(r.to, r.timezone);
    // Only scalar facts cross this facade; no titles or per-Task relation fan-out.
    const completed = r.cohort === 'COMPLETED_AT';
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        status: string;
        occurrenceState: string | null;
        at: Date;
      }>
    >(Prisma.sql`
   SELECT t.id,t.status,o.state AS "occurrenceState",${completed ? Prisma.sql`c."createdAt"` : r.cohort === 'DUE_DATE' ? Prisma.sql`t."dueAt"` : Prisma.sql`t."scheduledDate"`} AS at
   FROM "Task" t
   ${completed ? Prisma.sql`JOIN "TaskChange" c ON c."spaceId"=t."spaceId" AND c."taskId"=t.id AND c.kind='COMPLETED'` : Prisma.empty}
   LEFT JOIN "TaskOccurrence" o ON o."spaceId"=t."spaceId" AND o."taskId"=t.id
   WHERE t."spaceId"=${scope.spaceId}::uuid AND t."deletedAt" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "TaskRecurrence" m WHERE m."spaceId"=t."spaceId" AND m."masterTaskId"=t.id)
   AND (o.state IS NULL OR o.state NOT IN ('SKIPPED','CANCELED'))
   AND ${completed ? Prisma.sql`c."createdAt">=${start} AND c."createdAt"<${end}` : r.cohort === 'DUE_DATE' ? Prisma.sql`t."dueAt">=${start} AND t."dueAt"<${end}` : Prisma.sql`t."scheduledDate">=${r.from}::date AND t."scheduledDate"<${r.to}::date`}
   LIMIT 10001`);
    if (rows.length > 10000)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        details: [{ path: 'range', code: 'RANGE_TOO_DENSE' }],
      });
    // Use the same IANA interpreter as boundary resolution, including zone aliases.
    const format = new Intl.DateTimeFormat('en-CA', {
      timeZone: r.timezone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const facts = rows.map((row) => ({
      ...row,
      localDate:
        r.cohort === 'SCHEDULED_DATE'
          ? row.at.toISOString().slice(0, 10)
          : format.format(row.at),
    }));
    return {
      metrics: (from, to) => {
        const values = facts.filter(
            (v) => v.localDate >= from && v.localDate < to,
          ),
          count = completed
            ? new Set(values.map((v) => v.id)).size
            : values.filter((v) => v.status === 'DONE').length;
        return [
          {
            id: 'tasks.completed',
            sourceType: 'TASK',
            value: String(count),
            definition: completed
              ? 'DISTINCT_TASKS_WITH_HISTORICAL_COMPLETION_TRANSITION'
              : 'CURRENT_DONE_IN_' + r.cohort + '_COHORT',
          },
          ...(completed
            ? []
            : [
                {
                  id: 'tasks.completion_rate',
                  sourceType: 'TASK' as const,
                  value: null,
                  numerator: count,
                  denominator: values.length,
                  definition:
                    'CURRENT_NONDELETED_ORDINARY_TASKS_BY_' +
                    r.cohort +
                    '_INCLUDING_CANCELED',
                },
              ]),
        ];
      },
    };
  }
}
