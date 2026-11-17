import {
  Inject,
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  PayloadTooLargeException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { CompanyStaffContext } from './company-staff.context.js';
import type { StaffContext, StaffPage } from './company-staff.context.js';
import { companyDates } from './company-assets.service.js';
import { activeWindow } from '../domain/company-gap.js';
const ref = (accessId: string, generation: number) => ({
  accessId,
  generation,
});
type Role = Awaited<
  ReturnType<StaffContext['tx']['companyCustomRole']['findFirstOrThrow']>
>;
type Delegation = Awaited<
  ReturnType<
    StaffContext['tx']['companyApprovalDelegation']['findFirstOrThrow']
  >
>;
@Injectable()
export class CompanyAccessGovernanceService {
  recoveryPolicyDrafts(actor: RequestActor, id: string, q: StaffPage) {
    return this.op.read(
      actor,
      id,
      id,
      async (s) => {
        this.admin(s);
        return this.op.page(s, 'company.recovery.policy.drafts', q, async () =>
          (
            await s.tx.companyRecoveryPolicyDraft.findMany({
              where: { spaceId: id },
              take: 1001,
            })
          ).map((r) =>
            c.CompanyRecoveryPolicyDraftSchema.strip().parse({
              ...c.CompanyRecoveryPolicyDraftInputSchema.parse(r.configuration),
              ...companyDates(r),
              state: 'DRAFT',
              executable: false,
            }),
          ),
        );
      },
      false,
    );
  }
  recoveryPolicyDraft(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.CompanyRecoveryPolicyDraftInputSchema>,
    key?: string,
  ) {
    const body = c.CompanyRecoveryPolicyDraftInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      id,
      'company.recovery.policy.draft',
      body.id,
      async (s) => {
        this.admin(s);
        for (const m of body.approvers) await this.op.member(s, m);
        const result = await this.op.once(
          s,
          'company.recovery.policy.draft',
          key,
          body,
          async () => {
            if (
              (await s.tx.companyRecoveryPolicyDraft.count({
                where: { spaceId: id },
              })) >= 1000
            )
              throw new PayloadTooLargeException();
            await s.change();
            return s.tx.companyRecoveryPolicyDraft.create({
              data: {
                ...this.op.where(s),
                id: body.id,
                version: body.version,
                configuration: body,
                actorId: s.root.actorId,
              },
            });
          },
        );
        const r = await s.tx.companyRecoveryPolicyDraft.findFirstOrThrow({
          where: { spaceId: id, id: result.id },
        });
        return c.CompanyRecoveryPolicyDraftSchema.strip().parse({
          ...c.CompanyRecoveryPolicyDraftInputSchema.parse(r.configuration),
          ...companyDates(r),
          state: 'DRAFT',
          executable: false,
        });
      },
    );
  }
  constructor(@Inject(CompanyStaffContext) readonly op: CompanyStaffContext) {}
  handovers(actor: RequestActor, id: string, q: StaffPage) {
    return this.op.read(
      actor,
      id,
      id,
      async (s) =>
        this.op.page(s, 'company.ownership.handovers', q, async () => {
          const rows = await s.tx.ownerHandover.findMany({
            where: {
              spaceId: id,
              scopeId: id,
              ...(s.me.role === 'OWNER'
                ? {}
                : {
                    OR: [
                      {
                        fromAccessId: s.me.accessId,
                        fromGeneration: s.me.generation,
                      },
                      {
                        toAccessId: s.me.accessId,
                        toGeneration: s.me.generation,
                      },
                    ],
                  }),
            },
            take: 1001,
          });
          return rows.map((r) =>
            c.OwnerHandoverSchema.strip().parse({
              ...r,
              expiresAt: r.expiresAt.toISOString(),
              acceptedAt:
                r.state === 'ACCEPTED' ? r.endedAt!.toISOString() : null,
            }),
          );
        }),
      false,
    );
  }
  private admin(s: StaffContext) {
    if (!this.op.access.isAdmin(s)) throw new ForbiddenException();
  }
  private roleView(r: Role) {
    return c.CompanyCustomRoleSchema.strip().parse({
      ...companyDates(r),
      archivedAt: r.archivedAt?.toISOString() ?? null,
    });
  }
  private delegationView(r: Delegation) {
    return c.CompanyDelegationSchema.strip().parse({
      ...companyDates(r),
      delegator: ref(r.delegatorAccessId, r.delegatorGeneration),
      delegate: ref(r.delegateAccessId, r.delegateGeneration),
      validFrom: r.validFrom.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      revokedAt: r.revokedAt?.toISOString() ?? null,
    });
  }
  private async role(s: StaffContext, roleId: string) {
    const r = await s.tx.companyCustomRole.findFirst({
      where: { ...this.op.where(s), id: roleId },
    });
    if (!r) throw new NotFoundException();
    return r;
  }
  roles(actor: RequestActor, id: string, scopeId: string, q: StaffPage) {
    return this.op.read(
      actor,
      id,
      scopeId,
      async (s) => {
        this.admin(s);
        return this.op.page(s, 'company.custom.roles', q, async () =>
          (
            await s.tx.companyCustomRole.findMany({
              where: this.op.where(s),
              take: 1001,
            })
          ).map((r) => this.roleView(r)),
        );
      },
      false,
    );
  }
  createRole(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyCustomRoleInputSchema>,
    key?: string,
  ) {
    const body = c.CompanyCustomRoleInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.role.create',
      body.id,
      async (s) => {
        this.admin(s);
        const result = await this.op.once(
          s,
          'company.role.create',
          key,
          body,
          async () => {
            if (
              (await s.tx.companyCustomRole.count({
                where: this.op.where(s),
              })) >= 1000
            )
              throw new PayloadTooLargeException();
            await s.change();
            return s.tx.companyCustomRole.create({
              data: { ...this.op.where(s), ...body, actorId: s.root.actorId },
            });
          },
        );
        return this.roleView(await this.role(s, result.id));
      },
    );
  }
  updateRole(
    actor: RequestActor,
    id: string,
    scopeId: string,
    roleId: string,
    revision: number,
    input: z.infer<typeof c.CompanyCustomRolePatchSchema>,
  ) {
    const body = c.CompanyCustomRolePatchSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.role.update',
      roleId,
      async (s) => {
        this.admin(s);
        const r = await this.role(s, roleId);
        this.op.match(r.revision, revision);
        if (r.archivedAt) throw new ConflictException();
        await s.change();
        return this.roleView(
          await s.tx.companyCustomRole.update({
            where: { id: roleId },
            data: { ...body, ...this.op.changed(s) },
          }),
        );
      },
    );
  }
  archiveRole(
    actor: RequestActor,
    id: string,
    scopeId: string,
    roleId: string,
    revision: number,
  ) {
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.role.archive',
      roleId,
      async (s) => {
        this.admin(s);
        const r = await this.role(s, roleId);
        this.op.match(r.revision, revision);
        if (r.archivedAt) throw new ConflictException();
        await s.change();
        return this.roleView(
          await s.tx.companyCustomRole.update({
            where: { id: roleId },
            data: { archivedAt: s.now, ...this.op.changed(s) },
          }),
        );
      },
    );
  }
  assignRole(
    actor: RequestActor,
    id: string,
    scopeId: string,
    roleId: string,
    input: z.infer<typeof c.CompanyRoleAssignmentInputSchema>,
    key?: string,
  ) {
    const body = c.CompanyRoleAssignmentInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.role.assign',
      body.id,
      async (s) => {
        this.admin(s);
        await this.op.member(s, body.member);
        const role = await this.role(s, roleId);
        if (role.archivedAt) throw new ConflictException();
        const result = await this.op.once(
          s,
          'company.role.assign',
          key,
          { roleId, ...body },
          async () => {
            if (
              (await s.tx.companyRoleAssignment.count({
                where: this.op.where(s),
              })) >= 1000
            )
              throw new PayloadTooLargeException();
            await s.change();
            return s.tx.companyRoleAssignment.create({
              data: {
                ...this.op.where(s),
                id: body.id,
                roleId,
                memberAccessId: body.member.accessId,
                memberGeneration: body.member.generation,
                actorId: s.root.actorId,
              },
            });
          },
        );
        const r = await s.tx.companyRoleAssignment.findFirstOrThrow({
          where: { ...this.op.where(s), id: result.id },
        });
        return c.CompanyRoleAssignmentSchema.strip().parse({
          ...companyDates(r),
          member: ref(r.memberAccessId, r.memberGeneration),
          revokedAt: r.revokedAt?.toISOString() ?? null,
        });
      },
    );
  }
  revokeRole(
    actor: RequestActor,
    id: string,
    scopeId: string,
    assignmentId: string,
    revision: number,
  ) {
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.role.revoke',
      assignmentId,
      async (s) => {
        this.admin(s);
        const r = await s.tx.companyRoleAssignment.findFirst({
          where: { ...this.op.where(s), id: assignmentId },
        });
        if (!r) throw new NotFoundException();
        this.op.match(r.revision, revision);
        if (r.revokedAt) throw new ConflictException();
        await s.change();
        const next = await s.tx.companyRoleAssignment.update({
          where: { id: r.id },
          data: { revokedAt: s.now, ...this.op.changed(s) },
        });
        return c.CompanyRoleAssignmentSchema.strip().parse({
          ...companyDates(next),
          member: ref(next.memberAccessId, next.memberGeneration),
          revokedAt: next.revokedAt?.toISOString() ?? null,
        });
      },
    );
  }
  temporary(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyTemporaryGrantInputSchema>,
    key?: string,
  ) {
    const body = c.CompanyTemporaryGrantInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.access.temporary',
      body.id,
      async (s) => {
        this.admin(s);
        await this.op.member(s, body.member);
        const result = await this.op.once(
          s,
          'company.access.temporary',
          key,
          body,
          async () => {
            if (new Date(body.expiresAt) <= s.now)
              throw new ConflictException({ code: 'GRANT_EXPIRED' });
            if (
              (await s.tx.companyTemporaryGrant.count({
                where: this.op.where(s),
              })) >= 1000
            )
              throw new PayloadTooLargeException();
            await s.change();
            return s.tx.companyTemporaryGrant.create({
              data: {
                ...this.op.where(s),
                id: body.id,
                memberAccessId: body.member.accessId,
                memberGeneration: body.member.generation,
                capabilities: body.capabilities,
                validFrom: body.validFrom,
                expiresAt: body.expiresAt,
                reason: body.reason,
                actorId: s.root.actorId,
              },
            });
          },
        );
        return this.temporaryView(
          await s.tx.companyTemporaryGrant.findFirstOrThrow({
            where: { ...this.op.where(s), id: result.id },
          }),
          s.now,
        );
      },
    );
  }
  private temporaryView(
    r: Awaited<
      ReturnType<
        StaffContext['tx']['companyTemporaryGrant']['findFirstOrThrow']
      >
    >,
    now: Date,
    current = true,
  ) {
    return c.CompanyTemporaryGrantSchema.strip().parse({
      ...companyDates(r),
      member: ref(r.memberAccessId, r.memberGeneration),
      validFrom: r.validFrom.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      revokedAt: r.revokedAt?.toISOString() ?? null,
      active: current && activeWindow(r, now),
    });
  }
  revokeTemporary(
    actor: RequestActor,
    id: string,
    scopeId: string,
    grantId: string,
    revision: number,
  ) {
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.access.temporary.revoke',
      grantId,
      async (s) => {
        this.admin(s);
        const r = await s.tx.companyTemporaryGrant.findFirst({
          where: { ...this.op.where(s), id: grantId },
        });
        if (!r) throw new NotFoundException();
        this.op.match(r.revision, revision);
        if (r.revokedAt) throw new ConflictException();
        await s.change();
        return this.temporaryView(
          await s.tx.companyTemporaryGrant.update({
            where: { id: grantId },
            data: { revokedAt: s.now, ...this.op.changed(s) },
          }),
          s.now,
        );
      },
    );
  }
  inventory(actor: RequestActor, id: string, scopeId: string) {
    return this.op.read(
      actor,
      id,
      scopeId,
      async (s) => {
        this.admin(s);
        const [members, roles, assignments, temporary, delegations] =
          await Promise.all([
            this.op.access.staffMembers(s, scopeId),
            s.tx.companyCustomRole.findMany({
              where: this.op.where(s),
              take: 1001,
            }),
            s.tx.companyRoleAssignment.findMany({
              where: this.op.where(s),
              take: 1001,
            }),
            s.tx.companyTemporaryGrant.findMany({
              where: this.op.where(s),
              take: 1001,
            }),
            s.tx.companyApprovalDelegation.findMany({
              where: this.op.where(s),
              take: 1001,
            }),
          ]);
        if (
          [members, roles, assignments, temporary, delegations].some(
            (a) => a.length > 1000,
          )
        )
          throw new PayloadTooLargeException();
        await this.op.audit(s, scopeId, 'company.access.inventory');
        return c.CompanyAccessInventorySchema.parse({
          scopeId,
          members: members.map((m) => ({
            member: ref(m.accessId, m.generation),
            role: m.role,
            source: 'MEMBERSHIP',
          })),
          roles: roles.map((r) => this.roleView(r)),
          assignments: assignments.map((r) =>
            c.CompanyRoleAssignmentSchema.strip().parse({
              ...companyDates(r),
              member: ref(r.memberAccessId, r.memberGeneration),
              revokedAt: r.revokedAt?.toISOString() ?? null,
            }),
          ),
          temporary: temporary.map((r) =>
            this.temporaryView(
              r,
              s.now,
              members.some(
                (m) =>
                  m.accessId === r.memberAccessId &&
                  m.generation === r.memberGeneration,
              ),
            ),
          ),
          delegations: delegations.map((r) => this.delegationView(r)),
        });
      },
      false,
    );
  }
  review(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyAccessReviewInputSchema>,
    key?: string,
  ) {
    const body = c.CompanyAccessReviewInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.access.review',
      body.id,
      async (s) => {
        this.admin(s);
        await this.op.member(s, body.member);
        const result = await this.op.once(
          s,
          'company.access.review',
          key,
          body,
          async () => {
            if (
              (await s.tx.companyAccessReview.count({
                where: this.op.where(s),
              })) >= 1000
            )
              throw new PayloadTooLargeException();
            await s.change();
            if (body.decision === 'REVOKE') {
              const where = {
                ...this.op.where(s),
                memberAccessId: body.member.accessId,
                memberGeneration: body.member.generation,
                revokedAt: null,
              };
              await s.tx.companyRoleAssignment.updateMany({
                where,
                data: { revokedAt: s.now, ...this.op.changed(s) },
              });
              await s.tx.companyTemporaryGrant.updateMany({
                where,
                data: { revokedAt: s.now, ...this.op.changed(s) },
              });
              await s.tx.companyApprovalDelegation.updateMany({
                where: {
                  ...this.op.where(s),
                  delegateAccessId: body.member.accessId,
                  delegateGeneration: body.member.generation,
                  revokedAt: null,
                },
                data: { revokedAt: s.now, ...this.op.changed(s) },
              });
            }
            return s.tx.companyAccessReview.create({
              data: {
                ...this.op.where(s),
                id: body.id,
                memberAccessId: body.member.accessId,
                memberGeneration: body.member.generation,
                decision: body.decision,
                reason: body.reason,
                actorId: s.root.actorId,
              },
            });
          },
        );
        const r = await s.tx.companyAccessReview.findFirstOrThrow({
          where: { ...this.op.where(s), id: result.id },
        });
        return c.CompanyAccessReviewSchema.strip().parse({
          ...companyDates(r),
          member: ref(r.memberAccessId, r.memberGeneration),
        });
      },
    );
  }
  reviews(actor: RequestActor, id: string, scopeId: string, q: StaffPage) {
    return this.op.read(
      actor,
      id,
      scopeId,
      async (s) => {
        this.admin(s);
        return this.op.page(s, 'company.access.reviews', q, async () =>
          (
            await s.tx.companyAccessReview.findMany({
              where: this.op.where(s),
              take: 1001,
            })
          ).map((r) =>
            c.CompanyAccessReviewSchema.strip().parse({
              ...companyDates(r),
              member: ref(r.memberAccessId, r.memberGeneration),
            }),
          ),
        );
      },
      false,
    );
  }
  delegation(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyDelegationCreateSchema>,
    key?: string,
  ) {
    const body = c.CompanyDelegationCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.approval.delegation',
      body.id,
      async (s) => {
        this.op.manage(s);
        const delegate = await this.op.member(s, body.delegate);
        if (
          this.op.self(s, body.delegate) ||
          (!(await this.op.access.staffReviewer(s, delegate)) &&
            !(s.scopeId !== s.spaceId && delegate.role === 'DEPT_MANAGER'))
        )
          throw new ForbiddenException();
        const version = await s.tx.companyFinancialWorkflowVersion.findFirst({
          where: {
            ...this.op.where(s),
            id: body.workflowVersionId,
            state: 'PUBLISHED',
          },
        });
        if (!version) throw new NotFoundException();
        if (
          !(await s.tx.companyFinancialWorkflowStep.findFirst({
            where: {
              versionId: version.id,
              OR: [
                {
                  primaryAccessId: s.me.accessId,
                  primaryGeneration: s.me.generation,
                },
                {
                  alternateAccessId: s.me.accessId,
                  alternateGeneration: s.me.generation,
                },
              ],
            },
          }))
        )
          throw new ForbiddenException();
        const result = await this.op.once(
          s,
          'company.approval.delegation',
          key,
          body,
          async () => {
            if (new Date(body.expiresAt) <= s.now)
              throw new ConflictException();
            if (
              (await s.tx.companyApprovalDelegation.count({
                where: this.op.where(s),
              })) >= 1000
            )
              throw new PayloadTooLargeException();
            await s.change();
            return s.tx.companyApprovalDelegation.create({
              data: {
                ...this.op.where(s),
                id: body.id,
                delegatorAccessId: s.me.accessId,
                delegatorGeneration: s.me.generation,
                delegateAccessId: body.delegate.accessId,
                delegateGeneration: body.delegate.generation,
                workflowVersionId: body.workflowVersionId,
                validFrom: body.validFrom,
                expiresAt: body.expiresAt,
                actorId: s.root.actorId,
              },
            });
          },
        );
        return this.delegationView(
          await s.tx.companyApprovalDelegation.findFirstOrThrow({
            where: { ...this.op.where(s), id: result.id },
          }),
        );
      },
    );
  }
  delegations(actor: RequestActor, id: string, scopeId: string, q: StaffPage) {
    return this.op.read(
      actor,
      id,
      scopeId,
      async (s) => {
        this.op.manage(s);
        return this.op.page(s, 'company.approval.delegations', q, async () =>
          (
            await s.tx.companyApprovalDelegation.findMany({
              where: {
                ...this.op.where(s),
                ...(!this.op.access.isAdmin(s)
                  ? {
                      OR: [
                        {
                          delegatorAccessId: s.me.accessId,
                          delegatorGeneration: s.me.generation,
                        },
                        {
                          delegateAccessId: s.me.accessId,
                          delegateGeneration: s.me.generation,
                        },
                      ],
                    }
                  : {}),
              },
              take: 1001,
            })
          ).map((r) => this.delegationView(r)),
        );
      },
      false,
    );
  }
  revokeDelegation(
    actor: RequestActor,
    id: string,
    scopeId: string,
    delegationId: string,
    revision: number,
  ) {
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.approval.delegation.revoke',
      delegationId,
      async (s) => {
        const r = await s.tx.companyApprovalDelegation.findFirst({
          where: { ...this.op.where(s), id: delegationId },
        });
        if (!r) throw new NotFoundException();
        if (!this.op.self(s, ref(r.delegatorAccessId, r.delegatorGeneration)))
          this.admin(s);
        this.op.match(r.revision, revision);
        if (r.revokedAt) throw new ConflictException();
        await s.change();
        return this.delegationView(
          await s.tx.companyApprovalDelegation.update({
            where: { id: r.id },
            data: { revokedAt: s.now, ...this.op.changed(s) },
          }),
        );
      },
    );
  }
  recovery(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.CompanyRecoveryCaseInputSchema>,
    key?: string,
  ) {
    const body = c.CompanyRecoveryCaseInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      id,
      'company.recovery.request',
      body.id,
      async (s) => {
        const result = await this.op.once(
          s,
          'company.recovery.request',
          key,
          body,
          async () => {
            if (
              (await s.tx.companyRecoveryCase.count({
                where: { spaceId: id },
              })) >= 1000
            )
              throw new PayloadTooLargeException();
            await s.change();
            return s.tx.companyRecoveryCase.create({
              data: {
                ...this.op.where(s),
                ...body,
                requesterAccessId: s.me.accessId,
                requesterGeneration: s.me.generation,
                actorId: s.root.actorId,
              },
            });
          },
        );
        const r = await s.tx.companyRecoveryCase.findFirstOrThrow({
          where: { spaceId: id, id: result.id },
        });
        return c.CompanyRecoveryCaseSchema.strip().parse({
          ...companyDates(r),
          executable: false,
        });
      },
    );
  }
  recoveries(actor: RequestActor, id: string, q: StaffPage) {
    return this.op.read(
      actor,
      id,
      id,
      async (s) =>
        this.op.page(s, 'company.recovery.cases', q, async () =>
          (
            await s.tx.companyRecoveryCase.findMany({
              where: {
                spaceId: id,
                ...(this.op.access.isAdmin(s)
                  ? {}
                  : {
                      requesterAccessId: s.me.accessId,
                      requesterGeneration: s.me.generation,
                    }),
              },
              take: 1001,
            })
          ).map((r) =>
            c.CompanyRecoveryCaseSchema.strip().parse({
              ...companyDates(r),
              executable: false,
            }),
          ),
        ),
      false,
    );
  }
}
