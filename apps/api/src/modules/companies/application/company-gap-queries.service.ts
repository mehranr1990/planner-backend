import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { CompanyStaffContext } from './company-staff.context.js';
import type { StaffPage } from './company-staff.context.js';
import { CompaniesService } from './companies.service.js';
@Injectable()
export class CompanyGapQueriesService {
  permissions(actor: RequestActor, id: string, scopeId: string) {
    return this.companies.effectiveReadPermissions(actor, id, scopeId);
  }
  constructor(
    @Inject(CompanyStaffContext) readonly op: CompanyStaffContext,
    @Inject(CompaniesService) private readonly companies: CompaniesService,
  ) {}
  chart(actor: RequestActor, id: string) {
    return this.op.read(actor, id, id, async (s) => {
      await this.companies.organizationVisibility(s, id);
      const company = await s.tx.company.findUniqueOrThrow({ where: { id } }),
        departments = await s.tx.companyDepartment.findMany({
          where: { spaceId: id },
          take: 1001,
        }),
        units = await s.tx.companyUnit.findMany({
          where: { spaceId: id },
          take: 1001,
        });
      if (departments.length + units.length > 1000)
        throw new PayloadTooLargeException();
      const nodes: z.infer<typeof c.CompanyOrganizationChartSchema>['nodes'] =
        [];
      const candidates = [
        {
          id,
          title: company.title,
          revision: company.revision,
          kind: 'COMPANY' as const,
          parentId: null,
        },
        ...departments.map((d) => ({
          id: d.scopeId,
          title: d.title,
          revision: d.revision,
          kind: 'DEPARTMENT' as const,
          parentId: id,
        })),
        ...units.map((u) => ({
          id: u.scopeId,
          title: u.title,
          revision: u.revision,
          kind: 'UNIT' as const,
          parentId: u.departmentId,
        })),
      ];
      for (const node of candidates) {
        try {
          await this.companies.organizationVisibility(s, node.id);
        } catch (e) {
          if (
            e instanceof NotFoundException ||
            e instanceof ForbiddenException
          ) {
            if (this.op.access.isAdmin(s))
              nodes.push({
                ...node,
                memberCount: null,
                managers: [],
                evidence: 'RESTRICTED',
              });
            continue;
          }
          throw e;
        }
        const members = await this.op.access.staffMembers(s, node.id);
        nodes.push({
          ...node,
          memberCount: members.length,
          managers: members
            .filter((m) =>
              ['OWNER', 'ORG_ADMIN', 'DEPT_MANAGER', 'TEAM_LEAD'].includes(
                m.role ?? '',
              ),
            )
            .map((m) => ({ accessId: m.accessId, generation: m.generation })),
          evidence: 'OBSERVED',
        });
      }
      // Include only parents already visible; no hidden branch can be inferred.
      const visible = new Set(nodes.map((n) => n.id));
      return c.CompanyOrganizationChartSchema.parse({
        companyId: id,
        nodes: nodes.filter(
          (n) => n.parentId === null || visible.has(n.parentId),
        ),
      });
    });
  }
  transfers(actor: RequestActor, id: string, q: StaffPage) {
    return this.op.access.transferHistory(actor, id, q);
  }
  analytics(
    actor: RequestActor,
    id: string,
    scopeId: string,
    query: z.infer<typeof c.CompanyObservationRangeSchema>,
  ) {
    const q = c.CompanyObservationRangeSchema.parse(query);
    return this.op.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      const live = await this.op.live(s),
        from = new Date(q.from),
        to = new Date(q.to);
      const [units, resources, transfers, submitted, completed, total] =
        await Promise.all([
          s.tx.companyUnit.count({
            where: {
              spaceId: id,
              ...(scopeId === id ? {} : { departmentId: scopeId }),
            },
          }),
          s.tx.companyResource.count({
            where: { ...this.op.where(s), state: 'ACTIVE' },
          }),
          s.tx.companyDepartmentTransfer.count({
            where: {
              spaceId: id,
              createdAt: { gte: from, lt: to },
              ...(scopeId === id
                ? {}
                : { OR: [{ fromScopeId: scopeId }, { toScopeId: scopeId }] }),
            },
          }),
          s.tx.companyPerformanceReview.count({
            where: {
              ...this.op.where(s),
              state: 'SUBMITTED',
              createdAt: { gte: from, lt: to },
            },
          }),
          s.tx.companyPerformanceReview.count({
            where: {
              ...this.op.where(s),
              state: 'COMPLETED',
              createdAt: { gte: from, lt: to },
            },
          }),
          s.tx.companyPerformanceReview.count({
            where: { ...this.op.where(s), createdAt: { gte: from, lt: to } },
          }),
        ]);
      const [goals, kpiObservations, approved, rejected, canceled] =
        await Promise.all([
          s.tx.companyGoal.count({ where: this.op.where(s) }),
          s.tx.companyKpiObservation.count({
            where: {
              ...this.op.where(s),
              periodStart: { gte: from },
              periodEnd: { lte: to },
            },
          }),
          ...['APPROVED', 'REJECTED', 'CANCELED'].map((state) =>
            s.tx.companyFinancialApproval.count({
              where: {
                ...this.op.where(s),
                state,
                updatedAt: { gte: from, lt: to },
              },
            }),
          ),
        ]);
      return c.CompanyDepartmentAnalyticsSchema.parse({
        scopeId,
        ...q,
        snapshotAt: s.now.toISOString(),
        goals,
        kpiObservations,
        approvalThroughput: { approved, rejected, canceled },
        activeMembers: live.size,
        units,
        resources,
        transfers,
        reviewCompletion: { submitted, completed, total },
        workEvidence: 'UNKNOWN',
        financeEvidence: 'SEPARATE_AUTHORIZED_REPORT',
        privateContentIncluded: false,
      });
    });
  }
}
