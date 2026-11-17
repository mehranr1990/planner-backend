import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { CompanyAccess } from '../../spaces/public/index.js';
import { CompanyStaffContext } from './company-staff.context.js';
import { CompaniesService } from './companies.service.js';
import { CompanyFinancialApprovalsService } from './company-financial-approvals.service.js';
@Injectable()
export class CompanyPolicyWorker {
  private afterId: string | undefined;
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CompanyAccess) private readonly access: CompanyAccess,
    @Inject(CompanyStaffContext) private readonly op: CompanyStaffContext,
    @Inject(CompaniesService) private readonly companies: CompaniesService,
    @Inject(CompanyFinancialApprovalsService)
    private readonly approvals: CompanyFinancialApprovalsService,
  ) {}
  async consume() {
    try {
      this.access.kernel.assertEnabled();
    } catch (e) {
      if (e instanceof ForbiddenException) return false;
      throw e;
    }
    const rows = await this.db.client.companyFinancialApproval.findMany({
      where: {
        state: 'ACTIVE',
        escalated: false,
        escalateAfterSeconds: { not: null },
        policyVersionId: { not: null },
        ...(this.afterId ? { id: { gt: this.afterId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 25,
    });
    if (!rows.length) {
      this.afterId = undefined;
      return false;
    }
    let changed = false;
    for (const hint of rows) {
      this.afterId = hint.id;
      const policy =
        await this.db.client.companyApprovalPolicyVersion.findUnique({
          where: { id: hint.policyVersionId! },
        });
      if (!policy) continue;
      try {
        changed =
          (await this.access.policyMaintenance(
            hint.spaceId,
            policy.actorId,
            'company.approval.auto.escalate',
            hint.id,
            async (ctx) => {
              const a = await ctx.tx.companyFinancialApproval.findFirst({
                  where: {
                    id: hint.id,
                    ...{ spaceId: hint.spaceId, scopeId: hint.scopeId },
                    state: 'ACTIVE',
                    escalated: false,
                  },
                }),
                p = await ctx.tx.companyApprovalPolicyVersion.findFirst({
                  where: {
                    id: policy.id,
                    state: 'PUBLISHED',
                    effectiveFrom: { lte: ctx.now },
                    OR: [
                      { effectiveUntil: null },
                      { effectiveUntil: { gt: ctx.now } },
                    ],
                  },
                });
              if (
                !a ||
                !p ||
                a.policyVersionId !== p.id ||
                a.escalateAfterSeconds === null ||
                ctx.now.getTime() - a.stepStartedAt.getTime() <
                  a.escalateAfterSeconds * 1000
              )
                return false;
              await this.companies.staffVisibility(ctx, a.scopeId, false);
              const me = await this.access.seat(ctx, a.scopeId);
              let audit: string | undefined;
              const s = {
                ...ctx,
                scopeId: a.scopeId,
                me,
                change: async () => {
                  audit ??= await ctx.begin();
                },
              };
              this.op.manage(s);
              await this.approvals.escalateWithin(
                s,
                a.id,
                a.revision,
                'POLICY_TIMEOUT',
              );
              const assigned = await this.approvals.assigned(s, {
                ...a,
                escalated: true,
              });
              await ctx.tx.companyNotification.create({
                data: {
                  id: randomUUID(),
                  spaceId: ctx.spaceId,
                  scopeId: a.scopeId,
                  recipientAccessId: assigned.reviewer.accessId,
                  recipientGeneration: assigned.reviewer.generation,
                  kind: 'APPROVAL_ESCALATED',
                  subjectId: a.id,
                  dedupeKey: 'approval-escalated:' + a.id + ':' + a.stepIndex,
                },
              });
              if (audit)
                await this.access.effect(
                  ctx,
                  'company.approval.auto.escalate',
                  a.id,
                  audit,
                );
              return true;
            },
          )) || changed;
      } catch (e) {
        if (
          e instanceof ForbiddenException ||
          e instanceof NotFoundException ||
          e instanceof ConflictException
        )
          continue;
        throw e;
      }
    }
    return changed;
  }
}
