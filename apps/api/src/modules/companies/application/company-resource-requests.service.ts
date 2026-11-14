import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  CompanyResourceType,
  CompanyResourceWorkflowVersion,
  CompanyResourceRequest,
  CompanyResourceRequestEvent,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { CompanyStaffContext } from './company-staff.context.js';
import type { StaffContext, StaffPage } from './company-staff.context.js';
type Step = z.infer<typeof c.CompanyResourceWorkflowStepSchema>;
type Role = z.infer<typeof c.CompanyApproverRoleSchema>;
const dates = (r: { createdAt: Date; updatedAt: Date }) => ({
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
const type = (r: CompanyResourceType) =>
  c.CompanyResourceTypeSchema.strip().parse({ ...r, ...dates(r) });
const workflow = (r: CompanyResourceWorkflowVersion) =>
  c.CompanyResourceWorkflowSchema.strip().parse({
    ...r,
    ...dates(r),
    publishedAt: r.publishedAt?.toISOString() ?? null,
  });
const event = (r: CompanyResourceRequestEvent) =>
  c.CompanyResourceRequestEventSchema.strip().parse({
    ...r,
    createdAt: r.createdAt.toISOString(),
  });
/** Bounded per-scope configuration and request history (no new usage-quota keys). */
const LIMIT = 1000;
/**
 * C-M4 (owner decision C4): authorized managers configure versioned approval
 * paths per manager-defined resource type and role. A request binds the
 * published version at submission; every step needs a listed role, a live
 * admission and a different actor than the requester. No thresholds,
 * categories or mandatory stages are invented: without a published path a
 * request is refused.
 */
@Injectable()
export class CompanyResourceRequestsService {
  constructor(@Inject(CompanyStaffContext) readonly op: CompanyStaffContext) {}
  private bound(count: number) {
    if (count >= LIMIT) throw new PayloadTooLargeException();
  }
  /** Effective approver roles: the scope seat role plus an inherited root administrator role. */
  private roles(s: StaffContext): Role[] {
    const out = new Set<string>();
    if (s.me.role) out.add(s.me.role);
    if (this.op.access.isAdmin(s) && s.root.role) out.add(s.root.role);
    return [...out].filter(
      (r): r is Role => c.CompanyApproverRoleSchema.safeParse(r).success,
    );
  }
  private steps(r: CompanyResourceWorkflowVersion) {
    return c.CompanyResourceWorkflowSchema.shape.steps.parse(r.steps) as Step[];
  }
  private canDecide(s: StaffContext, steps: Step[], r: CompanyResourceRequest) {
    const roles = this.roles(s);
    return (
      r.state === 'PENDING' &&
      r.requesterActorId !== s.me.actorId &&
      steps[r.step]!.roles.some((role) => roles.includes(role))
    );
  }
  private async view(s: StaffContext, r: CompanyResourceRequest) {
    const steps = this.steps(
      await s.tx.companyResourceWorkflowVersion.findUniqueOrThrow({
        where: { id: r.workflowVersionId },
      }),
    );
    return c.CompanyResourceRequestSchema.strip().parse({
      ...r,
      ...dates(r),
      requester: {
        accessId: r.requesterAccessId,
        generation: r.requesterGeneration,
      },
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      stepCount: steps.length,
      pendingRoles: r.state === 'PENDING' ? steps[r.step]!.roles : [],
    });
  }
  private async typeRow(s: StaffContext, id: string) {
    const row = await s.tx.companyResourceType.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  private async workflowRow(s: StaffContext, id: string) {
    const row = await s.tx.companyResourceWorkflowVersion.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  /** Readable by managers, the requester, and the actor eligible for the current step. */
  private async requestRow(s: StaffContext, id: string) {
    const row = await s.tx.companyResourceRequest.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!row) throw new NotFoundException();
    if (this.visible(s, row)) return row;
    const steps = this.steps(
      await s.tx.companyResourceWorkflowVersion.findUniqueOrThrow({
        where: { id: row.workflowVersionId },
      }),
    );
    if (!this.canDecide(s, steps, row)) throw new NotFoundException();
    return row;
  }
  private visible(s: StaffContext, r: CompanyResourceRequest) {
    try {
      this.op.manage(s);
      return true;
    } catch {
      return r.requesterActorId === s.me.actorId;
    }
  }
  async types(actor: RequestActor, id: string, scopeId: string, q: StaffPage) {
    return this.op.read(actor, id, scopeId, (s) =>
      this.op.page(s, 'company.resource-types', q, async () =>
        (
          await s.tx.companyResourceType.findMany({
            where: this.op.where(s),
            take: LIMIT + 1,
          })
        ).map(type),
      ),
    );
  }
  async createType(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyResourceTypeCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.CompanyResourceTypeCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.resourcetype.create',
      body.id,
      async (s) => {
        this.op.manage(s);
        await this.op.once(
          s,
          'company.resourcetype.create',
          key,
          body,
          async () => {
            this.bound(
              await s.tx.companyResourceType.count({
                where: this.op.where(s),
              }),
            );
            await s.change();
            return s.tx.companyResourceType.create({
              data: {
                ...body,
                ...this.op.where(s),
                createdByActorId: s.root.actorId,
              },
            });
          },
        );
        return type(await this.typeRow(s, body.id));
      },
    );
  }
  async patchType(
    actor: RequestActor,
    id: string,
    scopeId: string,
    typeId: string,
    revision: number,
    input: z.infer<typeof c.CompanyResourceTypePatchSchema>,
  ) {
    const body = c.CompanyResourceTypePatchSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.resourcetype.update',
      typeId,
      async (s) => {
        this.op.manage(s);
        const row = await this.typeRow(s, typeId);
        this.op.match(row.revision, revision);
        await s.change();
        return type(
          await s.tx.companyResourceType.update({
            where: { id: row.id },
            data: { title: body.title, ...this.op.changed(s) },
          }),
        );
      },
    );
  }
  async assignType(
    actor: RequestActor,
    id: string,
    scopeId: string,
    resourceId: string,
    revision: number,
    input: z.infer<typeof c.CompanyResourceTypeAssignSchema>,
  ) {
    const body = c.CompanyResourceTypeAssignSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.resource.classify',
      resourceId,
      async (s) => {
        this.op.manage(s);
        const row = await s.tx.companyResource.findFirst({
          where: { ...this.op.where(s), id: resourceId },
        });
        if (!row) throw new NotFoundException();
        this.op.match(row.revision, revision);
        if (row.state !== 'ACTIVE') throw new ConflictException();
        if (body.typeId) await this.typeRow(s, body.typeId);
        await s.change();
        const changed = await s.tx.companyResource.update({
          where: { id: row.id },
          data: { typeId: body.typeId, ...this.op.changed(s) },
        });
        return c.CompanyResourceSchema.strip().parse({
          ...changed,
          ...dates(changed),
        });
      },
    );
  }
  async workflows(
    actor: RequestActor,
    id: string,
    scopeId: string,
    q: z.infer<typeof c.CompanyResourceWorkflowQuerySchema>,
  ) {
    return this.op.read(actor, id, scopeId, (s) => {
      this.op.manage(s);
      return this.op.page(
        s,
        'company.resource-workflows:' + (q.typeId ?? ''),
        q,
        async () =>
          (
            await s.tx.companyResourceWorkflowVersion.findMany({
              where: {
                ...this.op.where(s),
                ...(q.typeId ? { typeId: q.typeId } : {}),
              },
              take: LIMIT + 1,
            })
          ).map(workflow),
      );
    });
  }
  async readWorkflow(
    actor: RequestActor,
    id: string,
    scopeId: string,
    versionId: string,
  ) {
    return this.op.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      return workflow(await this.workflowRow(s, versionId));
    });
  }
  async createWorkflow(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyResourceWorkflowCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.CompanyResourceWorkflowCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.resourceworkflow.create',
      body.id,
      async (s) => {
        this.op.manage(s);
        await this.typeRow(s, body.typeId);
        await this.op.once(
          s,
          'company.resourceworkflow.create',
          key,
          body,
          async () => {
            this.bound(
              await s.tx.companyResourceWorkflowVersion.count({
                where: this.op.where(s),
              }),
            );
            await s.change();
            return s.tx.companyResourceWorkflowVersion.create({
              data: {
                id: body.id,
                ...this.op.where(s),
                typeId: body.typeId,
                steps: body.steps,
                state: 'DRAFT',
                createdByActorId: s.root.actorId,
              },
            });
          },
        );
        return workflow(await this.workflowRow(s, body.id));
      },
    );
  }
  async changeWorkflow(
    actor: RequestActor,
    id: string,
    scopeId: string,
    versionId: string,
    revision: number,
    change:
      | {
          kind: 'steps';
          input: z.infer<typeof c.CompanyResourceWorkflowPatchSchema>;
        }
      | { kind: 'publish' | 'archive' },
  ) {
    const body =
      change.kind === 'steps'
        ? c.CompanyResourceWorkflowPatchSchema.parse(change.input)
        : null;
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.resourceworkflow.' +
        (change.kind === 'steps' ? 'update' : change.kind),
      versionId,
      async (s) => {
        this.op.manage(s);
        const row = await this.workflowRow(s, versionId);
        this.op.match(row.revision, revision);
        if (
          (change.kind !== 'archive' && row.state !== 'DRAFT') ||
          row.state === 'ARCHIVED'
        )
          throw new ConflictException({ code: 'WORKFLOW_VERSION_IMMUTABLE' });
        await s.change();
        if (change.kind === 'publish') {
          const current = await s.tx.companyResourceWorkflowVersion.findFirst({
            where: {
              ...this.op.where(s),
              typeId: row.typeId,
              state: 'PUBLISHED',
            },
          });
          if (current)
            await s.tx.companyResourceWorkflowVersion.update({
              where: { id: current.id },
              data: { state: 'ARCHIVED', ...this.op.changed(s) },
            });
        }
        return workflow(
          await s.tx.companyResourceWorkflowVersion.update({
            where: { id: row.id },
            data: {
              ...(body ? { steps: body.steps } : {}),
              ...(change.kind === 'publish'
                ? { state: 'PUBLISHED', publishedAt: s.now }
                : {}),
              ...(change.kind === 'archive' ? { state: 'ARCHIVED' } : {}),
              ...this.op.changed(s),
            },
          }),
        );
      },
    );
  }
  async requests(
    actor: RequestActor,
    id: string,
    scopeId: string,
    q: z.infer<typeof c.CompanyResourceRequestQuerySchema>,
  ) {
    return this.op.read(actor, id, scopeId, (s) =>
      this.op.page(
        s,
        'company.resource-requests:' + (q.state ?? ''),
        q,
        async () => {
          const rows = await s.tx.companyResourceRequest.findMany({
            where: {
              ...this.op.where(s),
              ...(q.state ? { state: q.state } : {}),
            },
            take: LIMIT * 10 + 1,
          });
          if (rows.length > LIMIT * 10) throw new PayloadTooLargeException();
          const out = [];
          for (const r of rows) {
            if (!this.visible(s, r)) {
              const steps = this.steps(
                await s.tx.companyResourceWorkflowVersion.findUniqueOrThrow({
                  where: { id: r.workflowVersionId },
                }),
              );
              if (!this.canDecide(s, steps, r)) continue;
            }
            out.push(await this.view(s, r));
          }
          return out;
        },
        LIMIT * 10,
      ),
    );
  }
  async readRequest(
    actor: RequestActor,
    id: string,
    scopeId: string,
    requestId: string,
  ) {
    return this.op.read(actor, id, scopeId, async (s) =>
      this.view(s, await this.requestRow(s, requestId)),
    );
  }
  async history(
    actor: RequestActor,
    id: string,
    scopeId: string,
    requestId: string,
  ) {
    return this.op.read(actor, id, scopeId, async (s) => {
      await this.requestRow(s, requestId);
      const rows = await s.tx.companyResourceRequestEvent.findMany({
        where: { spaceId: id, requestId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 25,
      });
      return c.CompanyResourceRequestHistorySchema.parse({
        items: rows.map(event),
      });
    });
  }
  async createRequest(
    actor: RequestActor,
    id: string,
    scopeId: string,
    resourceId: string,
    input: z.infer<typeof c.CompanyResourceRequestCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.CompanyResourceRequestCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.resourcerequest.create',
      body.id,
      async (s) => {
        if (!s.me.role || s.me.role === 'VIEWER')
          throw new ForbiddenException();
        await this.op.once(
          s,
          'company.resourcerequest.create',
          key,
          { resourceId, ...body },
          async () => {
            const item = await s.tx.companyResource.findFirst({
              where: { ...this.op.where(s), id: resourceId },
            });
            if (!item) throw new NotFoundException();
            if (item.state !== 'ACTIVE')
              throw new ConflictException({ code: 'RESOURCE_UNAVAILABLE' });
            const path = item.typeId
              ? await s.tx.companyResourceWorkflowVersion.findFirst({
                  where: {
                    ...this.op.where(s),
                    typeId: item.typeId,
                    state: 'PUBLISHED',
                  },
                })
              : null;
            if (!path)
              throw new ConflictException({
                code: 'RESOURCE_APPROVAL_WORKFLOW_REQUIRED',
              });
            if (
              await s.tx.companyResourceAllocation.count({
                where: {
                  resourceId,
                  state: 'ALLOCATED',
                  startAt: { lt: new Date(body.endAt) },
                  endAt: { gt: new Date(body.startAt) },
                },
              })
            )
              throw new ConflictException({ code: 'RESOURCE_UNAVAILABLE' });
            if (
              (await s.tx.companyResourceRequest.count({
                where: this.op.where(s),
              })) >=
              LIMIT * 10
            )
              throw new PayloadTooLargeException();
            await s.change();
            const row = await s.tx.companyResourceRequest.create({
              data: {
                id: body.id,
                ...this.op.where(s),
                resourceId,
                workflowVersionId: path.id,
                requesterAccessId: s.me.accessId,
                requesterGeneration: s.me.generation,
                requesterActorId: s.me.actorId,
                startAt: new Date(body.startAt),
                endAt: new Date(body.endAt),
                reason: body.reason || null,
                state: 'PENDING',
                step: 0,
              },
            });
            await this.record(s, row.id, 'SUBMIT', null, null);
            return row;
          },
        );
        return this.view(s, await this.requestRow(s, body.id));
      },
    );
  }
  private record(
    s: StaffContext,
    requestId: string,
    kind: 'SUBMIT' | 'APPROVE' | 'REJECT' | 'WITHDRAW',
    step: number | null,
    reason: string | null,
  ) {
    return s.tx.companyResourceRequestEvent.create({
      data: {
        id: randomUUID(),
        ...this.op.where(s),
        requestId,
        actorId: s.me.actorId,
        kind,
        step,
        reason,
      },
    });
  }
  async decide(
    actor: RequestActor,
    id: string,
    scopeId: string,
    requestId: string,
    revision: number,
    input: z.infer<typeof c.CompanyResourceRequestDecisionSchema>,
  ) {
    const body = c.CompanyResourceRequestDecisionSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.resourcerequest.' + body.decision.toLowerCase(),
      requestId,
      async (s) => {
        const row = await s.tx.companyResourceRequest.findFirst({
          where: { ...this.op.where(s), id: requestId },
        });
        if (!row) throw new NotFoundException();
        const steps = this.steps(
          await s.tx.companyResourceWorkflowVersion.findUniqueOrThrow({
            where: { id: row.workflowVersionId },
          }),
        );
        if (!this.visible(s, row) && !this.canDecide(s, steps, row))
          throw new NotFoundException();
        this.op.match(row.revision, revision);
        if (row.state !== 'PENDING') throw new ConflictException();
        if (row.requesterActorId === s.me.actorId)
          throw new ForbiddenException({ code: 'SELF_APPROVAL_FORBIDDEN' });
        if (!this.canDecide(s, steps, row))
          throw new ForbiddenException({ code: 'APPROVAL_ROLE_REQUIRED' });
        // A revoked or replaced requester admission ends the request instead of allocating to it.
        await this.op.member(s, {
          accessId: row.requesterAccessId,
          generation: row.requesterGeneration,
        });
        await s.change();
        await this.record(s, row.id, body.decision, row.step, body.reason);
        if (body.decision === 'REJECT')
          return this.view(
            s,
            await s.tx.companyResourceRequest.update({
              where: { id: row.id },
              data: {
                state: 'REJECTED',
                decidedAt: s.now,
                ...this.op.changed(s),
              },
            }),
          );
        if (row.step + 1 < steps.length)
          return this.view(
            s,
            await s.tx.companyResourceRequest.update({
              where: { id: row.id },
              data: { step: row.step + 1, ...this.op.changed(s) },
            }),
          );
        const item = await s.tx.companyResource.findFirstOrThrow({
          where: { ...this.op.where(s), id: row.resourceId },
        });
        if (
          item.state !== 'ACTIVE' ||
          (await s.tx.companyResourceAllocation.count({
            where: {
              resourceId: row.resourceId,
              state: 'ALLOCATED',
              startAt: { lt: row.endAt },
              endAt: { gt: row.startAt },
            },
          }))
        )
          throw new ConflictException({ code: 'RESOURCE_UNAVAILABLE' });
        const allocation = await s.tx.companyResourceAllocation.create({
          data: {
            id: randomUUID(),
            ...this.op.where(s),
            resourceId: row.resourceId,
            memberAccessId: row.requesterAccessId,
            memberGeneration: row.requesterGeneration,
            createdByActorId: s.me.actorId,
            startAt: row.startAt,
            endAt: row.endAt,
            state: 'ALLOCATED',
          },
        });
        return this.view(
          s,
          await s.tx.companyResourceRequest.update({
            where: { id: row.id },
            data: {
              state: 'APPROVED',
              allocationId: allocation.id,
              decidedAt: s.now,
              ...this.op.changed(s),
            },
          }),
        );
      },
    );
  }
  async withdraw(
    actor: RequestActor,
    id: string,
    scopeId: string,
    requestId: string,
    revision: number,
  ) {
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.resourcerequest.withdraw',
      requestId,
      async (s) => {
        const row = await s.tx.companyResourceRequest.findFirst({
          where: { ...this.op.where(s), id: requestId },
        });
        if (!row || row.requesterActorId !== s.me.actorId)
          throw new NotFoundException();
        this.op.match(row.revision, revision);
        if (row.state !== 'PENDING') throw new ConflictException();
        await s.change();
        await this.record(s, row.id, 'WITHDRAW', null, null);
        return this.view(
          s,
          await s.tx.companyResourceRequest.update({
            where: { id: row.id },
            data: {
              state: 'WITHDRAWN',
              decidedAt: s.now,
              ...this.op.changed(s),
            },
          }),
        );
      },
    );
  }
}
