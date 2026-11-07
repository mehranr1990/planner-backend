import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type {
  CompanyBudget,
  CompanyExpenseVersion,
  CompanyExpense,
  CompanyCommitment,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { units, amount } from '../../finance/public/index.js';
import { ProjectFinanceReferences } from '../../projects/public/index.js';
import { SharedFiles } from '../../../platform/storage/public/index.js';
import { CompanyStaffContext } from './company-staff.context.js';
import type {
  StaffContext,
  StaffMember,
  StaffPage,
} from './company-staff.context.js';
import { CompaniesService } from './companies.service.js';
type Facts = z.infer<typeof c.CompanyExpenseFactsSchema>;
export type FinanceContext = StaffContext;
const dates = <T extends { createdAt: Date; updatedAt: Date }>(r: T) => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
@Injectable()
export class CompanyFinanceService {
  constructor(
    @Inject(CompanyStaffContext) readonly op: CompanyStaffContext,
    @Inject(CompaniesService) private readonly companies: CompaniesService,
    @Inject(ProjectFinanceReferences)
    private readonly projects: ProjectFinanceReferences,
    @Inject(SharedFiles) private readonly files: SharedFiles,
    @Inject(CompanyFinanceExtensions)
    private readonly extensions: CompanyFinanceExtensions,
  ) {}
  manager(s: FinanceContext) {
    return (
      this.op.access.isAdmin(s) ||
      (s.scopeId !== s.spaceId && s.me.role === 'DEPT_MANAGER')
    );
  }
  eligible(s: FinanceContext) {
    if (
      !this.manager(s) &&
      !['OWNER', 'ORG_ADMIN', 'DEPT_MANAGER', 'TEAM_LEAD', 'MEMBER'].includes(
        s.me.role ?? '',
      )
    )
      throw new ForbiddenException();
  }
  money(value: string, currency: string) {
    const scale = c.financeCurrencyScales[currency];
    if (scale === undefined) throw new BadRequestException();
    try {
      const n = units(value, scale, true);
      if (n <= 0n || n >= 10n ** BigInt(18 + scale)) throw Error();
      return { n, scale, value: amount(n, scale) };
    } catch {
      throw new BadRequestException({ code: 'INVALID_EXACT_MONEY' });
    }
  }
  read<T>(
    actor: RequestActor,
    id: string,
    scopeId: string,
    work: (s: FinanceContext) => Promise<T>,
  ) {
    return this.op.read(actor, id, scopeId, work, false);
  }
  write<T>(
    actor: RequestActor,
    id: string,
    scopeId: string,
    action: string,
    target: string,
    work: (s: FinanceContext) => Promise<T>,
  ) {
    const features = {
      'workflow.create': 'company.financial-workflow',
      'workflow.version.create': 'company.financial-workflow-version',
      'workflow.expense.submit': 'company.financial-approval',
      'workflow.reimbursement.submit': 'company.financial-approval',
      'workflow.restart': 'company.financial-approval',
      'reimbursement.create': 'company.reimbursement-request',
      'payment.propose': 'company.payment-acknowledgement',
      'acknowledgement.correct': 'company.acknowledgement-correction',
      'category.create': 'company.finance-category',
      'budget.create': 'company.budget',
      'commitment.create': 'company.commitment',
      'expense.create': 'company.expense',
      'expense.correct': 'company.expense-version',
      'expense.reverse': 'company.expense-version',
      'receipt.initiate': 'file.shared',
    } as const;
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.finance.' + action,
      target,
      work,
      features[action as keyof typeof features],
    );
  }
  private async growth(
    s: FinanceContext,
    feature:
      | 'company.expense'
      | 'company.budget'
      | 'company.commitment'
      | 'company.finance-category'
      | 'company.expense-version',
    count: number,
  ) {
    await this.op.growth(s, feature, count);
  }
  async categoryCreate(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyExpenseCategoryCreateSchema>,
    key?: string,
  ) {
    return this.write(
      actor,
      id,
      scopeId,
      'category.create',
      input.id,
      async (s) => {
        this.op.manage(s);
        const r = await this.op.once(
          s,
          'company.finance.category',
          key,
          input,
          async () => {
            await this.growth(
              s,
              'company.finance-category',
              await s.tx.companyExpenseCategory.count({
                where: this.op.where(s),
              }),
            );
            await s.change();
            await s.tx.companyExpenseCategory.create({
              data: { ...this.op.where(s), ...input },
            });
            return { id: input.id };
          },
        );
        return dates(
          await s.tx.companyExpenseCategory.findUniqueOrThrow({
            where: { id: r.id },
          }),
        );
      },
    );
  }
  categories(actor: RequestActor, id: string, scopeId: string, q: StaffPage) {
    return this.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      return this.op.page(s, 'finance.categories', q, async () =>
        (
          await s.tx.companyExpenseCategory.findMany({
            where: this.op.where(s),
          })
        ).map(dates),
      );
    });
  }
  categoryPatch(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
    input: z.infer<typeof c.CompanyExpenseCategoryPatchSchema>,
  ) {
    return this.write(
      actor,
      id,
      scopeId,
      'category.change',
      target,
      async (s) => {
        this.op.manage(s);
        const r = await s.tx.companyExpenseCategory.findFirst({
          where: { ...this.op.where(s), id: target },
        });
        if (!r) throw new NotFoundException();
        this.op.match(r.revision, revision);
        await s.change();
        return dates(
          await s.tx.companyExpenseCategory.update({
            where: { id: target },
            data: {
              ...(input.title === undefined ? {} : { title: input.title }),
              ...(input.archived === undefined
                ? {}
                : { archived: input.archived }),
              ...this.op.changed(s),
            },
          }),
        );
      },
    );
  }
  async referenceCreate(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyFinanceProjectCreateSchema>,
    key?: string,
  ) {
    await this.companies.hint(id);
    const p = await this.projects.hint(input.projectId);
    const row = await this.op.access.writeAcross(
      actor,
      id,
      p.spaceId,
      'company.finance.reference',
      input.id,
      async (ctx, a) => {
        await this.companies.staffVisibility(ctx, scopeId, false);
        const s: StaffContext = {
          ...ctx,
          scopeId,
          me: await this.op.access.seat(ctx, scopeId),
          change: async () => {
            await ctx.begin();
          },
        };
        this.op.manage(s);
        const r = await this.op.once(
          s,
          'company.finance.reference',
          key,
          input,
          async () => {
            await this.op.growth(
              s,
              'company.finance-reference',
              await s.tx.companyFinanceProjectReference.count({
                where: { spaceId: id },
              }),
            );
            await this.projects.count(s.tx, a, id);
            const audit = await ctx.begin();
            await s.tx.companyFinanceProjectReference.create({
              data: {
                ...this.op.where(s),
                id: input.id,
                createdByActorId: s.root.actorId,
              },
            });
            await this.projects.create(
              s.tx,
              a,
              actor,
              { ...this.op.where(s), id: input.id },
              input.projectId,
            );
            await this.op.access.effect(
              ctx,
              'company.finance.reference',
              input.id,
              audit,
              'company.finance-reference',
            );
            return { id: input.id };
          },
        );
        return dates(
          await s.tx.companyFinanceProjectReference.findUniqueOrThrow({
            where: { id: r.id },
          }),
        );
      },
    );
    return { ...row, project: await this.projects.visible(actor, id, row.id) };
  }
  async references(
    actor: RequestActor,
    id: string,
    scopeId: string,
    q: StaffPage,
  ) {
    const p = await this.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      return this.op.page(s, 'finance.references', q, async () =>
        (
          await s.tx.companyFinanceProjectReference.findMany({
            where: this.op.where(s),
          })
        ).map(dates),
      );
    });
    return {
      ...p,
      items: await Promise.all(
        p.items.map(async (r) => ({
          ...r,
          project: await this.projects.visible(actor, id, r.id),
        })),
      ),
    };
  }
  async budgetRow(s: FinanceContext, id: string) {
    const r = await s.tx.companyBudget.findFirst({
      where: { id, spaceId: s.spaceId },
    });
    if (!r) throw new NotFoundException();
    const context = {
      ...s,
      scopeId: r.scopeId,
      me: await this.op.access.seat(s, r.scopeId),
    };
    await this.companies.staffVisibility(s, r.scopeId, false);
    this.op.manage(context);
    return r;
  }
  async totals(s: FinanceContext, r: CompanyBudget) {
    const [adjustments, effects] = await Promise.all([
      s.tx.companyBudgetAdjustment.findMany({
        where: { spaceId: s.spaceId, budgetId: r.id },
      }),
      s.tx.companyBudgetEffect.findMany({
        where: { spaceId: s.spaceId, budgetId: r.id },
      }),
    ]);
    let limit = units(r.limit.toString(), r.scale);
    for (const a of adjustments) limit += units(a.amount.toString(), r.scale);
    let spent = 0n,
      reserved = 0n;
    for (const e of effects) {
      spent += units(e.spent.toString(), r.scale);
      reserved += units(e.reserved.toString(), r.scale);
    }
    if (limit < 0n || spent < 0n || reserved < 0n || limit < spent + reserved)
      throw new ConflictException({ code: 'BUDGET_LIMIT_EXCEEDED' });
    return { limit, spent, reserved, available: limit - spent - reserved };
  }
  async budgetView(s: FinanceContext, r: CompanyBudget) {
    const t = await this.totals(s, r);
    return {
      ...dates(r),
      limit: amount(t.limit, r.scale),
      spent: amount(t.spent, r.scale),
      reserved: amount(t.reserved, r.scale),
      available: amount(t.available, r.scale),
      startDate: r.startDate.toISOString().slice(0, 10),
      endDate: r.endDate.toISOString().slice(0, 10),
    };
  }
  private async project(s: FinanceContext, id: string | null) {
    if (
      id &&
      !(await s.tx.companyFinanceProjectReference.findFirst({
        where: { ...this.op.where(s), id },
      }))
    )
      throw new NotFoundException();
  }
  budgetCreate(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyBudgetCreateSchema>,
    key?: string,
  ) {
    return this.write(
      actor,
      id,
      scopeId,
      'budget.create',
      input.id,
      async (s) => {
        this.op.manage(s);
        const r = await this.op.once(
          s,
          'company.finance.budget',
          key,
          input,
          async () => {
            const m = this.money(input.amount, input.currency);
            await this.project(s, input.projectReferenceId);
            await this.growth(
              s,
              'company.budget',
              await s.tx.companyBudget.count({ where: this.op.where(s) }),
            );
            await s.change();
            await s.tx.companyBudget.create({
              data: {
                ...this.op.where(s),
                id: input.id,
                title: input.title,
                currency: input.currency,
                scale: m.scale,
                limit: m.value,
                startDate: new Date(input.startDate),
                endDate: new Date(input.endDate),
                timezone: input.timezone,
                projectReferenceId: input.projectReferenceId,
              },
            });
            return { id: input.id };
          },
        );
        return this.budgetView(s, await this.budgetRow(s, r.id));
      },
    );
  }
  budgets(actor: RequestActor, id: string, scopeId: string, q: StaffPage) {
    return this.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      return this.op.page(s, 'finance.budgets', q, async () =>
        Promise.all(
          (await s.tx.companyBudget.findMany({ where: this.op.where(s) })).map(
            (r) => this.budgetView(s, r),
          ),
        ),
      );
    });
  }
  budget(actor: RequestActor, id: string, scopeId: string, target: string) {
    return this.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      const r = await this.budgetRow(s, target);
      if (r.scopeId !== scopeId) throw new NotFoundException();
      return this.budgetView(s, r);
    });
  }
  budgetChange(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
    input:
      | z.infer<typeof c.CompanyBudgetChangeSchema>
      | z.infer<typeof c.CompanyBudgetArchiveSchema>,
  ) {
    return this.write(
      actor,
      id,
      scopeId,
      'budget.change',
      target,
      async (s) => {
        const r = await this.budgetRow(s, target);
        if (r.scopeId !== scopeId) throw new NotFoundException();
        this.op.match(r.revision, revision);
        if ('amount' in input) {
          if (r.archived) throw new ConflictException();
          const n =
            this.money(input.amount, r.currency).n *
            (input.direction === 'DECREASE' ? -1n : 1n);
          const t = await this.totals(s, r);
          if (
            t.limit + n < t.spent + t.reserved ||
            t.limit + n >= 10n ** BigInt(18 + r.scale)
          )
            throw new ConflictException({ code: 'BUDGET_LIMIT_EXCEEDED' });
          await s.change();
          await s.tx.companyBudgetAdjustment.create({
            data: {
              ...this.op.where(s),
              id: randomUUID(),
              budgetId: r.id,
              amount: amount(n, r.scale),
              createdByActorId: s.root.actorId,
            },
          });
        } else await s.change();
        const updated = await s.tx.companyBudget.update({
          where: { id: target },
          data: {
            ...('archived' in input ? { archived: input.archived } : {}),
            ...this.op.changed(s),
          },
        });
        return this.budgetView(s, updated);
      },
    );
  }
  async remaining(s: FinanceContext, r: CompanyCommitment, scale: number) {
    const effects = await s.tx.companyBudgetEffect.findMany({
      where: { spaceId: s.spaceId, commitmentId: r.id },
    });
    return effects.reduce(
      (n, e) => n + units(e.reserved.toString(), scale),
      0n,
    );
  }
  async commitmentView(s: FinanceContext, r: CompanyCommitment) {
    const b = await this.budgetRow(s, r.budgetId);
    return {
      ...dates(r),
      amount: amount(units(r.amount.toString(), b.scale), b.scale),
      remaining: amount(await this.remaining(s, r, b.scale), b.scale),
    };
  }
  commitments(
    actor: RequestActor,
    id: string,
    scopeId: string,
    budgetId: string,
    q: StaffPage,
  ) {
    return this.read(actor, id, scopeId, async (s) => {
      const b = await this.budgetRow(s, budgetId);
      if (b.scopeId !== scopeId) throw new NotFoundException();
      return this.op.page(s, 'finance.commitments:' + budgetId, q, async () =>
        Promise.all(
          (
            await s.tx.companyCommitment.findMany({
              where: { ...this.op.where(s), budgetId },
            })
          ).map((r) => this.commitmentView(s, r)),
        ),
      );
    });
  }
  commitmentCreate(
    actor: RequestActor,
    id: string,
    scopeId: string,
    budgetId: string,
    input: z.infer<typeof c.CompanyCommitmentCreateSchema>,
    key?: string,
  ) {
    return this.write(
      actor,
      id,
      scopeId,
      'commitment.create',
      input.id,
      async (s) => {
        const b = await this.budgetRow(s, budgetId);
        if (b.scopeId !== scopeId) throw new NotFoundException();
        const r = await this.op.once(
          s,
          'company.finance.commitment',
          key,
          { budgetId, ...input },
          async () => {
            if (b.archived) throw new ConflictException();
            const m = this.money(input.amount, b.currency);
            await this.growth(
              s,
              'company.commitment',
              await s.tx.companyCommitment.count({ where: this.op.where(s) }),
            );
            await s.change();
            await s.tx.companyCommitment.create({
              data: {
                ...this.op.where(s),
                id: input.id,
                budgetId,
                amount: m.value,
                state: 'ACTIVE',
                createdByActorId: s.root.actorId,
              },
            });
            await this.effect(s, budgetId, input.id, null, 0n, m.n, b.scale);
            await this.totals(s, b);
            return { id: input.id };
          },
        );
        return this.commitmentView(
          s,
          await s.tx.companyCommitment.findUniqueOrThrow({
            where: { id: r.id },
          }),
        );
      },
    );
  }
  commitmentRelease(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
  ) {
    return this.write(
      actor,
      id,
      scopeId,
      'commitment.release',
      target,
      async (s) => {
        const r = await s.tx.companyCommitment.findFirst({
          where: { ...this.op.where(s), id: target },
        });
        if (!r) throw new NotFoundException();
        this.op.match(r.revision, revision);
        const b = await this.budgetRow(s, r.budgetId);
        if (r.state !== 'ACTIVE') throw new ConflictException();
        await s.change();
        const n = await this.remaining(s, r, b.scale);
        await this.effect(s, b.id, r.id, null, 0n, -n, b.scale);
        const updated = await s.tx.companyCommitment.update({
          where: { id: target },
          data: { state: 'RELEASED', ...this.op.changed(s) },
        });
        return this.commitmentView(s, updated);
      },
    );
  }
  async effect(
    s: FinanceContext,
    budgetId: string,
    commitmentId: string | null,
    versionId: string | null,
    spent: bigint,
    reserved: bigint,
    scale: number,
    reversalOfId: string | null = null,
  ) {
    const b = await this.budgetRow(s, budgetId);
    const t = await this.totals(s, b);
    if (
      t.spent + spent < 0n ||
      t.reserved + reserved < 0n ||
      t.available - spent - reserved < 0n
    )
      throw new ConflictException({ code: 'BUDGET_LIMIT_EXCEEDED' });
    await s.tx.companyBudgetEffect.create({
      data: {
        ...this.op.where(s),
        id: randomUUID(),
        budgetId,
        commitmentId,
        versionId,
        reversalOfId,
        spent: amount(spent, scale),
        reserved: amount(reserved, scale),
        createdByActorId: s.root.actorId,
      },
    });
  }
  async version(s: FinanceContext, expenseId: string, versionId?: string) {
    const r = await s.tx.companyExpenseVersion.findFirst({
      where: {
        ...this.op.where(s),
        expenseId,
        ...(versionId ? { id: versionId } : {}),
      },
      orderBy: { number: 'desc' },
    });
    if (!r) throw new NotFoundException();
    return r;
  }
  async audience(s: FinanceContext, v: CompanyExpenseVersion) {
    if (
      this.manager(s) ||
      this.op.self(s, {
        accessId: v.requesterAccessId,
        generation: v.requesterGeneration,
      }) ||
      (v.payerAccessId &&
        this.op.self(s, {
          accessId: v.payerAccessId,
          generation: v.payerGeneration!,
        }))
    )
      return;
    throw new NotFoundException();
  }
  requester(s: FinanceContext, v: CompanyExpenseVersion) {
    this.eligible(s);
    if (
      !this.op.self(s, {
        accessId: v.requesterAccessId,
        generation: v.requesterGeneration,
      })
    )
      throw new ForbiddenException();
  }
  async mutable(s: FinanceContext, expenseId: string, versionId?: string) {
    const v = await this.version(s, expenseId, versionId);
    this.requester(s, v);
    if (v.state !== 'DRAFT' || v.kind === 'REVERSAL')
      throw new ConflictException();
    return v;
  }
  async revisionView(s: FinanceContext, v: CompanyExpenseVersion) {
    await this.audience(s, v);
    return c.CompanyExpenseRevisionSchema.strip().parse({
      ...dates(v),
      amount: amount(units(v.amount.toString(), v.scale), v.scale),
      requester: {
        accessId: v.requesterAccessId,
        generation: v.requesterGeneration,
      },
      reviewer: v.reviewerAccessId
        ? { accessId: v.reviewerAccessId, generation: v.reviewerGeneration }
        : null,
      payer: v.payerAccessId
        ? { accessId: v.payerAccessId, generation: v.payerGeneration }
        : null,
      occurredDate: v.occurredDate.toISOString().slice(0, 10),
      submittedAt: v.submittedAt?.toISOString() ?? null,
      decidedAt: v.decidedAt?.toISOString() ?? null,
      allocations: (
        await s.tx.companyExpenseAllocation.findMany({
          where: { ...this.op.where(s), versionId: v.id },
        })
      ).map((a) => ({
        budgetId: a.budgetId,
        commitmentId: a.commitmentId,
        amount: amount(units(a.amount.toString(), v.scale), v.scale),
      })),
    });
  }
  async expenseRow(s: FinanceContext, id: string) {
    const r = await s.tx.companyExpense.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!r) throw new NotFoundException();
    return r;
  }
  async expenseView(s: FinanceContext, r: CompanyExpense) {
    const versions = await s.tx.companyExpenseVersion.findMany({
      where: { ...this.op.where(s), expenseId: r.id },
      orderBy: { number: 'desc' },
    });
    let visible: CompanyExpenseVersion | undefined;
    for (const v of versions) {
      try {
        await this.audience(s, v);
        visible = v;
        break;
      } catch (e) {
        if (!(e instanceof NotFoundException)) throw e;
      }
    }
    if (!visible) throw new NotFoundException();
    return { ...dates(r), current: await this.revisionView(s, visible) };
  }
  expense(actor: RequestActor, id: string, scopeId: string, target: string) {
    return this.read(actor, id, scopeId, async (s) =>
      this.expenseView(s, await this.expenseRow(s, target)),
    );
  }
  expenses(actor: RequestActor, id: string, scopeId: string, q: StaffPage) {
    return this.read(actor, id, scopeId, (s) =>
      this.op.page(s, 'finance.expenses', q, async () => {
        const out = [];
        for (const r of await s.tx.companyExpense.findMany({
          where: this.op.where(s),
        })) {
          try {
            out.push(await this.expenseView(s, r));
          } catch (e) {
            if (!(e instanceof NotFoundException)) throw e;
          }
        }
        return out;
      }),
    );
  }
  revisions(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    q: StaffPage,
  ) {
    return this.read(actor, id, scopeId, (s) =>
      this.op.page(s, 'finance.revisions:' + target, q, async () => {
        await this.expenseRow(s, target);
        const out = [];
        for (const v of await s.tx.companyExpenseVersion.findMany({
          where: { ...this.op.where(s), expenseId: target },
        })) {
          try {
            out.push(await this.revisionView(s, v));
          } catch (e) {
            if (!(e instanceof NotFoundException)) throw e;
          }
        }
        if (!out.length) throw new NotFoundException();
        return out;
      }),
    );
  }
  private async facts(s: FinanceContext, input: Facts) {
    const m = this.money(input.amount, input.currency);
    const cat = await s.tx.companyExpenseCategory.findFirst({
      where: { ...this.op.where(s), id: input.categoryId, archived: false },
    });
    if (!cat) throw new NotFoundException();
    await this.project(s, input.projectReferenceId);
    if (input.payer) await this.op.member(s, input.payer);
    let sum = 0n;
    const seen = new Set<string>();
    for (const a of input.allocations) {
      if (seen.has(a.budgetId + ':' + a.commitmentId))
        throw new BadRequestException();
      seen.add(a.budgetId + ':' + a.commitmentId);
      const b = await s.tx.companyBudget.findFirst({
        where: {
          spaceId: s.spaceId,
          id: a.budgetId,
          currency: input.currency,
          archived: false,
        },
      });
      if (!b) throw new NotFoundException();
      await this.op.access.seat(s, b.scopeId);
      if (
        input.occurredDate < b.startDate.toISOString().slice(0, 10) ||
        input.occurredDate >= b.endDate.toISOString().slice(0, 10) ||
        input.timezone !== b.timezone
      )
        throw new BadRequestException();
      if (
        a.commitmentId &&
        !(await s.tx.companyCommitment.findFirst({
          where: {
            spaceId: s.spaceId,
            id: a.commitmentId,
            budgetId: b.id,
            state: 'ACTIVE',
          },
        }))
      )
        throw new NotFoundException();
      sum += this.money(a.amount, input.currency).n;
    }
    if (input.allocations.length && sum !== m.n)
      throw new BadRequestException({ code: 'ALLOCATION_SUM_MISMATCH' });
    return {
      currency: input.currency,
      scale: m.scale,
      amount: m.value,
      categoryId: input.categoryId,
      occurredDate: new Date(input.occurredDate),
      timezone: input.timezone,
      vendor: input.vendor,
      projectReferenceId: input.projectReferenceId,
      payerAccessId: input.payer?.accessId ?? null,
      payerGeneration: input.payer?.generation ?? null,
    };
  }
  private async allocationRows(
    s: FinanceContext,
    v: CompanyExpenseVersion,
    input: Facts,
  ) {
    for (const a of input.allocations)
      await s.tx.companyExpenseAllocation.create({
        data: {
          ...this.op.where(s),
          id: randomUUID(),
          versionId: v.id,
          budgetId: a.budgetId,
          commitmentId: a.commitmentId,
          amount: this.money(a.amount, v.currency).value,
        },
      });
  }
  expenseCreate(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyExpenseCreateSchema>,
    key?: string,
  ) {
    return this.write(
      actor,
      id,
      scopeId,
      'expense.create',
      input.id,
      async (s) => {
        this.eligible(s);
        const r = await this.op.once(
          s,
          'company.finance.expense',
          key,
          input,
          async () => {
            const facts = await this.facts(s, input);
            await this.growth(
              s,
              'company.expense',
              await s.tx.companyExpense.count({ where: this.op.where(s) }),
            );
            await s.change();
            await s.tx.companyExpense.create({
              data: { ...this.op.where(s), id: input.id, state: 'PENDING' },
            });
            const v = await s.tx.companyExpenseVersion.create({
              data: {
                ...this.op.where(s),
                ...facts,
                id: randomUUID(),
                expenseId: input.id,
                number: 1,
                kind: 'ORIGINAL',
                state: 'DRAFT',
                requesterAccessId: s.me.accessId,
                requesterGeneration: s.me.generation,
              },
            });
            await this.allocationRows(s, v, input);
            return { id: input.id };
          },
        );
        return this.expenseView(s, await this.expenseRow(s, r.id));
      },
    );
  }
  expensePatch(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
    input: Facts,
  ) {
    return this.write(actor, id, scopeId, 'expense.edit', target, async (s) => {
      const r = await this.expenseRow(s, target);
      this.op.match(r.revision, revision);
      const v = await this.mutable(s, target);
      const facts = await this.facts(s, input);
      await s.change();
      await s.tx.companyExpenseAllocation.deleteMany({
        where: { versionId: v.id },
      });
      const updated = await s.tx.companyExpenseVersion.update({
        where: { id: v.id },
        data: { ...facts, ...this.op.changed(s) },
      });
      await this.allocationRows(s, updated, input);
      return this.bump(s, r);
    });
  }
  async bump(
    s: FinanceContext,
    r: CompanyExpense,
    state?: string,
    effectiveVersionId?: string,
  ) {
    const row = await s.tx.companyExpense.update({
      where: { id: r.id },
      data: {
        ...this.op.changed(s),
        ...(state ? { state } : {}),
        ...(effectiveVersionId ? { effectiveVersionId } : {}),
      },
    });
    return this.expenseView(s, row);
  }
  async reviewer(s: FinanceContext, v: CompanyExpenseVersion, m: StaffMember) {
    const r = await this.op.member(s, m);
    if (
      (!(await this.op.access.staffReviewer(s, r)) &&
        !(r.role === 'DEPT_MANAGER' && s.scopeId !== s.spaceId)) ||
      r.accessId === v.requesterAccessId ||
      r.accessId === v.payerAccessId
    )
      throw new ForbiddenException();
    return r;
  }
  submit(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
    input: z.infer<typeof c.CompanyExpenseSubmitSchema>,
    reassign = false,
  ) {
    return this.write(
      actor,
      id,
      scopeId,
      reassign ? 'expense.reassign' : 'expense.submit',
      target,
      (s) => this.submitWithin(s, target, revision, input, reassign),
    );
  }
  async submitWithin(
    s: FinanceContext,
    target: string,
    revision: number,
    input: z.infer<typeof c.CompanyExpenseSubmitSchema>,
    reassign = false,
    controlled = false,
  ) {
    const r = await this.expenseRow(s, target);
    this.op.match(r.revision, revision);
    const v = await this.version(s, target);
    this.requester(s, v);
    if (!controlled || reassign) await this.extensions.assertExpense(s, v.id);
    if (v.state !== (reassign ? 'SUBMITTED' : 'DRAFT'))
      throw new ConflictException();
    await this.reviewer(s, v, input.reviewer);
    if (v.payerAccessId)
      await this.op.member(s, {
        accessId: v.payerAccessId,
        generation: v.payerGeneration!,
      });
    await s.change();
    if (!reassign) {
      for (const receipt of await s.tx.companyExpenseReceipt.findMany({
        where: { versionId: v.id },
      })) {
        const file = await this.files.row(
          s.tx,
          this.fileScope(s),
          receipt.fileId,
        );
        if (file.status === 'DELETED') continue;
        if (file.status !== 'READY' || !file.sha256)
          throw new ConflictException({ code: 'RECEIPT_NOT_READY' });
        await s.tx.companyExpenseReceipt.update({
          where: { id: receipt.id },
          data: {
            pinnedRevision: file.revision,
            pinnedHash: file.sha256,
            ...this.op.changed(s),
          },
        });
      }
    }
    await s.tx.companyExpenseVersion.update({
      where: { id: v.id },
      data: {
        state: 'SUBMITTED',
        submittedAt: v.submittedAt ?? s.now,
        reviewerAccessId: input.reviewer.accessId,
        reviewerGeneration: input.reviewer.generation,
        ...this.op.changed(s),
      },
    });
    await s.tx.companyExpenseReviewEvent.create({
      data: {
        ...this.op.where(s),
        id: randomUUID(),
        versionId: v.id,
        action: reassign ? 'REASSIGN' : 'SUBMIT',
        reviewerAccessId: input.reviewer.accessId,
        reviewerGeneration: input.reviewer.generation,
        createdByActorId: s.root.actorId,
      },
    });
    return this.bump(s, r);
  }

  fileScope(s: FinanceContext) {
    return {
      spaceId: s.spaceId,
      scopeId: s.scopeId,
      actorId: s.me.actorId,
      verify: (tx: typeof s.tx) => {
        if (tx !== s.tx) throw new ForbiddenException();
      },
    };
  }
  cancel(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
  ) {
    return this.write(
      actor,
      id,
      scopeId,
      'expense.cancel',
      target,
      async (s) => {
        const r = await this.expenseRow(s, target);
        this.op.match(r.revision, revision);
        const v = await this.version(s, target);
        this.requester(s, v);
        if (!['DRAFT', 'SUBMITTED'].includes(v.state))
          throw new ConflictException();
        await s.change();
        await this.extensions.cancel(s, { expenseVersionId: v.id });
        await s.tx.companyExpenseVersion.update({
          where: { id: v.id },
          data: { state: 'CANCELED', ...this.op.changed(s) },
        });
        return this.bump(s, r);
      },
    );
  }
  correction(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
    input: Facts | null,
    key?: string,
  ) {
    return this.write(
      actor,
      id,
      scopeId,
      input ? 'expense.correct' : 'expense.reverse',
      target,
      async (s) => {
        const r = await this.expenseRow(s, target);
        const latest = await this.version(s, target);
        await this.audience(s, latest);
        this.eligible(s);
        const current = r.effectiveVersionId
          ? await this.version(s, target, r.effectiveVersionId)
          : null;
        if (!current || r.state !== 'APPROVED') throw new ConflictException();
        if (!this.manager(s)) this.requester(s, current);
        const once = await this.op.once(
          s,
          input ? 'company.finance.correction' : 'company.finance.reversal',
          key,
          { target, revision, input },
          async () => {
            this.op.match(r.revision, revision);
            if (['DRAFT', 'SUBMITTED'].includes(latest.state))
              throw new ConflictException();
            if (latest.number >= 1000) throw new PayloadTooLargeException();
            const facts = input
              ? await this.facts(s, input)
              : {
                  currency: current.currency,
                  scale: current.scale,
                  amount: current.amount,
                  categoryId: current.categoryId,
                  occurredDate: current.occurredDate,
                  timezone: current.timezone,
                  vendor: current.vendor,
                  projectReferenceId: current.projectReferenceId,
                  payerAccessId: current.payerAccessId,
                  payerGeneration: current.payerGeneration,
                };
            await this.growth(s, 'company.expense-version', latest.number);
            await s.change();
            const v = await s.tx.companyExpenseVersion.create({
              data: {
                ...this.op.where(s),
                ...facts,
                id: randomUUID(),
                expenseId: target,
                number: latest.number + 1,
                kind: input ? 'CORRECTION' : 'REVERSAL',
                state: 'DRAFT',
                requesterAccessId: s.me.accessId,
                requesterGeneration: s.me.generation,
              },
            });
            if (input) await this.allocationRows(s, v, input);
            await s.tx.companyExpense.update({
              where: { id: target },
              data: this.op.changed(s),
            });
            return { id: target };
          },
        );
        return this.expenseView(s, await this.expenseRow(s, once.id));
      },
    );
  }
  private async reverseEffects(
    s: FinanceContext,
    v: CompanyExpenseVersion,
    reversalVersionId: string,
  ) {
    const effects = await s.tx.companyBudgetEffect.findMany({
      where: { spaceId: s.spaceId, versionId: v.id, reversalOfId: null },
    });
    for (const e of effects) {
      const b = await this.budgetRow(s, e.budgetId);
      const commitment = e.commitmentId
        ? await s.tx.companyCommitment.findUniqueOrThrow({
            where: { id: e.commitmentId },
          })
        : null;
      await this.effect(
        s,
        b.id,
        e.commitmentId,
        reversalVersionId,
        -units(e.spent.toString(), b.scale),
        commitment?.state === 'ACTIVE'
          ? -units(e.reserved.toString(), b.scale)
          : 0n,
        b.scale,
        e.id,
      );
    }
  }
  private async approveEffects(s: FinanceContext, v: CompanyExpenseVersion) {
    const rows = await s.tx.companyExpenseAllocation.findMany({
      where: { spaceId: s.spaceId, versionId: v.id },
    });
    for (const a of rows) {
      const b = await this.budgetRow(s, a.budgetId);
      if (
        b.archived ||
        b.currency !== v.currency ||
        b.scale !== v.scale ||
        v.occurredDate < b.startDate ||
        v.occurredDate >= b.endDate ||
        v.timezone !== b.timezone
      )
        throw new ConflictException();
      const n = units(a.amount.toString(), b.scale);
      if (a.commitmentId) {
        const r = await s.tx.companyCommitment.findUniqueOrThrow({
          where: { id: a.commitmentId },
        });
        if (r.state !== 'ACTIVE' || (await this.remaining(s, r, b.scale)) < n)
          throw new ConflictException({ code: 'COMMITMENT_EXHAUSTED' });
      }
      await this.effect(
        s,
        b.id,
        a.commitmentId,
        v.id,
        n,
        a.commitmentId ? -n : 0n,
        b.scale,
      );
      await this.totals(s, b);
    }
  }
  decide(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
    input: z.infer<typeof c.CompanyExpenseDecisionSchema>,
  ) {
    return this.write(actor, id, scopeId, 'expense.decide', target, (s) =>
      this.decideWithin(s, target, revision, input),
    );
  }
  async decideWithin(
    s: FinanceContext,
    target: string,
    revision: number,
    input: z.infer<typeof c.CompanyExpenseDecisionSchema>,
    controlled = false,
  ) {
    const r = await this.expenseRow(s, target);
    this.op.match(r.revision, revision);
    const v = await this.version(s, target);
    await this.audience(s, v);
    await this.extensions.assertExpense(s, v.id, controlled);
    if (
      v.state !== 'SUBMITTED' ||
      !v.reviewerAccessId ||
      !this.op.self(s, {
        accessId: v.reviewerAccessId,
        generation: v.reviewerGeneration!,
      })
    )
      throw new ForbiddenException();
    await this.reviewer(s, v, {
      accessId: v.reviewerAccessId,
      generation: v.reviewerGeneration!,
    });
    const requester = await this.op.member(s, {
      accessId: v.requesterAccessId,
      generation: v.requesterGeneration,
    });
    if (
      !['OWNER', 'ORG_ADMIN', 'DEPT_MANAGER', 'TEAM_LEAD', 'MEMBER'].includes(
        requester.role ?? '',
      ) &&
      !(await this.op.access.staffReviewer(s, requester))
    )
      throw new ForbiddenException();
    if (v.payerAccessId)
      await this.op.member(s, {
        accessId: v.payerAccessId,
        generation: v.payerGeneration!,
      });
    await s.change();
    if (input.decision === 'APPROVE') {
      if (r.effectiveVersionId)
        await this.reverseEffects(
          s,
          await this.version(s, target, r.effectiveVersionId),
          v.id,
        );
      if (v.kind !== 'REVERSAL') await this.approveEffects(s, v);
    }
    await s.tx.companyExpenseVersion.update({
      where: { id: v.id },
      data: {
        state: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        decidedAt: s.now,
        ...this.op.changed(s),
      },
    });
    await s.tx.companyExpenseReviewEvent.create({
      data: {
        ...this.op.where(s),
        id: randomUUID(),
        versionId: v.id,
        action: input.decision,
        reviewerAccessId: v.reviewerAccessId,
        reviewerGeneration: v.reviewerGeneration,
        createdByActorId: s.root.actorId,
      },
    });
    const result = await this.bump(
      s,
      r,
      input.decision === 'APPROVE'
        ? v.kind === 'REVERSAL'
          ? 'REVERSED'
          : 'APPROVED'
        : undefined,
      input.decision === 'APPROVE' && v.kind !== 'REVERSAL' ? v.id : undefined,
    );
    if (input.decision === 'APPROVE')
      await this.extensions.changed(
        s,
        r.id,
        v.kind === 'REVERSAL' ? null : await this.version(s, target, v.id),
      );
    return result;
  }
}

import { CompanyFinanceExtensions } from './company-finance.extensions.js';
