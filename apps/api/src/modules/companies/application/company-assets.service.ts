import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  PayloadTooLargeException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import type { StaffContext, StaffPage } from './company-staff.context.js';
import { CompanyStaffContext } from './company-staff.context.js';
import {
  normalizedAssetTag,
  observedMilliseconds,
} from '../domain/company-gap.js';
const ref = (accessId: string, generation: number) => ({
  accessId,
  generation,
});
export function companyDates<T extends { createdAt: Date; updatedAt: Date }>(
  r: T,
) {
  return {
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
@Injectable()
export class CompanyAssetsService {
  utilization(
    actor: RequestActor,
    id: string,
    scopeId: string,
    query: z.infer<typeof c.CompanyObservationRangeSchema>,
  ) {
    const q = c.CompanyObservationRangeSchema.parse(query);
    return this.op.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      const resources = await s.tx.companyResource.findMany({
        where: this.op.where(s),
        take: 1001,
      });
      if (resources.length > 1000) throw new PayloadTooLargeException();
      const from = Date.parse(q.from),
        to = Date.parse(q.to);
      const bookings = await s.tx.companyResourceAllocation.findMany({
          where: {
            ...this.op.where(s),
            state: { in: ['ALLOCATED', 'RETURNED'] },
            startAt: { lt: new Date(to) },
            endAt: { gt: new Date(from) },
          },
          take: 10001,
        }),
        custodies = await s.tx.companyAssetCustody.findMany({
          where: {
            ...this.op.where(s),
            assignedAt: { lt: new Date(to) },
            OR: [{ returnedAt: null }, { returnedAt: { gt: new Date(from) } }],
          },
          take: 10001,
        });
      if (bookings.length > 10000 || custodies.length > 10000)
        throw new PayloadTooLargeException();
      return c.CompanyResourceUsageSchema.parse({
        ...q,
        items: resources.map((r) => {
          const b = bookings.filter((b) => b.resourceId === r.id),
            cs = custodies.filter((c) => c.resourceId === r.id),
            used = observedMilliseconds(
              b.map((b) => ({
                from: b.startAt.getTime(),
                to: Math.min(
                  b.endAt.getTime(),
                  b.endedAt?.getTime() ?? b.endAt.getTime(),
                ),
              })),
              from,
              to,
            ),
            custody = observedMilliseconds(
              cs.map((c) => ({
                from: c.assignedAt.getTime(),
                to: Math.min(
                  c.returnedAt?.getTime() ?? s.now.getTime(),
                  s.now.getTime(),
                ),
              })),
              from,
              to,
            );
          return {
            resourceId: r.id,
            bookedMilliseconds: used,
            custodyMilliseconds: custody,
            occupancyBasisPoints: b.length
              ? Math.round((used * 10000) / (to - from))
              : null,
            occupancyEvidence: b.length ? 'OBSERVED' : 'UNKNOWN',
            custodyEvidence: cs.length ? 'OBSERVED' : 'UNKNOWN',
          };
        }),
      });
    });
  }
  constructor(@Inject(CompanyStaffContext) readonly op: CompanyStaffContext) {}
  private async resource(s: StaffContext, id: string) {
    const r = await s.tx.companyResource.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!r) throw new NotFoundException();
    return r;
  }
  tag(actor: RequestActor, id: string, scopeId: string, resourceId: string) {
    return this.op.read(actor, id, scopeId, async (s) => {
      const r = await this.resource(s, resourceId);
      return c.CompanyAssetTagSchema.strip().parse(r);
    });
  }
  setTag(
    actor: RequestActor,
    id: string,
    scopeId: string,
    resourceId: string,
    revision: number,
    input: z.infer<typeof c.CompanyAssetTagInputSchema>,
  ) {
    const body = c.CompanyAssetTagInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.asset.tag',
      resourceId,
      async (s) => {
        this.op.manage(s);
        const r = await this.resource(s, resourceId);
        this.op.match(r.revision, revision);
        if (r.state !== 'ACTIVE') throw new ConflictException();
        const tag =
          body.assetTag === null ? null : normalizedAssetTag(body.assetTag);
        if (
          tag !== null &&
          (await s.tx.companyResource.findFirst({
            where: {
              spaceId: s.spaceId,
              assetTag: tag,
              id: { not: resourceId },
            },
          }))
        )
          throw new ConflictException({ code: 'ASSET_TAG_CONFLICT' });
        await s.change();
        return c.CompanyAssetTagSchema.strip().parse(
          await s.tx.companyResource.update({
            where: { id: resourceId },
            data: { assetTag: tag, ...this.op.changed(s) },
          }),
        );
      },
    );
  }
  private custodyView(
    r: Awaited<
      ReturnType<StaffContext['tx']['companyAssetCustody']['findFirstOrThrow']>
    >,
  ) {
    return c.CompanyCustodySchema.strip().parse({
      ...companyDates(r),
      member: ref(r.memberAccessId, r.memberGeneration),
      assignedAt: r.assignedAt.toISOString(),
      expectedReturnAt: r.expectedReturnAt?.toISOString() ?? null,
      returnedAt: r.returnedAt?.toISOString() ?? null,
    });
  }
  private maintenanceView(
    r: Awaited<
      ReturnType<
        StaffContext['tx']['companyAssetMaintenance']['findFirstOrThrow']
      >
    >,
  ) {
    return c.CompanyMaintenanceSchema.strip().parse({
      ...companyDates(r),
      responsible: ref(r.responsibleAccessId, r.responsibleGeneration),
      scheduledAt: r.scheduledAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    });
  }
  private async available(s: StaffContext, resourceId: string) {
    const r = await this.resource(s, resourceId);
    if (
      r.state !== 'ACTIVE' ||
      (await s.tx.companyRoomProfile.findUnique({ where: { resourceId } }))
    )
      throw new ConflictException({ code: 'PHYSICAL_ASSET_REQUIRED' });
    const [custody, maintenance, bookings] = await Promise.all([
      s.tx.companyAssetCustody.count({
        where: { resourceId, returnedAt: null },
      }),
      s.tx.companyAssetMaintenance.count({
        where: { resourceId, state: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
      }),
      s.tx.companyResourceAllocation.count({
        where: { resourceId, state: 'ALLOCATED', endAt: { gt: s.now } },
      }),
    ]);
    if (custody || maintenance || bookings)
      throw new ConflictException({ code: 'RESOURCE_UNAVAILABLE' });
  }
  custody(
    actor: RequestActor,
    id: string,
    scopeId: string,
    resourceId: string,
    q: StaffPage,
  ) {
    return this.op.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      await this.resource(s, resourceId);
      return this.op.page(
        s,
        'company.asset.custody:' + resourceId,
        q,
        async () =>
          (
            await s.tx.companyAssetCustody.findMany({
              where: { ...this.op.where(s), resourceId },
              take: 1001,
            })
          ).map((r) => this.custodyView(r)),
      );
    });
  }
  assign(
    actor: RequestActor,
    id: string,
    scopeId: string,
    resourceId: string,
    input: z.infer<typeof c.CompanyCustodyCreateSchema>,
    key?: string,
  ) {
    const body = c.CompanyCustodyCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.asset.assign',
      body.id,
      async (s) => {
        this.op.manage(s);
        await this.op.member(s, body.member);
        const result = await this.op.once(
          s,
          'company.asset.assign',
          key,
          { resourceId, ...body },
          async () => {
            await this.available(s, resourceId);
            if (
              body.expectedReturnAt &&
              new Date(body.expectedReturnAt) <= s.now
            )
              throw new ConflictException({ code: 'RETURN_DATE_INVALID' });
            if (
              (await s.tx.companyAssetCustody.count({
                where: this.op.where(s),
              })) >= 1000
            )
              throw new PayloadTooLargeException();
            await s.change();
            return s.tx.companyAssetCustody.create({
              data: {
                ...this.op.where(s),
                id: body.id,
                resourceId,
                memberAccessId: body.member.accessId,
                memberGeneration: body.member.generation,
                issuedByActorId: s.root.actorId,
                assignedAt: s.now,
                expectedReturnAt: body.expectedReturnAt,
              },
            });
          },
        );
        return this.custodyView(
          await s.tx.companyAssetCustody.findFirstOrThrow({
            where: { ...this.op.where(s), id: result.id },
          }),
        );
      },
    );
  }
  returnAsset(
    actor: RequestActor,
    id: string,
    scopeId: string,
    resourceId: string,
    custodyId: string,
    revision: number,
  ) {
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.asset.return',
      custodyId,
      async (s) => {
        this.op.manage(s);
        await this.resource(s, resourceId);
        const r = await s.tx.companyAssetCustody.findFirst({
          where: { ...this.op.where(s), id: custodyId, resourceId },
        });
        if (!r) throw new NotFoundException();
        this.op.match(r.revision, revision);
        if (r.returnedAt) throw new ConflictException();
        await s.change();
        return this.custodyView(
          await s.tx.companyAssetCustody.update({
            where: { id: r.id },
            data: {
              returnedAt: s.now,
              returnedByActorId: s.root.actorId,
              ...this.op.changed(s),
            },
          }),
        );
      },
    );
  }
  maintenance(
    actor: RequestActor,
    id: string,
    scopeId: string,
    resourceId: string,
    q: StaffPage,
  ) {
    return this.op.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      await this.resource(s, resourceId);
      return this.op.page(
        s,
        'company.asset.maintenance:' + resourceId,
        q,
        async () =>
          (
            await s.tx.companyAssetMaintenance.findMany({
              where: { ...this.op.where(s), resourceId },
              take: 1001,
            })
          ).map((r) => this.maintenanceView(r)),
      );
    });
  }
  schedule(
    actor: RequestActor,
    id: string,
    scopeId: string,
    resourceId: string,
    input: z.infer<typeof c.CompanyMaintenanceCreateSchema>,
    key?: string,
  ) {
    const body = c.CompanyMaintenanceCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.asset.maintenance',
      body.id,
      async (s) => {
        this.op.manage(s);
        await this.op.member(s, body.responsible);
        const result = await this.op.once(
          s,
          'company.asset.maintenance',
          key,
          { resourceId, ...body },
          async () => {
            await this.available(s, resourceId);
            if (
              (await s.tx.companyAssetMaintenance.count({
                where: this.op.where(s),
              })) >= 1000
            )
              throw new PayloadTooLargeException();
            await s.change();
            return s.tx.companyAssetMaintenance.create({
              data: {
                ...this.op.where(s),
                id: body.id,
                resourceId,
                kind: body.kind,
                reason: body.reason,
                scheduledAt: body.scheduledAt,
                responsibleAccessId: body.responsible.accessId,
                responsibleGeneration: body.responsible.generation,
                createdByActorId: s.root.actorId,
              },
            });
          },
        );
        return this.maintenanceView(
          await s.tx.companyAssetMaintenance.findFirstOrThrow({
            where: { ...this.op.where(s), id: result.id },
          }),
        );
      },
    );
  }
  changeMaintenance(
    actor: RequestActor,
    id: string,
    scopeId: string,
    resourceId: string,
    maintenanceId: string,
    revision: number,
    input: z.infer<typeof c.CompanyMaintenanceChangeSchema>,
  ) {
    const body = c.CompanyMaintenanceChangeSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.asset.maintenance.change',
      maintenanceId,
      async (s) => {
        this.op.manage(s);
        const r = await s.tx.companyAssetMaintenance.findFirst({
          where: { ...this.op.where(s), id: maintenanceId, resourceId },
        });
        if (!r) throw new NotFoundException();
        this.op.match(r.revision, revision);
        if (
          !['SCHEDULED', 'IN_PROGRESS'].includes(r.state) ||
          (body.state === 'IN_PROGRESS' && r.state !== 'SCHEDULED')
        )
          throw new ConflictException();
        await s.change();
        return this.maintenanceView(
          await s.tx.companyAssetMaintenance.update({
            where: { id: r.id },
            data: {
              state: body.state,
              completedAt: body.state === 'COMPLETED' ? s.now : null,
              ...this.op.changed(s),
            },
          }),
        );
      },
    );
  }
}
