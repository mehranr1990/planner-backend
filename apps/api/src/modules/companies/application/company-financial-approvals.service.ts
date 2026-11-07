import {
  Inject,
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type {
  CompanyFinancialApproval,
  CompanyFinancialWorkflowVersion,
  CompanyExpenseVersion,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { CompanyFinanceService } from './company-finance.service.js';
import { CompanyFinanceExtensions } from './company-finance.extensions.js';
import { CompanyReimbursementsService } from './company-reimbursements.service.js';
import type {
  StaffContext,
  StaffMember,
  StaffPage,
} from './company-staff.context.js';
const dates = <T extends { createdAt: Date; updatedAt: Date }>(r: T) => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
const ref = (accessId: string, generation: number) => ({
  accessId,
  generation,
});
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
@Injectable()
export class CompanyFinancialApprovalsService implements OnModuleInit {
  constructor(
    @Inject(CompanyFinanceService) readonly finance: CompanyFinanceService,
    @Inject(CompanyReimbursementsService)
    readonly reimbursements: CompanyReimbursementsService,
    @Inject(CompanyFinanceExtensions)
    private readonly extensions: CompanyFinanceExtensions,
  ) {}
  get op() {
    return this.finance.op;
  }
  onModuleInit() {
    this.extensions.approvals(
      (s, id, final) => this.guardExpense(s, id, final),
      (s, target) => this.cancelAny(s, target),
    );
  }
  async versionRow(s: StaffContext, id: string) {
    const v = await s.tx.companyFinancialWorkflowVersion.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!v) throw new NotFoundException();
    return v;
  }
  async workflowRow(s: StaffContext, id: string) {
    const w = await s.tx.companyFinancialWorkflow.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!w) throw new NotFoundException();
    return w;
  }
  async canPublished(s: StaffContext, kind: string) {
    if (this.finance.manager(s)) return true;
    if (kind === 'EXPENSE') {
      try {
        this.finance.eligible(s);
        return true;
      } catch (e) {
        if (e instanceof ForbiddenException) return false;
        throw e;
      }
    }
    return !!(await s.tx.companyExpense.findFirst({
      where: {
        ...this.op.where(s),
        state: 'APPROVED',
        effective: {
          payerAccessId: s.me.accessId,
          payerGeneration: s.me.generation,
        },
      },
    }));
  }
  async versionView(s: StaffContext, v: CompanyFinancialWorkflowVersion) {
    const w = await this.workflowRow(s, v.workflowId);
    if (!this.finance.manager(s)) {
      const pinned =
        v.state !== 'DRAFT' &&
        !!(await s.tx.companyFinancialApproval.findFirst({
          where: {
            ...this.op.where(s),
            workflowVersionId: v.id,
            OR: [
              {
                requesterAccessId: s.me.accessId,
                requesterGeneration: s.me.generation,
              },
              {
                beneficiaryAccessId: s.me.accessId,
                beneficiaryGeneration: s.me.generation,
              },
            ],
          },
        }));
      if (
        !pinned &&
        (v.state !== 'PUBLISHED' || !(await this.canPublished(s, w.kind)))
      )
        throw new NotFoundException();
    }
    const steps = await this.steps(s, v.id);
    return {
      ...dates(v),
      steps: steps.map((st) => ({
        id: st.id,
        position: st.position,
        label: st.label,
        primary: ref(st.primaryAccessId, st.primaryGeneration),
        alternate: st.alternateAccessId
          ? ref(st.alternateAccessId, st.alternateGeneration!)
          : null,
      })),
    };
  }
  async steps(s: StaffContext, versionId: string) {
    return s.tx.companyFinancialWorkflowStep.findMany({
      where: { ...this.op.where(s), versionId },
      orderBy: { position: 'asc' },
    });
  }
  async validateSteps(
    s: StaffContext,
    input: z.infer<typeof c.CompanyFinancialWorkflowVersionInputSchema>,
  ) {
    if (input.steps.length < 1 || input.steps.length > 5)
      throw new BadRequestException();
    const seen = new Set<string>();
    for (const st of input.steps)
      for (const m of [st.primary, st.alternate].filter(
        (x): x is StaffMember => x !== null,
      )) {
        if (seen.has(m.accessId))
          throw new BadRequestException({
            code: 'DISTINCT_WORKFLOW_REVIEWERS_REQUIRED',
          });
        seen.add(m.accessId);
        await this.reimbursements.managerMember(s, m);
      }
  }
  async putSteps(
    s: StaffContext,
    v: string,
    input: z.infer<typeof c.CompanyFinancialWorkflowVersionInputSchema>,
  ) {
    for (const [position, st] of input.steps.entries())
      await s.tx.companyFinancialWorkflowStep.create({
        data: {
          ...this.op.where(s),
          id: randomUUID(),
          versionId: v,
          position,
          label: st.label,
          primaryAccessId: st.primary.accessId,
          primaryGeneration: st.primary.generation,
          alternateAccessId: st.alternate?.accessId ?? null,
          alternateGeneration: st.alternate?.generation ?? null,
        },
      });
  }
  workflowCreate(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyFinancialWorkflowCreateSchema>,
    key?: string,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      'workflow.create',
      input.id,
      async (s) => {
        this.op.manage(s);
        const created = await this.op.once(
          s,
          'company.financial.workflow',
          key,
          input,
          async () => {
            await this.op.growth(
              s,
              'company.financial-workflow',
              await s.tx.companyFinancialWorkflow.count({
                where: this.op.where(s),
              }),
            );
            await s.change();
            await s.tx.companyFinancialWorkflow.create({
              data: { ...this.op.where(s), ...input },
            });
            return { id: input.id };
          },
        );
        return dates(await this.workflowRow(s, created.id));
      },
    );
  }
  workflows(actor: RequestActor, id: string, scopeId: string, q: StaffPage) {
    return this.finance.read(actor, id, scopeId, (s) =>
      this.op.page(s, 'financial.workflows', q, async () => {
        const out = [];
        for (const w of await s.tx.companyFinancialWorkflow.findMany({
          where: this.op.where(s),
        })) {
          if (
            this.finance.manager(s) ||
            ((await this.canPublished(s, w.kind)) &&
              (await s.tx.companyFinancialWorkflowVersion.findFirst({
                where: { workflowId: w.id, state: 'PUBLISHED' },
              })))
          )
            out.push(dates(w));
        }
        return out;
      }),
    );
  }
  workflow(actor: RequestActor, id: string, scopeId: string, target: string) {
    return this.finance.read(actor, id, scopeId, async (s) => {
      const w = await this.workflowRow(s, target);
      if (
        !this.finance.manager(s) &&
        (!(await this.canPublished(s, w.kind)) ||
          !(await s.tx.companyFinancialWorkflowVersion.findFirst({
            where: { workflowId: w.id, state: 'PUBLISHED' },
          })))
      )
        throw new NotFoundException();
      return dates(w);
    });
  }
  versionCreate(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    input: z.infer<typeof c.CompanyFinancialWorkflowVersionCreateSchema>,
    key?: string,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      'workflow.version.create',
      input.id,
      async (s) => {
        this.op.manage(s);
        await this.workflowRow(s, target);
        const created = await this.op.once(
          s,
          'company.financial.version',
          key,
          { target, input },
          async () => {
            await this.validateSteps(s, input);
            await this.op.growth(
              s,
              'company.financial-workflow-version',
              await s.tx.companyFinancialWorkflowVersion.count({
                where: this.op.where(s),
              }),
            );
            const latest = await s.tx.companyFinancialWorkflowVersion.findFirst(
              { where: { workflowId: target }, orderBy: { number: 'desc' } },
            );
            await s.change();
            await s.tx.companyFinancialWorkflowVersion.create({
              data: {
                ...this.op.where(s),
                id: input.id,
                workflowId: target,
                number: (latest?.number ?? 0) + 1,
                title: input.title,
                state: 'DRAFT',
                createdByActorId: s.root.actorId,
              },
            });
            await this.putSteps(s, input.id, input);
            return { id: input.id };
          },
        );
        return this.versionView(s, await this.versionRow(s, created.id));
      },
    );
  }
  versions(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    q: StaffPage,
  ) {
    return this.finance.read(actor, id, scopeId, async (s) => {
      const w = await this.workflowRow(s, target);
      if (!this.finance.manager(s) && !(await this.canPublished(s, w.kind)))
        throw new NotFoundException();
      return this.op.page(s, 'financial.versions:' + target, q, async () =>
        Promise.all(
          (
            await s.tx.companyFinancialWorkflowVersion.findMany({
              where: {
                ...this.op.where(s),
                workflowId: target,
                ...(this.finance.manager(s) ? {} : { state: 'PUBLISHED' }),
              },
            })
          ).map((v) => this.versionView(s, v)),
        ),
      );
    });
  }
  version(actor: RequestActor, id: string, scopeId: string, target: string) {
    return this.finance.read(actor, id, scopeId, async (s) =>
      this.versionView(s, await this.versionRow(s, target)),
    );
  }
  versionPatch(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
    input: z.infer<typeof c.CompanyFinancialWorkflowVersionInputSchema>,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      'workflow.version.edit',
      target,
      async (s) => {
        this.op.manage(s);
        const v = await this.versionRow(s, target);
        this.op.match(v.revision, revision);
        if (v.state !== 'DRAFT') throw new ConflictException();
        await this.validateSteps(s, input);
        await s.change();
        await s.tx.companyFinancialWorkflowStep.deleteMany({
          where: { versionId: v.id },
        });
        await this.putSteps(s, v.id, input);
        return this.versionView(
          s,
          await s.tx.companyFinancialWorkflowVersion.update({
            where: { id: v.id },
            data: { title: input.title, ...this.op.changed(s) },
          }),
        );
      },
    );
  }
  versionState(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
    publish: boolean,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      publish ? 'workflow.version.publish' : 'workflow.version.archive',
      target,
      async (s) => {
        this.op.manage(s);
        const v = await this.versionRow(s, target);
        this.op.match(v.revision, revision);
        if (v.state !== (publish ? 'DRAFT' : 'PUBLISHED'))
          throw new ConflictException();
        if (publish) {
          const view = await this.versionView(s, v);
          await this.validateSteps(s, view);
        }
        await s.change();
        return this.versionView(
          s,
          await s.tx.companyFinancialWorkflowVersion.update({
            where: { id: v.id },
            data: {
              state: publish ? 'PUBLISHED' : 'ARCHIVED',
              ...this.op.changed(s),
            },
          }),
        );
      },
    );
  }
  approvalView(a: CompanyFinancialApproval) {
    return {
      ...dates(a),
      requester: ref(a.requesterAccessId, a.requesterGeneration),
      beneficiary: a.beneficiaryAccessId
        ? ref(a.beneficiaryAccessId, a.beneficiaryGeneration!)
        : null,
    };
  }
  async approvalRow(s: StaffContext, id: string) {
    const a = await s.tx.companyFinancialApproval.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!a) throw new NotFoundException();
    if (
      !this.finance.manager(s) &&
      !this.op.self(s, ref(a.requesterAccessId, a.requesterGeneration)) &&
      !(
        a.beneficiaryAccessId &&
        this.op.self(s, ref(a.beneficiaryAccessId, a.beneficiaryGeneration!))
      )
    )
      throw new NotFoundException();
    return a;
  }
  approval(actor: RequestActor, id: string, scopeId: string, target: string) {
    return this.finance.read(actor, id, scopeId, async (s) =>
      this.approvalView(await this.approvalRow(s, target)),
    );
  }
  approvals(actor: RequestActor, id: string, scopeId: string, q: StaffPage) {
    return this.finance.read(actor, id, scopeId, (s) =>
      this.op.page(s, 'financial.approvals', q, async () =>
        (
          await s.tx.companyFinancialApproval.findMany({
            where: {
              ...this.op.where(s),
              ...(this.finance.manager(s)
                ? {}
                : {
                    OR: [
                      {
                        requesterAccessId: s.me.accessId,
                        requesterGeneration: s.me.generation,
                      },
                      {
                        beneficiaryAccessId: s.me.accessId,
                        beneficiaryGeneration: s.me.generation,
                      },
                    ],
                  }),
            },
          })
        ).map((a) => this.approvalView(a)),
      ),
    );
  }
  events(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    q: StaffPage,
  ) {
    return this.finance.read(actor, id, scopeId, async (s) => {
      await this.approvalRow(s, target);
      return this.op.page(
        s,
        'financial.approval.events:' + target,
        q,
        async () =>
          (
            await s.tx.companyFinancialApprovalEvent.findMany({
              where: { ...this.op.where(s), approvalId: target },
            })
          ).map((e) => ({
            ...dates(e),
            reviewer: e.reviewerAccessId
              ? ref(e.reviewerAccessId, e.reviewerGeneration!)
              : null,
          })),
      );
    });
  }
  async event(
    s: StaffContext,
    a: CompanyFinancialApproval,
    action: string,
    stepId: string | null = null,
    reviewer: StaffMember | null = null,
  ) {
    await s.tx.companyFinancialApprovalEvent.create({
      data: {
        ...this.op.where(s),
        id: randomUUID(),
        approvalId: a.id,
        stepId,
        action,
        createdByActorId: s.root.actorId,
        reviewerAccessId: reviewer?.accessId ?? null,
        reviewerGeneration: reviewer?.generation ?? null,
      },
    });
  }
  async published(
    s: StaffContext,
    id: string,
    kind: string,
    requester: StaffMember,
    beneficiary: StaffMember | null,
  ) {
    const v = await this.versionRow(s, id),
      w = await this.workflowRow(s, v.workflowId);
    if (v.state !== 'PUBLISHED' || w.kind !== kind)
      throw new ConflictException();
    const steps = await this.steps(s, v.id);
    if (!steps.length) throw new ConflictException();
    for (const st of steps)
      for (const m of [
        ref(st.primaryAccessId, st.primaryGeneration),
        ...(st.alternateAccessId
          ? [ref(st.alternateAccessId, st.alternateGeneration!)]
          : []),
      ]) {
        if (
          m.accessId === requester.accessId ||
          m.accessId === beneficiary?.accessId
        )
          throw new ForbiddenException();
        await this.reimbursements.managerMember(s, m);
      }
    return { v, steps };
  }
  async fingerprint(
    s: StaffContext,
    target: { expenseVersionId: string | null; reimbursementId: string | null },
  ) {
    if (target.expenseVersionId) {
      const v = await s.tx.companyExpenseVersion.findFirstOrThrow({
        where: { ...this.op.where(s), id: target.expenseVersionId },
      });
      const receipts = await s.tx.companyExpenseReceipt.findMany({
        where: { versionId: v.id, pinnedRevision: { not: null } },
        orderBy: { id: 'asc' },
        select: { fileId: true, pinnedRevision: true, pinnedHash: true },
      });
      const allocations = await s.tx.companyExpenseAllocation.findMany({
        where: { versionId: v.id },
        orderBy: { id: 'asc' },
        select: { budgetId: true, commitmentId: true, amount: true },
      });
      return hash([
        v.id,
        v.expenseId,
        v.kind,
        v.requesterAccessId,
        v.requesterGeneration,
        v.payerAccessId,
        v.payerGeneration,
        v.currency,
        v.scale,
        v.amount.toString(),
        v.categoryId,
        v.occurredDate.toISOString(),
        v.timezone,
        v.vendor,
        v.projectReferenceId,
        v.submittedAt?.toISOString(),
        receipts,
        allocations,
      ]);
    }
    const r = await this.reimbursements.row(s, target.reimbursementId!);
    return hash([
      r.id,
      r.bucketId,
      r.expenseVersionId,
      r.beneficiaryAccessId,
      r.beneficiaryGeneration,
      r.amount.toString(),
    ]);
  }
  async newApproval(
    s: StaffContext,
    versionId: string,
    target: { expenseVersionId: string | null; reimbursementId: string | null },
    requester: StaffMember,
    beneficiary: StaffMember | null,
    sourceRevision: number,
  ) {
    await this.op.growth(
      s,
      'company.financial-approval',
      await s.tx.companyFinancialApproval.count({ where: this.op.where(s) }),
    );
    const latest = await s.tx.companyFinancialApproval.findFirst({
      where: { ...this.op.where(s), ...target },
      orderBy: { attempt: 'desc' },
    });
    const a = await s.tx.companyFinancialApproval.create({
      data: {
        ...this.op.where(s),
        id: randomUUID(),
        workflowVersionId: versionId,
        ...target,
        requesterAccessId: requester.accessId,
        requesterGeneration: requester.generation,
        beneficiaryAccessId: beneficiary?.accessId ?? null,
        beneficiaryGeneration: beneficiary?.generation ?? null,
        sourceRevision,
        attempt: (latest?.attempt ?? 0) + 1,
        fingerprint: await this.fingerprint(s, target),
        state: 'ACTIVE',
      },
    });
    await this.event(s, a, 'SUBMIT');
    return a;
  }
  expenseSubmit(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
    input: z.infer<typeof c.CompanyFinancialWorkflowBindSchema>,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      'workflow.expense.submit',
      target,
      async (s) => {
        const v = await this.finance.version(s, target);
        await this.finance.audience(s, v);
        this.finance.requester(s, v);
        const requester = ref(v.requesterAccessId, v.requesterGeneration),
          beneficiary = v.payerAccessId
            ? ref(v.payerAccessId, v.payerGeneration!)
            : null;
        const { v: version, steps } = await this.published(
          s,
          input.workflowVersionId,
          'EXPENSE',
          requester,
          beneficiary,
        );
        const expense = await this.finance.submitWithin(
          s,
          target,
          revision,
          {
            reviewer: ref(
              steps[0]!.primaryAccessId,
              steps[0]!.primaryGeneration,
            ),
          },
          false,
          true,
        );
        return this.approvalView(
          await this.newApproval(
            s,
            version.id,
            { expenseVersionId: v.id, reimbursementId: null },
            requester,
            beneficiary,
            expense.revision,
          ),
        );
      },
    );
  }
  reimbursementSubmit(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
    input: z.infer<typeof c.CompanyFinancialWorkflowBindSchema>,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      'workflow.reimbursement.submit',
      target,
      async (s) => {
        const r = await this.reimbursements.row(s, target);
        this.reimbursements.audience(s, r);
        this.reimbursements.claimant(s, r);
        this.op.match(r.revision, revision);
        if (r.state !== 'DRAFT') throw new ConflictException();
        await this.reimbursements.current(s, r);
        const requester = ref(r.beneficiaryAccessId, r.beneficiaryGeneration);
        const { v } = await this.published(
          s,
          input.workflowVersionId,
          'REIMBURSEMENT',
          requester,
          requester,
        );
        await s.change();
        const updated = await s.tx.companyReimbursementRequest.update({
          where: { id: r.id },
          data: { state: 'SUBMITTED', ...this.op.changed(s) },
        });
        return this.approvalView(
          await this.newApproval(
            s,
            v.id,
            { expenseVersionId: null, reimbursementId: r.id },
            requester,
            requester,
            updated.revision,
          ),
        );
      },
    );
  }
  async source(s: StaffContext, a: CompanyFinancialApproval) {
    if ((await this.fingerprint(s, a)) !== a.fingerprint)
      throw new ConflictException({ code: 'FINANCIAL_SOURCE_CHANGED' });
    if (a.expenseVersionId) {
      const v = await s.tx.companyExpenseVersion.findFirstOrThrow({
          where: { ...this.op.where(s), id: a.expenseVersionId },
        }),
        e = await this.finance.expenseRow(s, v.expenseId),
        latest = await this.finance.version(s, e.id);
      if (
        v.state !== 'SUBMITTED' ||
        latest.id !== v.id ||
        e.revision !== a.sourceRevision
      )
        throw new ConflictException({ code: 'FINANCIAL_SOURCE_CHANGED' });
      const r = await this.op.member(
        s,
        ref(v.requesterAccessId, v.requesterGeneration),
      );
      if (
        !['OWNER', 'ORG_ADMIN', 'DEPT_MANAGER', 'TEAM_LEAD', 'MEMBER'].includes(
          r.role ?? '',
        ) &&
        !(await this.op.access.staffReviewer(s, r))
      )
        throw new ForbiddenException();
      if (v.payerAccessId)
        await this.op.member(s, ref(v.payerAccessId, v.payerGeneration!));
      return { expense: v, reimbursement: null };
    }
    const r = await this.reimbursements.row(s, a.reimbursementId!);
    if (r.state !== 'SUBMITTED' || r.revision !== a.sourceRevision)
      throw new ConflictException({ code: 'FINANCIAL_SOURCE_CHANGED' });
    await this.reimbursements.current(s, r);
    return { expense: null, reimbursement: r };
  }
  async assigned(s: StaffContext, a: CompanyFinancialApproval) {
    const steps = await this.steps(s, a.workflowVersionId),
      st = steps[a.stepIndex];
    if (!st) throw new ConflictException();
    const reviewer =
      a.escalated && st.alternateAccessId
        ? ref(st.alternateAccessId, st.alternateGeneration!)
        : ref(st.primaryAccessId, st.primaryGeneration);
    if (
      reviewer.accessId === a.requesterAccessId ||
      reviewer.accessId === a.beneficiaryAccessId
    )
      throw new ForbiddenException();
    await this.reimbursements.managerMember(s, reviewer);
    return { steps, st, reviewer };
  }
  async priorDecisions(s: StaffContext, a: CompanyFinancialApproval) {
    for (const event of await s.tx.companyFinancialApprovalEvent.findMany({
      where: { approvalId: a.id, action: 'APPROVE' },
    })) {
      if (
        !event.reviewerAccessId ||
        event.reviewerAccessId === a.requesterAccessId ||
        event.reviewerAccessId === a.beneficiaryAccessId
      )
        throw new ForbiddenException();
      await this.reimbursements.managerMember(
        s,
        ref(event.reviewerAccessId, event.reviewerGeneration!),
      );
    }
  }
  async updateExpenseReviewer(
    s: StaffContext,
    v: CompanyExpenseVersion,
    reviewer: StaffMember,
  ) {
    await s.tx.companyExpenseVersion.update({
      where: { id: v.id },
      data: {
        reviewerAccessId: reviewer.accessId,
        reviewerGeneration: reviewer.generation,
        ...this.op.changed(s),
      },
    });
    await s.tx.companyExpenseReviewEvent.create({
      data: {
        ...this.op.where(s),
        id: randomUUID(),
        versionId: v.id,
        action: 'REASSIGN',
        reviewerAccessId: reviewer.accessId,
        reviewerGeneration: reviewer.generation,
        createdByActorId: s.root.actorId,
      },
    });
    const e = await this.finance.expenseRow(s, v.expenseId);
    return (await this.finance.bump(s, e)).revision;
  }
  decision(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
    input: z.infer<typeof c.CompanyFinancialApprovalDecisionSchema>,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      'workflow.decide',
      target,
      async (s) => {
        const a = await this.approvalRow(s, target);
        this.op.match(a.revision, revision);
        if (a.state !== 'ACTIVE') throw new ConflictException();
        const source = await this.source(s, a),
          { steps, st, reviewer } = await this.assigned(s, a);
        if (!this.op.self(s, reviewer)) throw new ForbiddenException();
        await this.priorDecisions(s, a);
        await s.change();
        await this.event(s, a, input.decision, st.id, reviewer);
        const final =
          input.decision === 'REJECT' || a.stepIndex === steps.length - 1;
        let sourceRevision = a.sourceRevision;
        if (!final) {
          const next = steps[a.stepIndex + 1]!;
          if (source.expense)
            sourceRevision = await this.updateExpenseReviewer(
              s,
              source.expense,
              ref(next.primaryAccessId, next.primaryGeneration),
            );
          else
            sourceRevision = (
              await s.tx.companyReimbursementRequest.update({
                where: { id: source.reimbursement!.id },
                data: this.op.changed(s),
              })
            ).revision;
        }
        const updated = await s.tx.companyFinancialApproval.update({
          where: { id: a.id },
          data: {
            state: final
              ? input.decision === 'APPROVE'
                ? 'APPROVED'
                : 'REJECTED'
              : 'ACTIVE',
            ...(final ? {} : { stepIndex: a.stepIndex + 1, escalated: false }),
            sourceRevision,
            ...this.op.changed(s),
          },
        });
        if (final) {
          if (source.expense)
            await this.finance.decideWithin(
              s,
              source.expense.expenseId,
              sourceRevision,
              input,
              true,
            );
          else
            await this.reimbursements.approveWithin(
              s,
              source.reimbursement!,
              input.decision === 'APPROVE',
            );
        }
        return this.approvalView(updated);
      },
    );
  }
  escalate(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      'workflow.escalate',
      target,
      async (s) => {
        const a = await this.approvalRow(s, target);
        this.op.match(a.revision, revision);
        if (a.state !== 'ACTIVE' || a.escalated) throw new ConflictException();
        if (
          !this.finance.manager(s) &&
          !this.op.self(s, ref(a.requesterAccessId, a.requesterGeneration))
        )
          throw new ForbiddenException();
        const source = await this.source(s, a),
          steps = await this.steps(s, a.workflowVersionId),
          st = steps[a.stepIndex];
        if (!st?.alternateAccessId) throw new ConflictException();
        const alternate = ref(st.alternateAccessId, st.alternateGeneration!);
        if (
          alternate.accessId === a.requesterAccessId ||
          alternate.accessId === a.beneficiaryAccessId
        )
          throw new ForbiddenException();
        await this.reimbursements.managerMember(s, alternate);
        await s.change();
        const sourceRevision = source.expense
          ? await this.updateExpenseReviewer(s, source.expense, alternate)
          : (
              await s.tx.companyReimbursementRequest.update({
                where: { id: source.reimbursement!.id },
                data: this.op.changed(s),
              })
            ).revision;
        await this.event(s, a, 'ESCALATE', st.id, alternate);
        return this.approvalView(
          await s.tx.companyFinancialApproval.update({
            where: { id: a.id },
            data: { escalated: true, sourceRevision, ...this.op.changed(s) },
          }),
        );
      },
    );
  }
  restart(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
    input: z.infer<typeof c.CompanyFinancialWorkflowBindSchema>,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      'workflow.restart',
      target,
      async (s) => {
        const a = await this.approvalRow(s, target);
        this.op.match(a.revision, revision);
        if (
          a.state !== 'ACTIVE' ||
          !this.op.self(s, ref(a.requesterAccessId, a.requesterGeneration))
        )
          throw new ForbiddenException();
        const source = await this.source(s, a),
          requester = ref(a.requesterAccessId, a.requesterGeneration),
          beneficiary = a.beneficiaryAccessId
            ? ref(a.beneficiaryAccessId, a.beneficiaryGeneration!)
            : null;
        const { v, steps } = await this.published(
          s,
          input.workflowVersionId,
          a.expenseVersionId ? 'EXPENSE' : 'REIMBURSEMENT',
          requester,
          beneficiary,
        );
        await s.change();
        await this.event(s, a, 'RESTART');
        await s.tx.companyFinancialApproval.update({
          where: { id: a.id },
          data: { state: 'CANCELED', ...this.op.changed(s) },
        });
        const sourceRevision = source.expense
          ? await this.updateExpenseReviewer(
              s,
              source.expense,
              ref(steps[0]!.primaryAccessId, steps[0]!.primaryGeneration),
            )
          : (
              await s.tx.companyReimbursementRequest.update({
                where: { id: source.reimbursement!.id },
                data: this.op.changed(s),
              })
            ).revision;
        return this.approvalView(
          await this.newApproval(
            s,
            v.id,
            {
              expenseVersionId: a.expenseVersionId,
              reimbursementId: a.reimbursementId,
            },
            requester,
            beneficiary,
            sourceRevision,
          ),
        );
      },
    );
  }
  async cancelAny(
    s: StaffContext,
    target: { expenseVersionId?: string; reimbursementId?: string },
  ) {
    for (const a of await s.tx.companyFinancialApproval.findMany({
      where: { ...this.op.where(s), ...target, state: 'ACTIVE' },
    })) {
      await this.event(s, a, 'CANCEL');
      await s.tx.companyFinancialApproval.update({
        where: { id: a.id },
        data: { state: 'CANCELED', ...this.op.changed(s) },
      });
    }
  }
  async guardExpense(s: StaffContext, versionId: string, final: boolean) {
    const a = await s.tx.companyFinancialApproval.findFirst({
      where: { ...this.op.where(s), expenseVersionId: versionId },
      orderBy: { attempt: 'desc' },
    });
    if (!final) {
      if (a)
        throw new ConflictException({
          code: 'CONTROLLED_FINANCIAL_APPROVAL_REQUIRED',
        });
      return;
    }
    if (!a || !['APPROVED', 'REJECTED'].includes(a.state))
      throw new ConflictException();
    await this.source(s, a);
    const { steps, reviewer } = await this.assigned(s, a);
    if (!this.op.self(s, reviewer)) throw new ForbiddenException();
    await this.priorDecisions(s, a);
    const decisions = await s.tx.companyFinancialApprovalEvent.findMany({
      where: { approvalId: a.id, action: { in: ['APPROVE', 'REJECT'] } },
    });
    if (
      a.state === 'APPROVED' &&
      (decisions.length !== steps.length ||
        decisions.some((d) => d.action !== 'APPROVE'))
    )
      throw new ConflictException();
    if (
      a.state === 'REJECTED' &&
      !decisions.some(
        (d) => d.action === 'REJECT' && d.stepId === steps[a.stepIndex]!.id,
      )
    )
      throw new ConflictException();
  }
}
