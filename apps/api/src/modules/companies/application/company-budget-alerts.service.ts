import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { CompanyFinanceService } from './company-finance.service.js';
import { CompanyFinanceExtensions } from './company-finance.extensions.js';
import type { StaffContext, StaffPage } from './company-staff.context.js';
import { companyDates } from './company-assets.service.js';
import { units } from '../../finance/public/index.js';
@Injectable()
export class CompanyBudgetAlertsService implements OnModuleInit {
  constructor(
    @Inject(CompanyFinanceService)
    private readonly finance: CompanyFinanceService,
    @Inject(CompanyFinanceExtensions)
    private readonly extensions: CompanyFinanceExtensions,
  ) {}
  get op() {
    return this.finance.op;
  }
  onModuleInit() {
    this.extensions.budgetAlerts((s) => this.evaluate(s));
  }
  private async view(
    s: StaffContext,
    r: Awaited<
      ReturnType<
        StaffContext['tx']['companyBudgetAlertRule']['findFirstOrThrow']
      >
    >,
  ) {
    return c.CompanyBudgetAlertSchema.strip().parse({
      ...companyDates(r),
      threshold: r.threshold.toFixed(4),
      revokedAt: r.revokedAt?.toISOString() ?? null,
      triggered: !!(await s.tx.companyBudgetAlertOccurrence.findFirst({
        where: { ruleId: r.id },
      })),
    });
  }
  list(actor: RequestActor, id: string, scopeId: string, q: StaffPage) {
    return this.finance.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      return this.op.page(s, 'company.budget.alert.rules', q, async () =>
        Promise.all(
          (
            await s.tx.companyBudgetAlertRule.findMany({
              where: this.op.where(s),
              take: 1001,
            })
          ).map((r) => this.view(s, r)),
        ),
      );
    });
  }
  create(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyBudgetAlertInputSchema>,
    key?: string,
  ) {
    const body = c.CompanyBudgetAlertInputSchema.parse(input);
    return this.finance.write(
      actor,
      id,
      scopeId,
      'budget.alert.create',
      body.id,
      async (s) => {
        this.op.manage(s);
        const budget = await this.finance.budgetRow(s, body.budgetId);
        if (budget.scopeId !== scopeId) throw new NotFoundException();
        const money = this.finance.money(body.threshold, budget.currency);
        const result = await this.op.once(
          s,
          'company.budget.alert.create',
          key,
          body,
          async () => {
            if (
              (await s.tx.companyBudgetAlertRule.count({
                where: this.op.where(s),
              })) >= 1000
            )
              throw new PayloadTooLargeException();
            await s.change();
            return s.tx.companyBudgetAlertRule.create({
              data: {
                ...this.op.where(s),
                ...body,
                threshold: money.value,
                actorId: s.root.actorId,
              },
            });
          },
        );
        await this.evaluate(s);
        return this.view(
          s,
          await s.tx.companyBudgetAlertRule.findFirstOrThrow({
            where: { ...this.op.where(s), id: result.id },
          }),
        );
      },
    );
  }
  revoke(
    actor: RequestActor,
    id: string,
    scopeId: string,
    ruleId: string,
    revision: number,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      'budget.alert.revoke',
      ruleId,
      async (s) => {
        this.op.manage(s);
        const r = await s.tx.companyBudgetAlertRule.findFirst({
          where: { ...this.op.where(s), id: ruleId },
        });
        if (!r) throw new NotFoundException();
        this.op.match(r.revision, revision);
        if (r.revokedAt) throw new ConflictException();
        await s.change();
        return this.view(
          s,
          await s.tx.companyBudgetAlertRule.update({
            where: { id: ruleId },
            data: { revokedAt: s.now, ...this.op.changed(s) },
          }),
        );
      },
    );
  }
  async evaluate(s: StaffContext) {
    const rules = await s.tx.companyBudgetAlertRule.findMany({
      where: { ...this.op.where(s), revokedAt: null },
      take: 1001,
    });
    if (rules.length > 1000) throw new PayloadTooLargeException();
    for (const rule of rules) {
      if (
        await s.tx.companyBudgetAlertOccurrence.findFirst({
          where: { ruleId: rule.id },
        })
      )
        continue;
      const budget = await this.finance.budgetRow(s, rule.budgetId),
        totals = await this.finance.totals(s, budget),
        value =
          rule.basis === 'SPENT'
            ? totals.spent
            : totals.spent + totals.reserved;
      if (value < units(rule.threshold.toString(), budget.scale)) continue;
      await s.change();
      await s.tx.companyBudgetAlertOccurrence.create({
        data: {
          ...this.op.where(s),
          id: randomUUID(),
          ruleId: rule.id,
          actorId: rule.actorId,
        },
      });
      const recipients = [];
      for (const member of await this.op.access.staffMembers(s, s.scopeId))
        if (
          (await this.op.access.staffReviewer(s, member)) ||
          (s.scopeId !== s.spaceId && member.role === 'DEPT_MANAGER')
        )
          recipients.push(member);
      await s.tx.companyNotification.createMany({
        data: recipients.map((m) => ({
          id: randomUUID(),
          ...this.op.where(s),
          recipientAccessId: m.accessId,
          recipientGeneration: m.generation,
          kind: 'BUDGET_THRESHOLD',
          subjectId: budget.id,
          dedupeKey: 'budget-alert:' + rule.id,
        })),
        skipDuplicates: true,
      });
    }
  }
}
