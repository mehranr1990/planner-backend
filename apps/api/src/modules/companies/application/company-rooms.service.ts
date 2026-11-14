import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { CompanyResourceAllocation } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { wallInstant } from '../../calendar/public/index.js';
import { CompanyStaffContext } from './company-staff.context.js';
const nextDay = (d: string) =>
  new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
/**
 * OD-3 (owner-approved): rooms are existing Company resources with optional,
 * manager-entered seats/floor. Bookings are the existing allocations (with
 * their overlap guard and approval requests); heat is real allocated time.
 */
@Injectable()
export class CompanyRoomsService {
  constructor(@Inject(CompanyStaffContext) readonly op: CompanyStaffContext) {}
  private bounds(dayValue: string, timezone: string) {
    const start = wallInstant(dayValue + 'T00:00', timezone),
      end = wallInstant(nextDay(dayValue) + 'T00:00', timezone);
    if (!start || !end)
      throw new BadRequestException({ code: 'INVALID_TIMEZONE' });
    return { start, end };
  }
  private busy(a: CompanyResourceAllocation) {
    const end =
      a.state === 'RETURNED' && a.endedAt && a.endedAt < a.endAt
        ? a.endedAt
        : a.endAt;
    return { from: a.startAt, to: end };
  }
  setProfile(
    actor: RequestActor,
    id: string,
    scopeId: string,
    resourceId: string,
    revision: number,
    input: z.infer<typeof c.CompanyRoomProfileInputSchema>,
  ) {
    const body = c.CompanyRoomProfileInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.room.profile',
      resourceId,
      async (s) => {
        this.op.manage(s);
        const resource = await s.tx.companyResource.findFirst({
          where: { id: resourceId, spaceId: s.spaceId, scopeId },
        });
        if (!resource) throw new NotFoundException();
        const before = await s.tx.companyRoomProfile.findUnique({
          where: { resourceId },
        });
        this.op.match(before?.revision ?? 1, revision);
        await s.change();
        const row = before
          ? await s.tx.companyRoomProfile.update({
              where: { resourceId },
              data: { ...body, updatedAt: s.now, revision: { increment: 1 } },
            })
          : await s.tx.companyRoomProfile.create({
              data: { resourceId, spaceId: s.spaceId, scopeId, ...body },
            });
        return c.CompanyRoomSchema.parse({
          id: resourceId,
          name: resource.title,
          seats: row.seats,
          floor: row.floor,
          revision: row.revision,
          bookings: [],
        });
      },
    );
  }
  /** Optional booking title: the booker only; private unless shared (OD-3 follow-up). */
  setBookingTitle(
    actor: RequestActor,
    id: string,
    scopeId: string,
    allocationId: string,
    revision: number,
    input: z.infer<typeof c.RoomBookingTitlePutSchema>,
  ) {
    const body = c.RoomBookingTitlePutSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.room.booking.title',
      allocationId,
      async (s) => {
        const allocation = await s.tx.companyResourceAllocation.findFirst({
          where: { id: allocationId, spaceId: s.spaceId, scopeId },
        });
        if (!allocation || allocation.memberAccessId !== s.me.accessId)
          throw new NotFoundException();
        if (allocation.state !== 'ALLOCATED') throw new ConflictException();
        const before = await s.tx.companyRoomBookingTitle.findUnique({
          where: { allocationId },
        });
        this.op.match(before?.revision ?? 1, revision);
        await s.change();
        const row = before
          ? await s.tx.companyRoomBookingTitle.update({
              where: { allocationId },
              data: { ...body, updatedAt: s.now, revision: { increment: 1 } },
            })
          : await s.tx.companyRoomBookingTitle.create({
              data: { allocationId, spaceId: s.spaceId, scopeId, ...body },
            });
        return c.RoomBookingTitleSchema.parse({
          allocationId,
          title: row.title,
          shared: row.shared,
          revision: row.revision,
        });
      },
    );
  }
  rooms(
    actor: RequestActor,
    id: string,
    scopeId: string,
    query: z.infer<typeof c.CompanyRoomQuerySchema>,
  ) {
    const q = c.CompanyRoomQuerySchema.parse(query);
    const { start, end } = this.bounds(q.day, q.timezone);
    return this.op.read(actor, id, scopeId, async (s) => {
      const profiles = await s.tx.companyRoomProfile.findMany({
        where: { spaceId: s.spaceId, scopeId },
        take: 501,
      });
      if (profiles.length > 500) throw new PayloadTooLargeException();
      const resources = new Map(
        (
          await s.tx.companyResource.findMany({
            where: {
              spaceId: s.spaceId,
              scopeId,
              state: 'ACTIVE',
              id: { in: profiles.map((p) => p.resourceId) },
            },
          })
        ).map((r) => [r.id, r]),
      );
      const allocations = await s.tx.companyResourceAllocation.findMany({
        where: {
          spaceId: s.spaceId,
          scopeId,
          resourceId: { in: [...resources.keys()] },
          state: { in: ['ALLOCATED', 'RETURNED'] },
          startAt: { lt: end },
          endAt: { gt: start },
        },
        orderBy: { startAt: 'asc' },
        take: 5001,
      });
      if (allocations.length > 5000) throw new PayloadTooLargeException();
      const titles = new Map(
        (
          await s.tx.companyRoomBookingTitle.findMany({
            where: {
              spaceId: s.spaceId,
              allocationId: { in: allocations.map((x) => x.id) },
            },
          })
        ).map((t) => [t.allocationId, t]),
      );
      return c.CompanyRoomListSchema.parse({
        day: q.day,
        timezone: q.timezone,
        items: profiles
          .filter((p) => resources.has(p.resourceId))
          .map((p) => ({
            id: p.resourceId,
            name: resources.get(p.resourceId)!.title,
            seats: p.seats,
            floor: p.floor,
            revision: p.revision,
            bookings: allocations
              .filter((a) => a.resourceId === p.resourceId)
              .map((a) => ({ a, b: this.busy(a) }))
              .filter(({ b }) => b.to > start)
              .map(({ a, b }) => ({
                id: a.id,
                from: b.from.toISOString(),
                to: b.to.toISOString(),
                mine: a.memberAccessId === s.me.accessId,
                title:
                  a.memberAccessId === s.me.accessId || titles.get(a.id)?.shared
                    ? (titles.get(a.id)?.title ?? null)
                    : null,
              })),
          })),
      });
    });
  }
  /** Utilization heat: root managers see every context; department managers their own. */
  utilization(
    actor: RequestActor,
    id: string,
    scopeId: string,
    query: z.infer<typeof c.CompanyUtilizationQuerySchema>,
  ) {
    const q = c.CompanyUtilizationQuerySchema.parse(query);
    const periods = q.periods.split(',').map((p) => {
      const [from, to] = p.split('/') as [string, string];
      if (to < from) throw new BadRequestException();
      return {
        from,
        to,
        start: this.bounds(from, q.timezone).start,
        end: this.bounds(to, q.timezone).end,
      };
    });
    return this.op.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      const root = scopeId === s.spaceId;
      const [company, departments, units] = await Promise.all([
        s.tx.company.findUniqueOrThrow({ where: { spaceId: s.spaceId } }),
        s.tx.companyDepartment.findMany({ where: { spaceId: s.spaceId } }),
        s.tx.companyUnit.findMany({ where: { spaceId: s.spaceId } }),
      ]);
      const names = new Map<string, string>([
        [s.spaceId, company.title],
        ...departments.map((d) => [d.scopeId, d.title] as [string, string]),
        ...units.map((u) => [u.scopeId, u.title] as [string, string]),
      ]);
      const scopes = root ? [...names.keys()] : [scopeId];
      const resources = await s.tx.companyResource.findMany({
        where: { spaceId: s.spaceId, scopeId: { in: scopes }, state: 'ACTIVE' },
        take: 2001,
      });
      if (resources.length > 2000) throw new PayloadTooLargeException();
      const first = periods[0]!.start,
        last = periods.at(-1)!.end;
      const allocations = await s.tx.companyResourceAllocation.findMany({
        where: {
          spaceId: s.spaceId,
          resourceId: { in: resources.map((r) => r.id) },
          state: { in: ['ALLOCATED', 'RETURNED'] },
          startAt: { lt: last },
          endAt: { gt: first },
        },
        take: 20001,
      });
      if (allocations.length > 20000) throw new PayloadTooLargeException();
      return c.CompanyUtilizationSchema.parse({
        periods: periods.map((p) => ({ from: p.from, to: p.to })),
        rows: scopes.map((scope) => {
          const own = resources.filter((r) => r.scopeId === scope),
            ids = new Set(own.map((r) => r.id));
          return {
            scopeId: scope,
            name: names.get(scope) ?? '',
            resources: own.length,
            values: periods.map((p) => {
              if (!own.length) return null;
              const span = p.end.getTime() - p.start.getTime();
              const used = allocations
                .filter((a) => ids.has(a.resourceId))
                .map((a) => this.busy(a))
                .reduce(
                  (n, b) =>
                    n +
                    Math.max(
                      0,
                      Math.min(b.to.getTime(), p.end.getTime()) -
                        Math.max(b.from.getTime(), p.start.getTime()),
                    ),
                  0,
                );
              return Math.min(
                10000,
                Math.round((used * 10000) / (span * own.length)),
              );
            }),
          };
        }),
      });
    });
  }
}
