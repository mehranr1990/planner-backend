import { CompanyGoalsService } from './company-goals.service.js';
import { companyExport } from '../domain/company-export.js';
import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  PayloadTooLargeException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
import { ProjectFinanceReferences } from '../../projects/public/index.js';
import { units, amount } from '../../finance/public/index.js';
import { dayBoundary } from '../../calendar/public/index.js';
import { CompanyStaffContext } from './company-staff.context.js';
import type { StaffContext } from './company-staff.context.js';
import { CompanyFinanceService } from './company-finance.service.js';
import { CompanyReimbursementsService } from './company-reimbursements.service.js';
import { CompanyKnowledgeService } from './company-knowledge.service.js';
type Query = z.infer<typeof c.CompanyReportQuerySchema>;
const digest = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const bound = <T>(rows: T[]) => {
  if (rows.length > 10000) throw new PayloadTooLargeException();
  return rows;
};
@Injectable()
export class CompanyReportsService {
  constructor(
    @Inject(CompanyStaffContext) readonly op: CompanyStaffContext,
    @Inject(CompanyGoalsService) private readonly goals: CompanyGoalsService,
    @Inject(CompanyFinanceService)
    private readonly finance: CompanyFinanceService,
    @Inject(CompanyReimbursementsService)
    private readonly reimbursements: CompanyReimbursementsService,
    @Inject(CompanyKnowledgeService)
    private readonly knowledge: CompanyKnowledgeService,
    @Inject(ProjectFinanceReferences)
    private readonly projects: ProjectFinanceReferences,
  ) {}
  private projectWindow(q: Query) {
    const value = {
      fromAt: new Date(dayBoundary(q.fromDate, q.timezone)).toISOString(),
      toAt: new Date(dayBoundary(q.toDate, q.timezone)).toISOString(),
    };
    if (!c.ProjectReportWindowSchema.safeParse(value).success)
      throw new BadRequestException({
        code: 'PROJECT_REPORT_WINDOW_TOO_LARGE',
      });
    return value;
  }
  private header(s: StaffContext, q: Query) {
    return {
      schemaVersion: 1 as const,
      spaceId: s.spaceId,
      scopeId: s.scopeId,
      generatedAt: s.now.toISOString(),
      ...q,
    };
  }
  async operationsIn(s: StaffContext, q: Query) {
    this.op.manage(s);
    await this.op.erasureAllowed(s.tx, s.spaceId);
    const live = await this.op.live(s),
      where = this.op.where(s);
    const profiles = bound(
      await s.tx.companyStaffProfile.findMany({ where, take: 10001 }),
    ).filter(
      (r) =>
        !r.redactedAt &&
        live.get(r.memberAccessId)?.generation === r.memberGeneration,
    );
    const rows = bound(
      await s.tx.companyAvailabilityDay.findMany({
        where: {
          ...where,
          timezone: q.timezone,
          date: { gte: new Date(q.fromDate), lt: new Date(q.toDate) },
        },
        take: 10001,
      }),
    ).filter(
      (r) => live.get(r.memberAccessId)?.generation === r.memberGeneration,
    );
    const from = new Date(dayBoundary(q.fromDate, q.timezone)),
      to = new Date(dayBoundary(q.toDate, q.timezone));
    const resources = bound(
      await s.tx.companyResource.findMany({ where, take: 10001 }),
    );
    const allocations = bound(
      await s.tx.companyResourceAllocation.findMany({
        where: {
          ...where,
          state: 'ALLOCATED',
          startAt: { lt: to },
          endAt: { gt: from },
        },
        take: 10001,
      }),
    ).filter(
      (r) => live.get(r.memberAccessId)?.generation === r.memberGeneration,
    );
    return c.CompanyOperationsReportSchema.parse({
      ...this.header(s, q),
      basis: 'CURRENT_ADMISSIONS_AND_EXPLICIT_COMPANY_PLANNING',
      memberCount: live.size,
      profileCount: profiles.length,
      knownCapacityDays: rows.filter((r) => r.availableMinutes !== null).length,
      unknownCapacityDays:
        live.size *
          ((Date.parse(q.toDate) - Date.parse(q.fromDate)) / 86400000) -
        rows.filter((r) => r.availableMinutes !== null).length,
      availableMinutes: rows.reduce((n, r) => n + (r.availableMinutes ?? 0), 0),
      resourceCount: resources.length,
      activeAllocationCount: allocations.length,
    });
  }
  async financeIn(s: StaffContext, q: Query) {
    this.op.manage(s);
    const where = this.op.where(s),
      expenses = bound(
        await s.tx.companyExpense.findMany({
          where: {
            ...where,
            state: 'APPROVED',
            effectiveVersionId: { not: null },
          },
          take: 10001,
        }),
      );
    const totals = new Map<
      string,
      {
        currency: string;
        scale: number;
        expenseCount: number;
        spent: bigint;
        reimbursementEntitlement: bigint;
        acknowledged: bigint;
        reserved: bigint;
      }
    >();
    const bucket = (currency: string, scale: number) => {
      if (!totals.has(currency))
        totals.set(currency, {
          currency,
          scale,
          expenseCount: 0,
          spent: 0n,
          reimbursementEntitlement: 0n,
          acknowledged: 0n,
          reserved: 0n,
        });
      return totals.get(currency)!;
    };
    for (const e of expenses) {
      const v = await s.tx.companyExpenseVersion.findUniqueOrThrow({
        where: { id: e.effectiveVersionId! },
      });
      if (
        v.timezone !== q.timezone ||
        v.occurredDate < new Date(q.fromDate) ||
        v.occurredDate >= new Date(q.toDate)
      )
        continue;
      const b = bucket(v.currency, v.scale);
      b.spent += units(v.amount.toString(), v.scale);
      b.expenseCount++;
    }
    // Reimbursement columns are current balances for sources occurring in the selected window.
    const buckets = bound(
      await s.tx.companyReimbursementBucket.findMany({ where, take: 10001 }),
    );
    for (const b of buckets) {
      const v = await s.tx.companyExpenseVersion.findUniqueOrThrow({
        where: { id: b.initialVersionId },
      });
      if (
        v.timezone !== q.timezone ||
        v.occurredDate < new Date(q.fromDate) ||
        v.occurredDate >= new Date(q.toDate)
      )
        continue;
      const sums = await this.reimbursements.sums(s, b),
        out = bucket(b.currency, b.scale);
      out.reimbursementEntitlement += sums.entitlement;
      out.acknowledged += sums.acknowledged;
      out.reserved += sums.reserved;
    }
    const budgets = [];
    for (const b of bound(
      await s.tx.companyBudget.findMany({
        where,
        take: 10001,
        orderBy: { id: 'asc' },
      }),
    )) {
      const view = c.CompanyBudgetSchema.strip().parse(
        await this.finance.budgetView(s, b),
      );
      budgets.push({
        ...view,
        variance: amount(
          units(view.limit, b.scale) - units(view.spent, b.scale),
          b.scale,
        ),
      });
    }
    return c.CompanyFinanceReportSchema.parse({
      ...this.header(s, q),
      basis: 'EFFECTIVE_APPROVED_EXPENSES_BY_STORED_CIVIL_DATE_AND_TIMEZONE',
      currencies: [...totals.values()]
        .sort((a, b) => a.currency.localeCompare(b.currency))
        .map((r) => ({
          ...r,
          spent: amount(r.spent, r.scale),
          reimbursementEntitlement: amount(r.reimbursementEntitlement, r.scale),
          acknowledged: amount(r.acknowledged, r.scale),
          reserved: amount(r.reserved, r.scale),
        })),
      budgets,
    });
  }
  private read<T>(
    actor: RequestActor,
    id: string,
    scopeId: string,
    ordinary: boolean,
    work: (s: StaffContext) => Promise<T>,
  ) {
    return this.op.read(
      actor,
      id,
      scopeId,
      async (s) => {
        this.op.manage(s);
        return work(s);
      },
      ordinary,
    );
  }
  operations(actor: RequestActor, id: string, scopeId: string, q: Query) {
    return this.read(actor, id, scopeId, true, async (s) => {
      const view = await this.operationsIn(s, q);
      await this.op.audit(s, scopeId, 'company.report.operations');
      return view;
    });
  }
  financial(actor: RequestActor, id: string, scopeId: string, q: Query) {
    return this.read(actor, id, scopeId, false, async (s) => {
      const view = await this.financeIn(s, q);
      await this.op.audit(s, scopeId, 'company.report.finance');
      return view;
    });
  }
  private async across<T>(
    actor: RequestActor,
    id: string,
    scopeId: string,
    includeProjects: boolean,
    ordinary: boolean,
    work: (
      s: StaffContext,
      a: SharedAuthority,
      anchors: string[],
    ) => Promise<T>,
  ) {
    const anchors = includeProjects
      ? await this.read(actor, id, scopeId, false, async (s) => {
          const rows = await s.tx.companyFinanceProjectReference.findMany({
            where: this.op.where(s),
            orderBy: { id: 'asc' },
            take: 101,
          });
          if (rows.length > 100) throw new PayloadTooLargeException();
          return rows.map((r) => r.id);
        })
      : [];
    const hints = includeProjects
      ? await this.projects.portfolioHints(id, anchors)
      : [];
    return this.op.access.readAcross(
      actor,
      id,
      hints.map((r) => r.scopeId),
      async (ctx, a) => {
        await this.knowledge.visibility(ctx, scopeId, ordinary);
        const s: StaffContext = {
          ...ctx,
          scopeId,
          me: await this.op.access.seat(ctx, scopeId),
          change: async () => {
            throw new Error('Read cannot mutate');
          },
        };
        this.op.manage(s);
        const current = includeProjects
          ? (
              await s.tx.companyFinanceProjectReference.findMany({
                where: this.op.where(s),
                orderBy: { id: 'asc' },
                take: 101,
              })
            ).map((r) => r.id)
          : [];
        if (digest(current) !== digest(anchors))
          throw new ConflictException({ code: 'PORTFOLIO_SOURCE_CHANGED' });
        return work(s, a, current);
      },
    );
  }
  portfolio(actor: RequestActor, id: string, scopeId: string, q: Query) {
    return this.across(actor, id, scopeId, true, false, async (s, a, anchors) =>
      c.CompanyPortfolioReportSchema.parse({
        ...this.header(s, q),
        basis: 'EXISTING_FINANCIAL_ANCHORS_AND_CURRENT_SOURCE_AUTHORITY',
        projects: await this.projects.portfolio(
          s.tx,
          a,
          id,
          anchors,
          this.projectWindow(q),
          s.now,
        ),
      }),
    );
  }
  /**
   * C-M3 KPIs from existing authorized sources only: portfolio Project reports
   * (task completion = DONE / (all - CANCELED)), explicit Company availability
   * and Project estimates (capacity), effective approved expenses and active
   * budgets in the fixed Company currency (usage = budget spent / budget limit).
   * No Company goal source exists (OD-2), so goals are null; no scores.
   */
  kpis(actor: RequestActor, id: string, scopeId: string, q: Query) {
    return this.across(
      actor,
      id,
      scopeId,
      true,
      false,
      async (s, a, anchors) => {
        const operations = await this.operationsIn(s, q),
          finance = await this.financeIn(s, q),
          projects = await this.projects.portfolio(
            s.tx,
            a,
            id,
            anchors,
            this.projectWindow(q),
            s.now,
          ),
          company = await s.tx.company.findUniqueOrThrow({ where: { id } });
        let total = 0,
          done = 0,
          overdue = 0,
          completed = 0,
          estimated = 0,
          unknown = 0;
        for (const p of projects) {
          total += p.report.taskCount - p.report.statusCounts.CANCELED;
          done += p.report.statusCounts.DONE;
          overdue += p.report.overdueTaskCount;
          completed += p.report.completedInWindow;
          estimated += p.report.estimatedMinutes;
          unknown += p.report.unknownEstimates;
        }
        const fixed = company.currency,
          scale = company.scale ?? 0,
          budgets = finance.budgets.filter(
            (b) =>
              b.currency === fixed &&
              !b.archived &&
              b.startDate < q.toDate &&
              b.endDate > q.fromDate,
          ),
          limit = budgets.reduce((n, b) => n + units(b.limit, scale), 0n),
          used = budgets.reduce((n, b) => n + units(b.spent, scale), 0n),
          spent = finance.currencies.find((r) => r.currency === fixed);
        const view = c.CompanyKpiReportSchema.parse({
          ...this.header(s, q),
          tasks: {
            source: 'AUTHORIZED_PORTFOLIO_PROJECT_REPORTS',
            projectCount: projects.length,
            completion: {
              numerator: done,
              denominator: total,
              basisPoints: total ? Math.floor((done * 10000) / total) : null,
            },
            overdueTaskCount: overdue,
            completedInWindow: completed,
          },
          goals: await this.goals
            .kpi(s)
            .then((g) =>
              g.goalCount
                ? { source: 'COMPANY_GOAL_KEY_RESULTS' as const, ...g }
                : null,
            ),
          capacity: {
            source: 'EXPLICIT_COMPANY_AVAILABILITY_AND_PROJECT_ESTIMATES',
            memberCount: operations.memberCount,
            knownCapacityDays: operations.knownCapacityDays,
            unknownCapacityDays: operations.unknownCapacityDays,
            availableMinutes: operations.availableMinutes,
            estimatedMinutes: estimated,
            unknownEstimates: unknown,
          },
          expenses: {
            source: 'EFFECTIVE_APPROVED_EXPENSES_AND_ACTIVE_BUDGETS',
            currency: fixed,
            spent: fixed ? (spent?.spent ?? amount(0n, scale)) : null,
            budgetCount: budgets.length,
            budgetSpent: fixed && budgets.length ? amount(used, scale) : null,
            budgetLimit: fixed && budgets.length ? amount(limit, scale) : null,
            usageBasisPoints:
              fixed && limit > 0n ? Number((used * 10000n) / limit) : null,
          },
        });
        await this.op.audit(s, scopeId, 'company.report.kpis');
        return view;
      },
    );
  }
  async auditIn(s: StaffContext) {
    this.op.manage(s);
    const where = this.op.where(s),
      ids = async (rows: Promise<{ id: string }[]>) =>
        bound(await rows).map((r) => r.id),
      groups: { actions: string[]; ids: string[] }[] = [];
    groups.push({
      actions: [
        'company.report.operations',
        'company.report.finance',
        'company.report.portfolio',
        'company.export.publish',
        'company.knowledge.file.reconcile',
      ],
      ids: [s.scopeId],
    });
    for (const [actions, rows] of [
      [
        ['folder.create', 'folder.update'],
        s.tx.companyKnowledgeFolder.findMany({
          where,
          select: { id: true },
          take: 10001,
        }),
      ],
      [
        ['document.create', 'document.update'],
        s.tx.companyKnowledgeDocument.findMany({
          where,
          select: { id: true },
          take: 10001,
        }),
      ],
      [
        [
          'version.create',
          'version.publish',
          'file.claim',
          'file.ready',
          'file.reject',
          'file.delete',
          'file.cleanup',
          'file.read',
        ],
        s.tx.companyKnowledgeVersion.findMany({
          where,
          select: { id: true },
          take: 10001,
        }),
      ],
    ] as const)
      groups.push({
        actions: actions.map((a) => 'company.knowledge.' + a),
        ids: await ids(rows),
      });
    try {
      await this.knowledge.visibility(s, s.scopeId, true);
      await this.op.erasureAllowed(s.tx, s.spaceId);
      const live = await this.op.live(s);
      groups.push(
        {
          actions: [
            'company.resource.create',
            'company.resource.update',
            'company.resource.retire',
          ],
          ids: await ids(
            s.tx.companyResource.findMany({
              where,
              select: { id: true },
              take: 10001,
            }),
          ),
        },
        {
          actions: [
            'company.allocation.create',
            'company.allocation.canceled',
            'company.allocation.returned',
          ],
          ids: await ids(
            s.tx.companyResourceAllocation.findMany({
              where,
              select: { id: true },
              take: 10001,
            }),
          ),
        },
        {
          actions: [
            'company.availability.create',
            'company.availability.update',
          ],
          ids: bound(
            await s.tx.companyAvailabilityDay.findMany({ where, take: 10001 }),
          )
            .filter(
              (r) =>
                live.get(r.memberAccessId)?.generation === r.memberGeneration,
            )
            .map((r) => r.id),
        },
      );
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
    }
    const financeIds = [
      ...(await ids(
        s.tx.companyExpenseCategory.findMany({
          where,
          select: { id: true },
          take: 10001,
        }),
      )),
      ...(await ids(
        s.tx.companyFinanceProjectReference.findMany({
          where,
          select: { id: true },
          take: 10001,
        }),
      )),
      ...(await ids(
        s.tx.companyExpense.findMany({
          where,
          select: { id: true },
          take: 10001,
        }),
      )),
      ...(await ids(
        s.tx.companyExpenseVersion.findMany({
          where,
          select: { id: true },
          take: 10001,
        }),
      )),
      ...(await ids(
        s.tx.companyBudget.findMany({
          where,
          select: { id: true },
          take: 10001,
        }),
      )),
      ...(await ids(
        s.tx.companyCommitment.findMany({
          where,
          select: { id: true },
          take: 10001,
        }),
      )),
      ...(await ids(
        s.tx.companyExpenseReceipt.findMany({
          where,
          select: { id: true },
          take: 10001,
        }),
      )),
      ...(await ids(
        s.tx.companyReimbursementRequest.findMany({
          where,
          select: { id: true },
          take: 10001,
        }),
      )),
      ...(await ids(
        s.tx.companyPaymentAcknowledgement.findMany({
          where,
          select: { id: true },
          take: 10001,
        }),
      )),
      ...(await ids(
        s.tx.companyAcknowledgementCorrection.findMany({
          where,
          select: { id: true },
          take: 10001,
        }),
      )),
      ...(await ids(
        s.tx.companyFinancialWorkflow.findMany({
          where,
          select: { id: true },
          take: 10001,
        }),
      )),
      ...(await ids(
        s.tx.companyFinancialWorkflowVersion.findMany({
          where,
          select: { id: true },
          take: 10001,
        }),
      )),
      ...(await ids(
        s.tx.companyFinancialApproval.findMany({
          where,
          select: { id: true },
          take: 10001,
        }),
      )),
    ];
    groups.push({
      actions: [
        'acknowledgement.cancel',
        'acknowledgement.correct',
        'acknowledgement.decide',
        'budget.change',
        'budget.create',
        'category.change',
        'category.create',
        'commitment.create',
        'commitment.release',
        'expense.cancel',
        'expense.correct',
        'expense.create',
        'expense.decide',
        'expense.edit',
        'expense.reassign',
        'expense.reverse',
        'expense.submit',
        'payment.cancel',
        'payment.decide',
        'payment.propose',
        'receipt.claim',
        'receipt.cleanup',
        'receipt.delete',
        'receipt.initiate',
        'receipt.ready',
        'receipt.reconcile',
        'receipt.reject',
        'reference',
        'reimbursement.cancel',
        'reimbursement.close',
        'reimbursement.create',
        'reimbursement.edit',
        'workflow.create',
        'workflow.decide',
        'workflow.escalate',
        'workflow.expense.submit',
        'workflow.reimbursement.submit',
        'workflow.restart',
        'workflow.version.archive',
        'workflow.version.create',
        'workflow.version.edit',
        'workflow.version.publish',
      ].map((a) => 'company.finance.' + a),
      ids: financeIds,
    });
    return this.op.access.auditProjection(s, s.scopeId, groups);
  }
  audit(
    actor: RequestActor,
    id: string,
    scopeId: string,
    q: z.infer<typeof c.CompanyAuditQuerySchema>,
  ) {
    return this.read(actor, id, scopeId, false, (s) =>
      this.op.page(s, 'company.audit', q, () => this.auditIn(s), 10000),
    );
  }
  async export(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyExportInputSchema>,
  ) {
    const q = c.CompanyReportQuerySchema.parse({
      fromDate: input.fromDate,
      toDate: input.toDate,
      timezone: input.timezone,
    });
    return this.across(
      actor,
      id,
      scopeId,
      input.dataset === 'PORTFOLIO',
      input.dataset === 'OPERATIONS',
      async (s, a, anchors) => {
        let data: unknown, rows: unknown[];
        if (input.dataset === 'FINANCE') {
          const r = await this.financeIn(s, q);
          data = r;
          rows = [...r.currencies, ...r.budgets];
        } else if (input.dataset === 'OPERATIONS') {
          const r = await this.operationsIn(s, q);
          data = r;
          rows = [r];
        } else if (input.dataset === 'PORTFOLIO') {
          rows = await this.projects.portfolio(
            s.tx,
            a,
            id,
            anchors,
            {
              fromAt: new Date(
                dayBoundary(q.fromDate, q.timezone),
              ).toISOString(),
              toAt: new Date(dayBoundary(q.toDate, q.timezone)).toISOString(),
            },
            s.now,
          );
          data = { ...this.header(s, q), projects: rows };
        } else if (input.dataset === 'AUDIT') {
          rows = await this.auditIn(s);
          data = { ...this.header(s, q), items: rows };
        } else {
          rows = [];
          for (const d of await this.knowledge.documentsIn(s)) {
            if (d.archived || !d.publishedVersionId) continue;
            try {
              await this.knowledge.ancestors(s, d.folderId, false);
              const { v, f } = await this.knowledge.version(
                s,
                d.id,
                d.publishedVersionId,
              );
              rows.push({
                id: d.id,
                folderId: d.folderId,
                versionId: v.id,
                title: v.title,
                description: v.description,
                filename: f.filename,
                mimeType: f.mimeType,
                size: f.actualSize,
                sha256: v.pinnedHash,
                publishedAt: v.publishedAt!.toISOString(),
              });
            } catch (e) {
              if (!(e instanceof NotFoundException)) throw e;
            }
          }
          data = { ...this.header(s, q), items: rows };
        }
        const limits = await this.op.access.exportLimits(s, s.scopeId);
        let body: string;
        try {
          body = companyExport(input.dataset, input.format, data, rows, limits);
        } catch (error) {
          if (error instanceof RangeError) throw new PayloadTooLargeException();
          throw error;
        }
        // Construction and inline publication share current Company/source fences; no external IO or retained artifact.
        const publication = await this.op.audit(
          s,
          scopeId,
          'company.export.publish',
        );
        return {
          exportId: publication.id,
          body,
          mimeType:
            input.format === 'JSON'
              ? 'application/json'
              : 'text/csv; charset=utf-8',
          filename:
            'company-' +
            input.dataset.toLowerCase() +
            '.' +
            input.format.toLowerCase(),
        };
      },
    );
  }
  exports(
    actor: RequestActor,
    id: string,
    scopeId: string,
    q: z.infer<typeof c.CompanyPageQuerySchema>,
  ) {
    return this.read(actor, id, scopeId, false, async (s) => {
      this.op.manage(s);
      return this.op.page(
        s,
        'company.exports',
        q,
        () => this.op.access.exportPublications(s, scopeId),
        10000,
      );
    });
  }
  exportStatus(
    actor: RequestActor,
    id: string,
    scopeId: string,
    exportId: string,
  ) {
    return this.read(actor, id, scopeId, false, async (s) => {
      this.op.manage(s);
      const row = (await this.op.access.exportPublications(s, scopeId)).find(
        (r) => r.id === exportId,
      );
      if (!row) throw new NotFoundException();
      return row;
    });
  }
}
