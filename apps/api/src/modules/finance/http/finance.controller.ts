import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import { SpacesService } from '../../spaces/public/index.js';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';
import { LedgerService } from '../application/ledger.service.js';
import { FinancePlanningService } from '../application/planning.service.js';
import {
  FinanceReportsService,
  csvText,
} from '../application/reports.service.js';
const empty = new ZodValidationPipe(c.EmptyQuerySchema),
  idPipe = new ZodValidationPipe(c.TaskIdSchema),
  query = new ZodValidationPipe(c.FinanceQuerySchema);
function required(tag: string | undefined) {
  const r = expectedRevision(tag);
  if (r === undefined) throw new BadRequestException();
  return r;
}
function versioned<T extends { revision: number }>(res: Response, v: T) {
  res.setHeader('ETag', revisionTag(v.revision));
  return v;
}
@Controller('finance')
@UseGuards(VerifiedSessionGuard)
export class FinanceController {
  constructor(
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(FinancePlanningService)
    private readonly plan: FinancePlanningService,
    @Inject(FinanceReportsService)
    private readonly reports: FinanceReportsService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Post('accounts') async createAccount(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.FinanceAccountCreateSchema))
    b: z.infer<typeof c.FinanceAccountCreateSchema>,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.ledger.createAccount(
        await this.spaces.authorizePersonal(a),
        k,
        b,
      ),
    );
  }
  @Get('accounts') async listaccount(
    @CurrentActor() a: RequestActor,
    @Query(query) q: c.FinanceQuery,
  ) {
    return this.plan.list(await this.spaces.authorizePersonal(a), 'account', q);
  }
  @Get('accounts/:id') async getaccount(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.get(
        await this.spaces.authorizePersonal(a),
        'account',
        id,
      ),
    );
  }
  @Patch('accounts/:id') async updateAccount(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.FinanceAccountPatchSchema))
    b: z.infer<typeof c.FinanceAccountPatchSchema>,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.updateAccount(
        await this.spaces.authorizePersonal(a),
        id,
        required(tag),
        b,
      ),
    );
  }
  @Delete('accounts/:id') async archiveaccount(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.EmptyQuerySchema.optional())) _b: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.updateAccount(
        await this.spaces.authorizePersonal(a),
        id,
        required(tag),
        { archived: true },
      ),
    );
  }
  @Post('categories') async createCategory(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.FinanceCategoryCreateSchema))
    b: z.infer<typeof c.FinanceCategoryCreateSchema>,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.ledger.createCategory(
        await this.spaces.authorizePersonal(a),
        k,
        b,
      ),
    );
  }
  @Get('categories') async listcategory(
    @CurrentActor() a: RequestActor,
    @Query(query) q: c.FinanceQuery,
  ) {
    return this.plan.list(
      await this.spaces.authorizePersonal(a),
      'category',
      q,
    );
  }
  @Get('categories/:id') async getcategory(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.get(
        await this.spaces.authorizePersonal(a),
        'category',
        id,
      ),
    );
  }
  @Patch('categories/:id') async updateCategory(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.FinanceCategoryPatchSchema))
    b: z.infer<typeof c.FinanceCategoryPatchSchema>,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.updateCategory(
        await this.spaces.authorizePersonal(a),
        id,
        required(tag),
        b,
      ),
    );
  }
  @Delete('categories/:id') async archivecategory(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.EmptyQuerySchema.optional())) _b: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.updateCategory(
        await this.spaces.authorizePersonal(a),
        id,
        required(tag),
        { archived: true },
      ),
    );
  }
  @Post('budgets') async createBudget(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.FinanceBudgetCreateSchema))
    b: z.infer<typeof c.FinanceBudgetCreateSchema>,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.createBudget(
        await this.spaces.authorizePersonal(a),
        k,
        b,
      ),
    );
  }
  @Get('budgets') async listbudget(
    @CurrentActor() a: RequestActor,
    @Query(query) q: c.FinanceQuery,
  ) {
    return this.plan.list(await this.spaces.authorizePersonal(a), 'budget', q);
  }
  @Get('budgets/:id') async getbudget(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.get(await this.spaces.authorizePersonal(a), 'budget', id),
    );
  }
  @Patch('budgets/:id') async updateBudget(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.FinanceBudgetPatchSchema))
    b: z.infer<typeof c.FinanceBudgetPatchSchema>,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.updateBudget(
        await this.spaces.authorizePersonal(a),
        id,
        required(tag),
        b,
      ),
    );
  }
  @Delete('budgets/:id') async archivebudget(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.EmptyQuerySchema.optional())) _b: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.updateBudget(
        await this.spaces.authorizePersonal(a),
        id,
        required(tag),
        { archived: true },
      ),
    );
  }
  @Post('bills') async createBill(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.FinanceBillCreateSchema))
    b: z.infer<typeof c.FinanceBillCreateSchema>,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.createBill(await this.spaces.authorizePersonal(a), k, b),
    );
  }
  @Get('bills') async listbill(
    @CurrentActor() a: RequestActor,
    @Query(query) q: c.FinanceQuery,
  ) {
    return this.plan.list(await this.spaces.authorizePersonal(a), 'bill', q);
  }
  @Get('bills/:id') async getbill(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.get(await this.spaces.authorizePersonal(a), 'bill', id),
    );
  }
  @Patch('bills/:id') async updateBill(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.FinanceBillPatchSchema))
    b: z.infer<typeof c.FinanceBillPatchSchema>,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.updateBill(
        await this.spaces.authorizePersonal(a),
        id,
        required(tag),
        b,
      ),
    );
  }
  @Get('bills/:id/history') async historybill(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(query) q: c.FinanceQuery,
  ) {
    return this.plan.versions(
      await this.spaces.authorizePersonal(a),
      'bill',
      id,
      q,
    );
  }
  @Post('savings-goals') async createSavings(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.FinanceSavingsCreateSchema))
    b: z.infer<typeof c.FinanceSavingsCreateSchema>,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.createSavings(
        await this.spaces.authorizePersonal(a),
        k,
        b,
      ),
    );
  }
  @Get('savings-goals') async listsavings(
    @CurrentActor() a: RequestActor,
    @Query(query) q: c.FinanceQuery,
  ) {
    return this.plan.list(await this.spaces.authorizePersonal(a), 'savings', q);
  }
  @Get('savings-goals/:id') async getsavings(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.get(
        await this.spaces.authorizePersonal(a),
        'savings',
        id,
      ),
    );
  }
  @Patch('savings-goals/:id') async updateSavings(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.FinanceSavingsPatchSchema))
    b: z.infer<typeof c.FinanceSavingsPatchSchema>,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.updateSavings(
        await this.spaces.authorizePersonal(a),
        id,
        required(tag),
        b,
      ),
    );
  }
  @Delete('savings-goals/:id') async archivesavings(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.EmptyQuerySchema.optional())) _b: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.updateSavings(
        await this.spaces.authorizePersonal(a),
        id,
        required(tag),
        { archived: true },
      ),
    );
  }
  @Get('savings-goals/:id/history') async historysavings(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(query) q: c.FinanceQuery,
  ) {
    return this.plan.versions(
      await this.spaces.authorizePersonal(a),
      'savings',
      id,
      q,
    );
  }

  @Post('transactions/from-capture') async draft(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.FinanceCapturePostSchema))
    b: z.infer<typeof c.FinanceCapturePostSchema>,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.ledger.fromCapture(
        await this.spaces.authorizePersonal(a),
        k,
        b,
      ),
    );
  }
  @Post('transactions') async post(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.FinanceSingleCreateSchema))
    b: z.infer<typeof c.FinanceSingleCreateSchema>,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.ledger.post(await this.spaces.authorizePersonal(a), k, b),
    );
  }
  @Post('transfers') async transfer(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.FinanceTransferCreateSchema))
    b: z.infer<typeof c.FinanceTransferCreateSchema>,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.ledger.post(await this.spaces.authorizePersonal(a), k, b),
    );
  }
  @Get('transactions') async transactions(
    @CurrentActor() a: RequestActor,
    @Query(query) q: c.FinanceQuery,
  ) {
    return this.plan.list(
      await this.spaces.authorizePersonal(a),
      'transaction',
      q,
    );
  }
  @Get('transactions/:id') async transaction(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.get(
        await this.spaces.authorizePersonal(a),
        'transaction',
        id,
      ),
    );
  }
  @Get('transactions/:id/history') async history(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(query) q: c.FinanceQuery,
  ) {
    return this.plan.history(await this.spaces.authorizePersonal(a), id, q);
  }
  @Post('transactions/:id/reverse') @HttpCode(200) async reverse(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.EmptyQuerySchema)) _b: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.ledger.reverse(
        await this.spaces.authorizePersonal(a),
        id,
        required(tag),
        k,
      ),
    );
  }
  @Post('transactions/:id/correct') @HttpCode(200) async correct(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.FinanceCorrectionSchema))
    b: z.infer<typeof c.FinanceCorrectionSchema>,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.ledger.correct(
        await this.spaces.authorizePersonal(a),
        id,
        required(tag),
        k,
        b,
      ),
    );
  }
  @Post('budgets/:id/periods') async period(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.FinancePeriodCreateSchema))
    b: z.infer<typeof c.FinancePeriodCreateSchema>,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.createPeriod(
        await this.spaces.authorizePersonal(a),
        id,
        required(tag),
        k,
        b,
      ),
    );
  }
  @Get('budgets/:id/periods') async periods(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(query) q: c.FinanceQuery,
  ) {
    return this.plan.periods(await this.spaces.authorizePersonal(a), id, q);
  }
  @Patch('budgets/:id/periods/:periodId') async patchPeriod(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Param('periodId', idPipe) periodId: string,
    @Body(new ZodValidationPipe(c.FinancePeriodPatchSchema))
    b: z.infer<typeof c.FinancePeriodPatchSchema>,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.updatePeriod(
        await this.spaces.authorizePersonal(a),
        id,
        periodId,
        required(tag),
        b,
      ),
    );
  }
  @Get('bills/:id/preview') async preview(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(c.FinanceBillPreviewQuerySchema))
    q: z.infer<typeof c.FinanceBillPreviewQuerySchema>,
  ) {
    return this.plan.preview(await this.spaces.authorizePersonal(a), id, q);
  }
  @Post('bills/:id/pay') @HttpCode(200) async pay(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.FinanceBillPostSchema))
    b: z.infer<typeof c.FinanceBillPostSchema>,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.plan.payBill(
        await this.spaces.authorizePersonal(a),
        id,
        required(tag),
        k,
        b,
      ),
    );
  }
  @Get('reports') async report(
    @CurrentActor() a: RequestActor,
    @Query(new ZodValidationPipe(c.FinanceReportQuerySchema))
    q: c.FinanceReportQuery,
  ) {
    return this.reports.report(await this.spaces.authorizePersonal(a), q);
  }
  @Get('export') async export(
    @CurrentActor() a: RequestActor,
    @Query(new ZodValidationPipe(c.FinanceExportQuerySchema))
    q: z.infer<typeof c.FinanceExportQuerySchema>,
    @Res() res: Response,
  ) {
    const { format, ...filter } = q,
      v = await this.reports.export(
        await this.spaces.authorizePersonal(a),
        filter,
      );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="personal-finance.' + format + '"',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Type',
      format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/json; charset=utf-8',
    );
    const write = async (s: string) => {
      if (res.destroyed) throw new Error('Export response closed');
      if (res.write(s)) return;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          res.off('drain', drained);
          res.off('close', closed);
          res.off('error', closed);
        };
        const drained = () => {
          cleanup();
          resolve();
        };
        const closed = () => {
          cleanup();
          reject(new Error('Export response closed'));
        };
        res.once('drain', drained);
        res.once('close', closed);
        res.once('error', closed);
        if (res.destroyed) closed();
      });
    };
    if (format === 'json') {
      await write(
        JSON.stringify({ ...v, transactions: undefined }).slice(0, -1) +
          ',"transactions":[',
      );
      for (let i = 0; i < v.transactions.length; i++)
        await write((i ? ',' : '') + JSON.stringify(v.transactions[i]));
      await write(']}');
    } else {
      await write(
        'transactionId,type,effect,occurredAt,localDate,timezone,accountId,currency,amount,role,note\r\n',
      );
      for (const t of v.transactions)
        for (const p of t.postings)
          await write(
            [
              t.id,
              t.type,
              t.effect,
              t.occurredAt,
              t.localDate,
              t.timezone,
              p.accountId,
              p.currency,
              p.amount,
              p.role,
              t.note ?? '',
            ]
              .map((v, i) =>
                i === 10 ? csvText(v) : '"' + v.replaceAll('"', '""') + '"',
              )
              .join(',') + '\r\n',
          );
    }
    res.end();
  }
}
