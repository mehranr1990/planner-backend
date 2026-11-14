import {
  Inject,
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type {
  CompanyBudget,
  CompanyBudgetChangeRequest,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { units, amount } from '../../finance/public/index.js';
import { CompanyFinanceService } from './company-finance.service.js';
import type { FinanceContext } from './company-finance.service.js';
import type { StaffPage } from './company-staff.context.js';
const ref = (accessId: string, generation: number) => ({
  accessId,
  generation,
});
/**
 * ER review history and BU budget change requests (owner-approved 2026-11-13).
 * An approved budget stays effective until a change request is approved by a
 * scope manager other than the requester; rejection requires a reason.
 */
@Injectable()
export class CompanyFinanceRequestsService {
  constructor(
    @Inject(CompanyFinanceService)
    private readonly finance: CompanyFinanceService,
  ) {}
  private get op() {
    return this.finance.op;
  }
  reviewHistory(
    actor: RequestActor,
    id: string,
    scopeId: string,
    expenseId: string,
    q: StaffPage,
  ) {
    return this.finance.read(actor, id, scopeId, async (s) => {
      await this.finance.expenseView(
        s,
        await this.finance.expenseRow(s, expenseId),
      );
      const versions = await s.tx.companyExpenseVersion.findMany({
        where: { ...this.op.where(s), expenseId },
        select: { id: true },
      });
      const events = await s.tx.companyExpenseReviewEvent.findMany({
        where: {
          ...this.op.where(s),
          versionId: { in: versions.map((v) => v.id) },
        },
        take: 1001,
      });
      const reasons = new Map(
        (
          await s.tx.companyDecisionReason.findMany({
            where: { expenseEventId: { in: events.map((e) => e.id) } },
          })
        ).map((r) => [r.expenseEventId, r.reason]),
      );
      return this.op.page(
        s,
        'finance.expense.reviews:' + expenseId,
        q,
        async () =>
          events.map((e) => ({
            id: e.id,
            versionId: e.versionId,
            action: e.action,
            reviewer: e.reviewerAccessId
              ? ref(e.reviewerAccessId, e.reviewerGeneration!)
              : null,
            reason: reasons.get(e.id) ?? null,
            createdAt: e.createdAt.toISOString(),
          })),
      );
    });
  }
  private view(
    s: FinanceContext,
    r: CompanyBudgetChangeRequest,
    budget: CompanyBudget,
  ) {
    const n = units(r.amount.toString(), budget.scale),
      mine = this.op.self(s, ref(r.requesterAccessId, r.requesterGeneration)),
      pending = r.state === 'PENDING';
    return {
      id: r.id,
      budgetId: r.budgetId,
      budgetRevision: r.budgetRevision,
      amount: amount(n < 0n ? -n : n, budget.scale),
      direction: n < 0n ? 'DECREASE' : 'INCREASE',
      currency: budget.currency,
      requester: ref(r.requesterAccessId, r.requesterGeneration),
      reason: r.reason,
      state: r.state as z.infer<typeof c.CompanyBudgetChangeRequestStateSchema>,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionReason: r.decisionReason,
      adjustmentId: r.adjustmentId,
      revision: r.revision,
      createdAt: r.createdAt.toISOString(),
      can: {
        decide: pending && !mine && this.finance.manager(s),
        withdraw: pending && mine,
      },
    } satisfies z.input<typeof c.CompanyBudgetChangeRequestSchema>;
  }
  private async budget(s: FinanceContext, budgetId: string, scopeId: string) {
    const b = await this.finance.budgetRow(s, budgetId);
    if (b.scopeId !== scopeId) throw new NotFoundException();
    return b;
  }
  private async requestRow(s: FinanceContext, requestId: string) {
    const r = await s.tx.companyBudgetChangeRequest.findFirst({
      where: { ...this.op.where(s), id: requestId },
    });
    if (!r) throw new NotFoundException();
    return { r, budget: await this.budget(s, r.budgetId, s.scopeId) };
  }
  /** Same limit guard as a direct adjustment: never below spent + reserved. */
  private async guard(s: FinanceContext, b: CompanyBudget, n: bigint) {
    const t = await this.finance.totals(s, b);
    if (
      t.limit + n < t.spent + t.reserved ||
      t.limit + n >= 10n ** BigInt(18 + b.scale)
    )
      throw new ConflictException({ code: 'BUDGET_LIMIT_EXCEEDED' });
  }
  list(
    actor: RequestActor,
    id: string,
    scopeId: string,
    budgetId: string,
    q: StaffPage,
  ) {
    return this.finance.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      const b = await this.budget(s, budgetId, scopeId);
      return this.op.page(
        s,
        'finance.budget.changes:' + budgetId,
        q,
        async () =>
          (
            await s.tx.companyBudgetChangeRequest.findMany({
              where: { ...this.op.where(s), budgetId },
              take: 1001,
            })
          ).map((r) => this.view(s, r, b)),
      );
    });
  }
  get(actor: RequestActor, id: string, scopeId: string, requestId: string) {
    return this.finance.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      const { r, budget } = await this.requestRow(s, requestId);
      return this.view(s, r, budget);
    });
  }
  create(
    actor: RequestActor,
    id: string,
    scopeId: string,
    budgetId: string,
    input: z.infer<typeof c.CompanyBudgetChangeRequestCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.CompanyBudgetChangeRequestCreateSchema.parse(input);
    return this.finance.write(
      actor,
      id,
      scopeId,
      'budget.change.request',
      body.id,
      async (s) => {
        this.op.manage(s);
        const b = await this.budget(s, budgetId, scopeId);
        if (b.archived) throw new ConflictException();
        const n =
          this.finance.money(body.amount, b.currency).n *
          (body.direction === 'DECREASE' ? -1n : 1n);
        await this.op.once(
          s,
          'company.finance.budget.change.request',
          key,
          { ...body, budgetId },
          async () => {
            if (
              await s.tx.companyBudgetChangeRequest.findFirst({
                where: { spaceId: s.spaceId, budgetId, state: 'PENDING' },
              })
            )
              throw new ConflictException({ code: 'BUDGET_CHANGE_PENDING' });
            await this.guard(s, b, n);
            await s.change();
            return s.tx.companyBudgetChangeRequest.create({
              data: {
                ...this.op.where(s),
                id: body.id,
                budgetId,
                budgetRevision: b.revision,
                amount: amount(n, b.scale),
                requesterAccessId: s.me.accessId,
                requesterGeneration: s.me.generation,
                requesterActorId: s.root.actorId,
                reason: body.reason,
                state: 'PENDING',
                updatedAt: s.now,
              },
            });
          },
        );
        const { r, budget } = await this.requestRow(s, body.id);
        if (r.budgetId !== budgetId) throw new ConflictException();
        return this.view(s, r, budget);
      },
    );
  }
  decide(
    actor: RequestActor,
    id: string,
    scopeId: string,
    requestId: string,
    revision: number,
    input: z.infer<typeof c.CompanyBudgetChangeDecisionSchema>,
  ) {
    const body = c.CompanyBudgetChangeDecisionSchema.parse(input);
    return this.finance.write(
      actor,
      id,
      scopeId,
      'budget.change.decide',
      requestId,
      async (s) => {
        this.op.manage(s);
        const { r, budget } = await this.requestRow(s, requestId);
        this.op.match(r.revision, revision);
        if (r.state !== 'PENDING')
          throw new ConflictException({ code: 'BUDGET_CHANGE_CLOSED' });
        if (this.op.self(s, ref(r.requesterAccessId, r.requesterGeneration)))
          throw new ForbiddenException({ code: 'SELF_APPROVAL_FORBIDDEN' });
        let adjustmentId: string | null = null;
        if (body.decision === 'APPROVE') {
          if (budget.archived) throw new ConflictException();
          if (budget.revision !== r.budgetRevision)
            throw new ConflictException({ code: 'BUDGET_CHANGED' });
          const n = units(r.amount.toString(), budget.scale);
          await this.guard(s, budget, n);
          await s.change();
          adjustmentId = randomUUID();
          await s.tx.companyBudgetAdjustment.create({
            data: {
              ...this.op.where(s),
              id: adjustmentId,
              budgetId: budget.id,
              amount: amount(n, budget.scale),
              createdByActorId: s.root.actorId,
            },
          });
          await s.tx.companyBudget.update({
            where: { id: budget.id },
            data: this.op.changed(s),
          });
        } else await s.change();
        const updated = await s.tx.companyBudgetChangeRequest.update({
          where: { id: r.id, revision: r.revision },
          data: {
            state: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
            deciderActorId: s.root.actorId,
            decidedAt: s.now,
            decisionReason: body.reason,
            adjustmentId,
            ...this.op.changed(s),
          },
        });
        return this.view(
          s,
          updated,
          await s.tx.companyBudget.findUniqueOrThrow({
            where: { id: budget.id },
          }),
        );
      },
    );
  }
  withdraw(
    actor: RequestActor,
    id: string,
    scopeId: string,
    requestId: string,
    revision: number,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      'budget.change.withdraw',
      requestId,
      async (s) => {
        const { r, budget } = await this.requestRow(s, requestId);
        this.op.match(r.revision, revision);
        if (!this.op.self(s, ref(r.requesterAccessId, r.requesterGeneration)))
          throw new ForbiddenException();
        if (r.state !== 'PENDING')
          throw new ConflictException({ code: 'BUDGET_CHANGE_CLOSED' });
        await s.change();
        const updated = await s.tx.companyBudgetChangeRequest.update({
          where: { id: r.id, revision: r.revision },
          data: { state: 'WITHDRAWN', ...this.op.changed(s) },
        });
        return this.view(s, updated, budget);
      },
    );
  }
}
