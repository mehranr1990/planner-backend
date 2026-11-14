import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  CompanyStaffProfile,
  CompanyAvailabilityDay,
  CompanyResource,
  CompanyResourceAllocation,
  Prisma,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { CompanyErasure } from '../../spaces/public/index.js';
import { CompanyStaffContext } from './company-staff.context.js';
import type {
  StaffContext,
  StaffPage,
  StaffMember,
} from './company-staff.context.js';
const ref = (r: { memberAccessId: string; memberGeneration: number }) => ({
  accessId: r.memberAccessId,
  generation: r.memberGeneration,
});
const dates = (r: { createdAt: Date; updatedAt: Date }) => ({
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
const availability = (r: CompanyAvailabilityDay) =>
  c.CompanyAvailabilitySchema.strip().parse({
    ...r,
    ...dates(r),
    member: ref(r),
    date: r.date.toISOString().slice(0, 10),
  });
const resource = (r: CompanyResource) =>
  c.CompanyResourceSchema.strip().parse({ ...r, ...dates(r) });
const allocation = (r: CompanyResourceAllocation) =>
  c.CompanyAllocationSchema.strip().parse({
    ...r,
    ...dates(r),
    member: ref(r),
    startAt: r.startAt.toISOString(),
    endAt: r.endAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
  });
@Injectable()
export class CompanyStaffService implements OnModuleInit {
  constructor(
    @Inject(CompanyStaffContext) readonly op: CompanyStaffContext,
    @Inject(CompanyErasure) private readonly erasure: CompanyErasure,
  ) {}
  onModuleInit() {
    this.erasure.register((tx, id, actorId) =>
      this.eraseActor(tx, id, actorId),
    );
  }
  private async profileView(s: StaffContext, r: CompanyStaffProfile) {
    const member = await this.op.member(s, ref(r));
    const currentEmail = r.workEmail
      ? await this.op.access.staffEmail(s, member.userId)
      : null;
    return c.CompanyStaffProfileSchema.strip().parse({
      ...r,
      ...dates(r),
      member: ref(r),
      supervisor: r.supervisorAccessId
        ? { accessId: r.supervisorAccessId, generation: r.supervisorGeneration }
        : null,
      workEmail: r.workEmail === currentEmail ? r.workEmail : null,
      redactedAt: r.redactedAt?.toISOString() ?? null,
    });
  }
  private async profile(s: StaffContext, id: string) {
    const r = await s.tx.companyStaffProfile.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!r) throw new NotFoundException();
    await this.op.member(s, ref(r));
    return r;
  }
  private async supervisor(s: StaffContext, m: StaffMember | null | undefined) {
    if (m) await this.op.access.staffMember(s, s.spaceId, m);
  }
  async createProfile(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyStaffProfileCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.CompanyStaffProfileCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.profile.create',
      body.id,
      async (s) => {
        this.op.manage(s);
        await this.op.member(s, body.member);
        await this.supervisor(s, body.supervisor);
        await this.op.once(s, 'company.profile.create', key, body, async () => {
          await this.op.growth(
            s,
            'company.staff-profile',
            await s.tx.companyStaffProfile.count({ where: { spaceId: id } }),
          );
          await s.change();
          return s.tx.companyStaffProfile.create({
            data: {
              id: body.id,
              ...this.op.where(s),
              memberAccessId: body.member.accessId,
              memberGeneration: body.member.generation,
              position: body.position,
              workStatus: body.workStatus,
              supervisorAccessId: body.supervisor?.accessId ?? null,
              supervisorGeneration: body.supervisor?.generation ?? null,
            },
          });
        });
        return this.profileView(s, await this.profile(s, body.id));
      },
      'company.staff-profile',
    );
  }
  async readProfile(
    actor: RequestActor,
    id: string,
    scopeId: string,
    profileId: string,
  ) {
    return this.op.read(actor, id, scopeId, async (s) =>
      this.profileView(s, await this.profile(s, profileId)),
    );
  }
  async profiles(
    actor: RequestActor,
    id: string,
    scopeId: string,
    q: StaffPage,
  ) {
    return this.op.read(actor, id, scopeId, async (s) =>
      this.op.page(s, 'company.profiles', q, async () => {
        const live = await this.op.live(s),
          rows = await s.tx.companyStaffProfile.findMany({
            where: this.op.where(s),
            take: 1001,
          });
        return Promise.all(
          rows
            .filter(
              (r) =>
                live.get(r.memberAccessId)?.generation === r.memberGeneration,
            )
            .map((r) => this.profileView(s, r)),
        );
      }),
    );
  }
  async patchProfile(
    actor: RequestActor,
    id: string,
    scopeId: string,
    profileId: string,
    revision: number,
    input: z.infer<typeof c.CompanyStaffProfilePatchSchema>,
  ) {
    const body = c.CompanyStaffProfilePatchSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.profile.update',
      profileId,
      async (s) => {
        this.op.manage(s);
        const row = await this.profile(s, profileId);
        this.op.match(row.revision, revision);
        if (row.redactedAt) throw new ConflictException();
        await this.supervisor(s, body.supervisor);
        await s.change();
        return this.profileView(
          s,
          await s.tx.companyStaffProfile.update({
            where: { id: profileId },
            data: {
              ...(body.position !== undefined
                ? { position: body.position }
                : {}),
              ...(body.workStatus !== undefined
                ? { workStatus: body.workStatus }
                : {}),
              ...(body.supervisor !== undefined
                ? {
                    supervisorAccessId: body.supervisor?.accessId ?? null,
                    supervisorGeneration: body.supervisor?.generation ?? null,
                  }
                : {}),
              ...this.op.changed(s),
            },
          }),
        );
      },
    );
  }
  async contact(
    actor: RequestActor,
    id: string,
    scopeId: string,
    profileId: string,
    revision: number,
    input: z.infer<typeof c.CompanyWorkContactSchema>,
  ) {
    const body = c.CompanyWorkContactSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.contact.change',
      profileId,
      async (s) => {
        const row = await this.profile(s, profileId);
        if (!this.op.self(s, ref(row))) throw new ForbiddenException();
        this.op.match(row.revision, revision);
        if (row.redactedAt) throw new ConflictException();
        const email = body.published
          ? await this.op.access.staffEmail(s, s.actor.userId)
          : null;
        if (body.published && !email) throw new ForbiddenException();
        await s.change();
        return this.profileView(
          s,
          await s.tx.companyStaffProfile.update({
            where: { id: profileId },
            data: { workEmail: email, ...this.op.changed(s) },
          }),
        );
      },
    );
  }
  private workDetails(r: CompanyStaffProfile) {
    return c.CompanyWorkDetailsSchema.strip().parse({
      ...r,
      profileId: r.id,
    });
  }
  /** C-M3: the employee or a scope manager maintains work phone, location and hours. */
  async setWorkDetails(
    actor: RequestActor,
    id: string,
    scopeId: string,
    profileId: string,
    revision: number,
    input: z.infer<typeof c.CompanyWorkDetailsInputSchema>,
  ) {
    const body = c.CompanyWorkDetailsInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.profile.workdetails',
      profileId,
      async (s) => {
        const row = await this.profile(s, profileId);
        if (!this.op.self(s, ref(row))) this.op.manage(s);
        this.op.match(row.revision, revision);
        if (row.redactedAt) throw new ConflictException();
        await s.change();
        return this.workDetails(
          await s.tx.companyStaffProfile.update({
            where: { id: profileId },
            data: {
              ...(body.workPhone !== undefined
                ? { workPhone: body.workPhone }
                : {}),
              ...(body.workLocation !== undefined
                ? { workLocation: body.workLocation }
                : {}),
              ...(body.workHours !== undefined
                ? { workHours: body.workHours }
                : {}),
              ...this.op.changed(s),
            },
          }),
        );
      },
    );
  }
  /**
   * C-M3 public internal directory: name, position, department (scope) and
   * work contact only. Supervisors, redacted rows and stale admissions are
   * never projected; the ordinary directory policy still applies.
   */
  async directory(
    actor: RequestActor,
    id: string,
    scopeId: string,
    q: StaffPage,
  ) {
    return this.op.read(actor, id, scopeId, async (s) => {
      const result = await this.op.page(s, 'company.directory', q, async () => {
        const live = await this.op.live(s),
          rows = await s.tx.companyStaffProfile.findMany({
            where: { ...this.op.where(s), redactedAt: null },
            take: 1001,
          });
        const out = [];
        for (const r of rows) {
          if (live.get(r.memberAccessId)?.generation !== r.memberGeneration)
            continue;
          const view = await this.profileView(s, r);
          out.push({
            id: r.id,
            entry: c.CompanyDirectoryEntrySchema.strip().parse({
              ...r,
              profileId: r.id,
              member: view.member,
              workEmail: view.workEmail,
            }),
          });
        }
        return out;
      });
      return { ...result, items: result.items.map((r) => r.entry) };
    });
  }
  async eraseProfile(
    actor: RequestActor,
    id: string,
    scopeId: string,
    profileId: string,
    revision: number,
  ) {
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.profile.erase',
      profileId,
      async (s) => {
        const row = await this.profile(s, profileId);
        if (!this.op.self(s, ref(row))) throw new ForbiddenException();
        this.op.match(row.revision, revision);
        await this.op.erasureAllowed(s.tx, id);
        if (row.redactedAt) return this.profileView(s, row);
        await s.change();
        return this.profileView(
          s,
          await s.tx.companyStaffProfile.update({
            where: { id: profileId },
            data: {
              position: null,
              supervisorAccessId: null,
              supervisorGeneration: null,
              workStatus: 'INACTIVE',
              workEmail: null,
              workPhone: null,
              workLocation: null,
              workHours: null,
              redactedAt: s.now,
              ...this.op.changed(s),
            },
          }),
        );
      },
    );
  }
  async createAvailability(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyAvailabilityCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.CompanyAvailabilityCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.availability.create',
      body.id,
      async (s) => {
        if (!this.op.self(s, body.member)) this.op.manage(s);
        await this.op.member(s, body.member);
        await this.op.once(
          s,
          'company.availability.create',
          key,
          body,
          async () => {
            await this.op.growth(
              s,
              'company.availability-day',
              await s.tx.companyAvailabilityDay.count({
                where: { spaceId: id },
              }),
            );
            await s.change();
            return s.tx.companyAvailabilityDay.create({
              data: {
                id: body.id,
                ...this.op.where(s),
                memberAccessId: body.member.accessId,
                memberGeneration: body.member.generation,
                date: new Date(body.date + 'T00:00:00Z'),
                timezone: body.timezone,
                availableMinutes: body.availableMinutes,
              },
            });
          },
        );
        return availability(
          await s.tx.companyAvailabilityDay.findUniqueOrThrow({
            where: { id: body.id },
          }),
        );
      },
      'company.availability-day',
    );
  }
  async availability(
    actor: RequestActor,
    id: string,
    scopeId: string,
    q: StaffPage,
  ) {
    return this.op.read(actor, id, scopeId, async (s) =>
      this.op.page(s, 'company.availability', q, async () => {
        const live = await this.op.live(s);
        return (
          await s.tx.companyAvailabilityDay.findMany({
            where: this.op.where(s),
            take: 1001,
          })
        )
          .filter(
            (r) =>
              live.get(r.memberAccessId)?.generation === r.memberGeneration,
          )
          .map(availability);
      }),
    );
  }
  async patchAvailability(
    actor: RequestActor,
    id: string,
    scopeId: string,
    availabilityId: string,
    revision: number,
    input: z.infer<typeof c.CompanyAvailabilityPatchSchema>,
  ) {
    const body = c.CompanyAvailabilityPatchSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.availability.update',
      availabilityId,
      async (s) => {
        const row = await s.tx.companyAvailabilityDay.findFirst({
          where: { ...this.op.where(s), id: availabilityId },
        });
        if (!row) throw new NotFoundException();
        await this.op.member(s, ref(row));
        if (!this.op.self(s, ref(row))) this.op.manage(s);
        this.op.match(row.revision, revision);
        await s.change();
        return availability(
          await s.tx.companyAvailabilityDay.update({
            where: { id: row.id },
            data: {
              availableMinutes: body.availableMinutes,
              ...this.op.changed(s),
            },
          }),
        );
      },
    );
  }
  private async resource(s: StaffContext, id: string) {
    const row = await s.tx.companyResource.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  async createResource(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyResourceCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.CompanyResourceCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.resource.create',
      body.id,
      async (s) => {
        this.op.manage(s);
        await this.op.once(
          s,
          'company.resource.create',
          key,
          body,
          async () => {
            await this.op.growth(
              s,
              'company.resource',
              await s.tx.companyResource.count({ where: { spaceId: id } }),
            );
            await s.change();
            return s.tx.companyResource.create({
              data: {
                ...body,
                ...this.op.where(s),
                state: 'ACTIVE',
                createdByActorId: s.root.actorId,
              },
            });
          },
        );
        return resource(await this.resource(s, body.id));
      },
      'company.resource',
    );
  }
  async resources(
    actor: RequestActor,
    id: string,
    scopeId: string,
    q: StaffPage,
  ) {
    return this.op.read(actor, id, scopeId, (s) =>
      this.op.page(s, 'company.resources', q, async () =>
        (
          await s.tx.companyResource.findMany({
            where: this.op.where(s),
            take: 1001,
          })
        ).map(resource),
      ),
    );
  }
  async readResource(
    actor: RequestActor,
    id: string,
    scopeId: string,
    resourceId: string,
  ) {
    return this.op.read(actor, id, scopeId, async (s) =>
      resource(await this.resource(s, resourceId)),
    );
  }
  async patchResource(
    actor: RequestActor,
    id: string,
    scopeId: string,
    resourceId: string,
    revision: number,
    input: z.infer<typeof c.CompanyResourcePatchSchema>,
  ) {
    const body = c.CompanyResourcePatchSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.resource.update',
      resourceId,
      async (s) => {
        this.op.manage(s);
        const row = await this.resource(s, resourceId);
        this.op.match(row.revision, revision);
        if (row.state !== 'ACTIVE') throw new ConflictException();
        await s.change();
        return resource(
          await s.tx.companyResource.update({
            where: { id: row.id },
            data: {
              ...(body.title !== undefined ? { title: body.title } : {}),
              ...(body.description !== undefined
                ? { description: body.description }
                : {}),
              ...this.op.changed(s),
            },
          }),
        );
      },
    );
  }
  async retireResource(
    actor: RequestActor,
    id: string,
    scopeId: string,
    resourceId: string,
    revision: number,
  ) {
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.resource.retire',
      resourceId,
      async (s) => {
        this.op.manage(s);
        const row = await this.resource(s, resourceId);
        this.op.match(row.revision, revision);
        if (
          row.state !== 'ACTIVE' ||
          (await s.tx.companyResourceAllocation.count({
            where: { resourceId, state: 'ALLOCATED' },
          }))
        )
          throw new ConflictException();
        await s.change();
        return resource(
          await s.tx.companyResource.update({
            where: { id: row.id },
            data: { state: 'RETIRED', ...this.op.changed(s) },
          }),
        );
      },
    );
  }
  async createAllocation(
    actor: RequestActor,
    id: string,
    scopeId: string,
    resourceId: string,
    input: z.infer<typeof c.CompanyAllocationCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.CompanyAllocationCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.allocation.create',
      body.id,
      async (s) => {
        this.op.manage(s);
        await this.op.member(s, body.member);
        const item = await this.resource(s, resourceId);
        await this.op.once(
          s,
          'company.allocation.create',
          key,
          { resourceId, ...body },
          async () => {
            if (
              item.state !== 'ACTIVE' ||
              (await s.tx.companyResourceAllocation.count({
                where: {
                  resourceId,
                  state: 'ALLOCATED',
                  startAt: { lt: new Date(body.endAt) },
                  endAt: { gt: new Date(body.startAt) },
                },
              }))
            )
              throw new ConflictException({ code: 'RESOURCE_UNAVAILABLE' });
            await this.op.growth(
              s,
              'company.allocation',
              await s.tx.companyResourceAllocation.count({
                where: { spaceId: id },
              }),
            );
            await s.change();
            return s.tx.companyResourceAllocation.create({
              data: {
                id: body.id,
                ...this.op.where(s),
                resourceId,
                memberAccessId: body.member.accessId,
                memberGeneration: body.member.generation,
                createdByActorId: s.root.actorId,
                startAt: new Date(body.startAt),
                endAt: new Date(body.endAt),
                state: 'ALLOCATED',
              },
            });
          },
        );
        const row = await this.allocation(s, body.id);
        if (row.state !== 'ALLOCATED') throw new ConflictException();
        return allocation(row);
      },
      'company.allocation',
    );
  }
  private async allocation(s: StaffContext, id: string) {
    const row = await s.tx.companyResourceAllocation.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  async readAllocation(
    actor: RequestActor,
    id: string,
    scopeId: string,
    allocationId: string,
  ) {
    return this.op.read(actor, id, scopeId, async (s) =>
      allocation(await this.allocation(s, allocationId)),
    );
  }
  async allocations(
    actor: RequestActor,
    id: string,
    scopeId: string,
    resourceId: string,
    q: StaffPage,
  ) {
    return this.op.read(actor, id, scopeId, async (s) => {
      await this.resource(s, resourceId);
      return this.op.page(s, 'company.allocations:' + resourceId, q, async () =>
        (
          await s.tx.companyResourceAllocation.findMany({
            where: { ...this.op.where(s), resourceId },
            take: 1001,
          })
        ).map(allocation),
      );
    });
  }
  async endAllocation(
    actor: RequestActor,
    id: string,
    scopeId: string,
    allocationId: string,
    revision: number,
    state: 'CANCELED' | 'RETURNED',
  ) {
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.allocation.' + state.toLowerCase(),
      allocationId,
      async (s) => {
        this.op.manage(s);
        const row = await this.allocation(s, allocationId);
        this.op.match(row.revision, revision);
        if (row.state !== 'ALLOCATED') throw new ConflictException();
        if (state === 'RETURNED' && row.startAt > s.now)
          throw new ConflictException();
        await s.change();
        return allocation(
          await s.tx.companyResourceAllocation.update({
            where: { id: row.id },
            data: { state, endedAt: s.now, ...this.op.changed(s) },
          }),
        );
      },
    );
  }
  private async eraseActor(
    tx: Prisma.TransactionClient,
    id: string,
    actorId: string,
  ) {
    const admissions = await this.op.access.staffActorAdmissions(
        tx,
        id,
        actorId,
      ),
      ids = admissions.map((a) => a.id);
    // Identity erasure always removes direct contacts. Scoped retention never blocks unrelated Personal erasure.
    await tx.companyStaffProfile.updateMany({
      where: { spaceId: id, memberAccessId: { in: ids }, redactedAt: null },
      data: {
        position: null,
        supervisorAccessId: null,
        supervisorGeneration: null,
        workStatus: 'INACTIVE',
        workEmail: null,
        workPhone: null,
        workLocation: null,
        workHours: null,
        redactedAt: new Date(),
        revision: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    const cases = await tx.companyEmployeeCase.findMany({
      where: { spaceId: id, subjectAccessId: { in: ids }, redactedAt: null },
      select: { id: true },
      take: 1001,
    });
    if (cases.length > 1000)
      throw new ConflictException({ code: 'COMPANY_ERASURE_BOUND_EXCEEDED' });
    // Generic shared work holds confer no right to retain employee-sensitive payloads.
    // Personal erasure removes them; an actual HR/legal hold needs a separately approved disposition.
    await tx.companyEmployeeCase.updateMany({
      where: { id: { in: cases.map((r) => r.id) } },
      data: {
        reason: null,
        evidence: null,
        redactedAt: new Date(),
        revision: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    // Resource request reasons (C-M4) are free text written by the requester.
    await tx.companyResourceRequest.updateMany({
      where: { spaceId: id, requesterActorId: actorId, redactedAt: null },
      data: {
        reason: null,
        redactedAt: new Date(),
        revision: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    const requests = await tx.companyResourceRequest.findMany({
      where: { spaceId: id, requesterActorId: actorId },
      select: { id: true },
      take: 10000 + 1,
    });
    if (requests.length > 10000)
      throw new ConflictException({ code: 'COMPANY_ERASURE_BOUND_EXCEEDED' });
    await tx.companyResourceRequestEvent.updateMany({
      where: {
        spaceId: id,
        reason: { not: null },
        OR: [{ actorId }, { requestId: { in: requests.map((r) => r.id) } }],
      },
      data: { reason: null },
    });
    // ER/AT/BU decision and request reasons are free text written by the erased actor.
    await tx.companyDecisionReason.updateMany({
      where: { spaceId: id, authorActorId: actorId, redactedAt: null },
      data: { reason: null, redactedAt: new Date() },
    });
    await tx.companyBudgetChangeRequest.updateMany({
      where: {
        spaceId: id,
        redactedAt: null,
        OR: [{ requesterActorId: actorId }, { deciderActorId: actorId }],
      },
      data: {
        reason: null,
        decisionReason: null,
        redactedAt: new Date(),
        revision: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    await tx.companyEmployeeCaseEntry.updateMany({
      where: { caseId: { in: cases.map((r) => r.id) }, body: { not: null } },
      data: { body: null, revision: { increment: 1 }, updatedAt: new Date() },
    });
  }
}
