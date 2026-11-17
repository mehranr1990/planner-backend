import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { OnModuleInit } from '@nestjs/common';
import { CompanyFinanceExtensions } from './company-finance.extensions.js';
import type { z } from 'zod';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { CompanyStaffContext } from './company-staff.context.js';
import type { StaffContext, StaffPage } from './company-staff.context.js';
import { CompanyFinanceService } from './company-finance.service.js';
import { companyDates } from './company-assets.service.js';
import {
  matchingTier,
  overlappingTiers,
  validTiers,
} from '../domain/company-approval-policy.js';
type Policy = Awaited<
  ReturnType<
    StaffContext['tx']['companyApprovalPolicyVersion']['findFirstOrThrow']
  >
>;
@Injectable()
export class CompanyApprovalPoliciesService implements OnModuleInit {
  constructor(
    @Inject(CompanyFinanceExtensions)
    private readonly extensions: CompanyFinanceExtensions,
    @Inject(CompanyStaffContext) readonly op: CompanyStaffContext,
    @Inject(CompanyFinanceService)
    private readonly finance: CompanyFinanceService,
  ) {}
  onModuleInit() {
    this.extensions.submissionPolicies((s, kind, facts) =>
      this.requiresPolicy(s, kind, facts),
    );
  }
  private async requiresPolicy(
    s: StaffContext,
    kind: 'EXPENSE' | 'REIMBURSEMENT' | 'BUDGET_CHANGE',
    facts: { currency: string; amount: string; categoryId: string | null },
  ) {
    const policies = await s.tx.companyApprovalPolicyVersion.findMany({
      where: {
        ...this.op.where(s),
        kind,
        state: { in: ['PUBLISHED', 'ARCHIVED'] },
        effectiveFrom: { lte: s.now },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: s.now } }],
      },
      take: 1001,
    });
    if (policies.length > 1000) throw new PayloadTooLargeException();
    // Archiving an applicable approved version does not silently restore a weaker
    // legacy route. Require its replacement until the explicitly configured expiry.
    return policies.some(
      (p) => matchingTier(this.view(p).rules, facts).length > 0,
    );
  }
  private view(r: Policy) {
    return c.CompanyApprovalPolicySchema.strip().parse({
      ...companyDates(r),
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveUntil: r.effectiveUntil?.toISOString() ?? null,
    });
  }
  async row(s: StaffContext, id: string) {
    const r = await s.tx.companyApprovalPolicyVersion.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!r) throw new NotFoundException();
    return r;
  }
  private async validate(
    s: StaffContext,
    body: z.infer<typeof c.CompanyApprovalPolicyInputSchema>,
  ) {
    if (!validTiers(body.rules))
      throw new ConflictException({ code: 'APPROVAL_POLICY_OVERLAP' });
    for (const r of body.rules) {
      if (body.kind === 'BUDGET_CHANGE' && r.categoryId !== null)
        throw new ConflictException({
          code: 'APPROVAL_POLICY_CRITERIA_INVALID',
        });
      await this.finance.fixedCurrency(s, r.currency);
      const scale = c.financeCurrencyScales[r.currency];
      if (
        scale === undefined ||
        [r.minimum, r.maximum].some(
          (v) => v !== null && (v.split('.')[1]?.length ?? 0) > scale,
        )
      )
        throw new ConflictException({ code: 'INVALID_EXACT_MONEY' });
      if (
        r.categoryId &&
        !(await s.tx.companyExpenseCategory.findFirst({
          where: { ...this.op.where(s), id: r.categoryId, archived: false },
        }))
      )
        throw new NotFoundException();
      const v = await s.tx.companyFinancialWorkflowVersion.findFirst({
        where: {
          ...this.op.where(s),
          id: r.workflowVersionId,
          state: 'PUBLISHED',
        },
      });
      if (!v)
        throw new ConflictException({ code: 'PUBLISHED_WORKFLOW_REQUIRED' });
      const w = await s.tx.companyFinancialWorkflow.findFirst({
        where: { ...this.op.where(s), id: v.workflowId, kind: body.kind },
      });
      if (!w) throw new ConflictException({ code: 'WORKFLOW_KIND_MISMATCH' });
      if (
        r.escalateAfterSeconds !== null &&
        (await s.tx.companyFinancialWorkflowStep.count({
          where: { versionId: v.id, alternateAccessId: null },
        }))
      )
        throw new ConflictException({
          code: 'ESCALATION_DESTINATION_REQUIRED',
        });
    }
  }
  list(actor: RequestActor, id: string, scopeId: string, q: StaffPage) {
    return this.op.read(
      actor,
      id,
      scopeId,
      async (s) => {
        this.op.manage(s);
        return this.op.page(s, 'company.approval.policies', q, async () =>
          (
            await s.tx.companyApprovalPolicyVersion.findMany({
              where: this.op.where(s),
              take: 1001,
            })
          ).map((r) => this.view(r)),
        );
      },
      false,
    );
  }
  create(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyApprovalPolicyInputSchema>,
    key?: string,
  ) {
    const body = c.CompanyApprovalPolicyInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.approval.policy.create',
      body.id,
      async (s) => {
        this.op.manage(s);
        await this.validate(s, body);
        const result = await this.op.once(
          s,
          'company.approval.policy.create',
          key,
          body,
          async () => {
            if (
              (await s.tx.companyApprovalPolicyVersion.count({
                where: this.op.where(s),
              })) >= 1000
            )
              throw new PayloadTooLargeException();
            await s.change();
            return s.tx.companyApprovalPolicyVersion.create({
              data: { ...this.op.where(s), ...body, actorId: s.root.actorId },
            });
          },
        );
        return this.view(await this.row(s, result.id));
      },
    );
  }
  change(
    actor: RequestActor,
    id: string,
    scopeId: string,
    policyId: string,
    revision: number,
    input: z.infer<typeof c.CompanyApprovalPolicyChangeSchema>,
  ) {
    const body = c.CompanyApprovalPolicyChangeSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.approval.policy.change',
      policyId,
      async (s) => {
        this.op.manage(s);
        const r = await this.row(s, policyId);
        this.op.match(r.revision, revision);
        if (
          body.state === 'PUBLISHED'
            ? r.state !== 'DRAFT'
            : r.state !== 'PUBLISHED'
        )
          throw new ConflictException();
        if (body.state === 'PUBLISHED') {
          const view = this.view(r);
          await this.validate(s, view);
          const others = await s.tx.companyApprovalPolicyVersion.findMany({
            where: { ...this.op.where(s), kind: r.kind, state: 'PUBLISHED' },
            take: 1001,
          });
          if (others.length > 1000) throw new PayloadTooLargeException();
          for (const other of others) {
            if (
              (r.effectiveUntil === null ||
                other.effectiveFrom < r.effectiveUntil) &&
              (other.effectiveUntil === null ||
                r.effectiveFrom < other.effectiveUntil) &&
              view.rules.some((a) =>
                this.view(other).rules.some((b) => overlappingTiers(a, b)),
              )
            )
              throw new ConflictException({ code: 'APPROVAL_POLICY_OVERLAP' });
          }
        }
        await s.change();
        return this.view(
          await s.tx.companyApprovalPolicyVersion.update({
            where: { id: policyId },
            data: { state: body.state, ...this.op.changed(s) },
          }),
        );
      },
    );
  }
  async select(
    s: StaffContext,
    kind: 'EXPENSE' | 'REIMBURSEMENT' | 'BUDGET_CHANGE',
    facts: { currency: string; amount: string; categoryId: string | null },
    required = true,
  ) {
    const policies = await s.tx.companyApprovalPolicyVersion.findMany({
      where: {
        ...this.op.where(s),
        kind,
        state: 'PUBLISHED',
        effectiveFrom: { lte: s.now },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: s.now } }],
      },
      take: 1001,
    });
    if (policies.length > 1000) throw new PayloadTooLargeException();
    const matches = policies.flatMap((p) =>
      matchingTier(this.view(p).rules, facts).map((rule) => ({
        policyId: p.id,
        rule,
      })),
    );
    if (
      matches.length === 0 &&
      !required &&
      !(await this.requiresPolicy(s, kind, facts))
    )
      return null;
    if (matches.length !== 1)
      throw new ConflictException({
        code: matches.length
          ? 'APPROVAL_POLICY_AMBIGUOUS'
          : 'APPROVAL_POLICY_REQUIRED',
      });
    return matches[0]!;
  }
}
