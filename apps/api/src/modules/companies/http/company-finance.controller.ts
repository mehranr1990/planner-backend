import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Body,
  Query,
  Param,
  Headers,
  Res,
  Req,
  Inject,
  UseGuards,
  BadRequestException,
  HttpCode,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';
import { FileThrottleGuard } from '../../../platform/storage/public/index.js';
import { Throttle } from '@nestjs/throttler';
import { CompanyGuard } from './companies.controller.js';
import { CompanyFinanceService } from '../application/company-finance.service.js';
import { CompanyReceiptService } from '../application/company-receipt.service.js';
const uuid = new ZodValidationPipe(c.CompanyCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.CollaborationEmptySchema);
function rev(v: string | undefined) {
  const n = expectedRevision(v);
  if (n === undefined) throw new BadRequestException();
  return n;
}
@Controller('companies/:id/contexts/:scopeId')
@UseGuards(VerifiedSessionGuard, CompanyGuard)
export class CompanyFinanceController {
  constructor(
    @Inject(CompanyFinanceService)
    private readonly finance: CompanyFinanceService,
    @Inject(CompanyReceiptService)
    private readonly receipts: CompanyReceiptService,
  ) {}
  @Post('finance/categories')
  async categoryCreate(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyExpenseCategoryCreateSchema))
    body: z.infer<typeof c.CompanyExpenseCategoryCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyExpenseCategorySchema.strip().parse(
      await this.finance.categoryCreate(actor, id, scopeId, body, key),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('finance/categories')
  async categories(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyFinancePageQuerySchema))
    query: z.infer<typeof c.CompanyFinancePageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyExpenseCategoryPageSchema.strip().parse(
      await this.finance.categories(actor, id, scopeId, query),
    );
    void res;
    return value;
  }
  @Patch('finance/categories/:target')
  async categoryPatch(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyExpenseCategoryPatchSchema))
    body: z.infer<typeof c.CompanyExpenseCategoryPatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyExpenseCategorySchema.strip().parse(
      await this.finance.categoryPatch(
        actor,
        id,
        scopeId,
        target,
        rev(match),
        body,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('finance/project-references')
  async referenceCreate(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyFinanceProjectCreateSchema))
    body: z.infer<typeof c.CompanyFinanceProjectCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyFinanceProjectSchema.strip().parse(
      await this.finance.referenceCreate(actor, id, scopeId, body, key),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('finance/project-references')
  async references(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyFinancePageQuerySchema))
    query: z.infer<typeof c.CompanyFinancePageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyFinanceProjectPageSchema.strip().parse(
      await this.finance.references(actor, id, scopeId, query),
    );
    void res;
    return value;
  }
  @Post('finance/budgets')
  async budgetCreate(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyBudgetCreateSchema))
    body: z.infer<typeof c.CompanyBudgetCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyBudgetSchema.strip().parse(
      await this.finance.budgetCreate(actor, id, scopeId, body, key),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('finance/budgets')
  async budgets(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyFinancePageQuerySchema))
    query: z.infer<typeof c.CompanyFinancePageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyBudgetPageSchema.strip().parse(
      await this.finance.budgets(actor, id, scopeId, query),
    );
    void res;
    return value;
  }
  @Get('finance/budgets/:target')
  async budget(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyBudgetSchema.strip().parse(
      await this.finance.budget(actor, id, scopeId, target),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('finance/budgets/:target/adjustments')
  @HttpCode(200)
  async budgetChange(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyBudgetChangeSchema))
    body: z.infer<typeof c.CompanyBudgetChangeSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyBudgetSchema.strip().parse(
      await this.finance.budgetChange(
        actor,
        id,
        scopeId,
        target,
        rev(match),
        body,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Patch('finance/budgets/:target/archive')
  async budgetArchive(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyBudgetArchiveSchema))
    body: z.infer<typeof c.CompanyBudgetArchiveSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyBudgetSchema.strip().parse(
      await this.finance.budgetChange(
        actor,
        id,
        scopeId,
        target,
        rev(match),
        body,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('finance/budgets/:budgetId/commitments')
  async commitmentCreate(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('budgetId', uuid) budgetId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyCommitmentCreateSchema))
    body: z.infer<typeof c.CompanyCommitmentCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyCommitmentSchema.strip().parse(
      await this.finance.commitmentCreate(
        actor,
        id,
        scopeId,
        budgetId,
        body,
        key,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('finance/budgets/:budgetId/commitments')
  async commitments(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('budgetId', uuid) budgetId: string,
    @Query(new ZodValidationPipe(c.CompanyFinancePageQuerySchema))
    query: z.infer<typeof c.CompanyFinancePageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyCommitmentPageSchema.strip().parse(
      await this.finance.commitments(actor, id, scopeId, budgetId, query),
    );
    void res;
    return value;
  }
  @Post('finance/commitments/:target/release')
  @HttpCode(200)
  async commitmentRelease(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CollaborationEmptySchema))
    body: z.infer<typeof c.CollaborationEmptySchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    void body;
    const value = c.CompanyCommitmentSchema.strip().parse(
      await this.finance.commitmentRelease(
        actor,
        id,
        scopeId,
        target,
        rev(match),
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('expenses')
  async expenseCreate(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyExpenseCreateSchema))
    body: z.infer<typeof c.CompanyExpenseCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyExpenseSchema.strip().parse(
      await this.finance.expenseCreate(actor, id, scopeId, body, key),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('expenses')
  async expenses(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyFinancePageQuerySchema))
    query: z.infer<typeof c.CompanyFinancePageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyExpensePageSchema.strip().parse(
      await this.finance.expenses(actor, id, scopeId, query),
    );
    void res;
    return value;
  }
  @Get('expenses/:target')
  async expense(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyExpenseSchema.strip().parse(
      await this.finance.expense(actor, id, scopeId, target),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Patch('expenses/:target')
  async expensePatch(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyExpenseFactsSchema))
    body: z.infer<typeof c.CompanyExpenseFactsSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyExpenseSchema.strip().parse(
      await this.finance.expensePatch(
        actor,
        id,
        scopeId,
        target,
        rev(match),
        body,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('expenses/:target/submit')
  @HttpCode(200)
  async submit(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyExpenseSubmitSchema))
    body: z.infer<typeof c.CompanyExpenseSubmitSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyExpenseSchema.strip().parse(
      await this.finance.submit(actor, id, scopeId, target, rev(match), body),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Put('expenses/:target/reviewer')
  async reassign(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyExpenseSubmitSchema))
    body: z.infer<typeof c.CompanyExpenseSubmitSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyExpenseSchema.strip().parse(
      await this.finance.submit(
        actor,
        id,
        scopeId,
        target,
        rev(match),
        body,
        true,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('expenses/:target/decision')
  @HttpCode(200)
  async decide(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyExpenseDecisionSchema))
    body: z.infer<typeof c.CompanyExpenseDecisionSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyExpenseSchema.strip().parse(
      await this.finance.decide(actor, id, scopeId, target, rev(match), body),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('expenses/:target/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CollaborationEmptySchema))
    body: z.infer<typeof c.CollaborationEmptySchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    void body;
    const value = c.CompanyExpenseSchema.strip().parse(
      await this.finance.cancel(actor, id, scopeId, target, rev(match)),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('expenses/:target/corrections')
  async correction(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyExpenseFactsSchema))
    body: z.infer<typeof c.CompanyExpenseFactsSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyExpenseSchema.strip().parse(
      await this.finance.correction(
        actor,
        id,
        scopeId,
        target,
        rev(match),
        body,
        key,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('expenses/:target/reversals')
  async reversal(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CollaborationEmptySchema))
    body: z.infer<typeof c.CollaborationEmptySchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    void body;
    const value = c.CompanyExpenseSchema.strip().parse(
      await this.finance.correction(
        actor,
        id,
        scopeId,
        target,
        rev(match),
        null,
        key,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('expenses/:target/revisions')
  async revisions(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(new ZodValidationPipe(c.CompanyFinancePageQuerySchema))
    query: z.infer<typeof c.CompanyFinancePageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyExpenseRevisionPageSchema.strip().parse(
      await this.finance.revisions(actor, id, scopeId, target, query),
    );
    void res;
    return value;
  }
  @Post('expenses/:expenseId/revisions/:versionId/receipts')
  @UseGuards(FileThrottleGuard)
  @Throttle({ files: { limit: 10, ttl: 60000 } })
  async initiate(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('expenseId', uuid) expenseId: string,
    @Param('versionId', uuid) versionId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyExpenseReceiptCreateSchema))
    body: z.infer<typeof c.CompanyExpenseReceiptCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyExpenseReceiptSchema.strip().parse(
      await this.receipts.initiate(
        actor,
        id,
        scopeId,
        expenseId,
        versionId,
        body,
        key,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('expenses/:expenseId/revisions/:versionId/receipts')
  @UseGuards(FileThrottleGuard)
  @Throttle({ files: { limit: 10, ttl: 60000 } })
  async list(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('expenseId', uuid) expenseId: string,
    @Param('versionId', uuid) versionId: string,
    @Query(new ZodValidationPipe(c.CompanyFinancePageQuerySchema))
    query: z.infer<typeof c.CompanyFinancePageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyExpenseReceiptPageSchema.strip().parse(
      await this.receipts.list(actor, id, scopeId, expenseId, versionId, query),
    );
    void res;
    return value;
  }
  @Post('expenses/:expenseId/revisions/:versionId/receipts/:receiptId/remove')
  @HttpCode(200)
  @UseGuards(FileThrottleGuard)
  @Throttle({ files: { limit: 10, ttl: 60000 } })
  async remove(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('expenseId', uuid) expenseId: string,
    @Param('versionId', uuid) versionId: string,
    @Param('receiptId', uuid) receiptId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CollaborationEmptySchema))
    body: z.infer<typeof c.CollaborationEmptySchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    void body;
    const value = c.CompanyExpenseReceiptSchema.strip().parse(
      await this.receipts.remove(
        actor,
        id,
        scopeId,
        expenseId,
        versionId,
        receiptId,
        rev(match),
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('finance/receipts/reconcile')
  @HttpCode(200)
  @UseGuards(FileThrottleGuard)
  @Throttle({ files: { limit: 10, ttl: 60000 } })
  async reconcile(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CollaborationEmptySchema))
    body: z.infer<typeof c.CollaborationEmptySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    void body;
    const value = c.CompanyReceiptCleanupSchema.strip().parse(
      await this.receipts.reconcile(actor, id, scopeId),
    );
    void res;
    return value;
  }
  @Post('expenses/:expenseId/revisions/:versionId/receipts/:receiptId/complete')
  @HttpCode(200)
  @UseGuards(FileThrottleGuard)
  @Throttle({ files: { limit: 10, ttl: 60000 } })
  async complete(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('expenseId', uuid) expenseId: string,
    @Param('versionId', uuid) versionId: string,
    @Param('receiptId', uuid) receiptId: string,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!req.is('application/octet-stream'))
      throw new UnsupportedMediaTypeException();
    try {
      const v = c.CompanyExpenseReceiptSchema.parse(
        await this.receipts.complete(
          actor,
          id,
          scopeId,
          expenseId,
          versionId,
          receiptId,
          rev(match),
          req,
          req.headers['content-length'],
        ),
      );
      res.setHeader('ETag', revisionTag(v.revision));
      return v;
    } catch (e) {
      res.setHeader('Connection', 'close');
      req.resume();
      throw e;
    }
  }
  @Get('expenses/:expenseId/revisions/:versionId/receipts/:receiptId/download')
  @UseGuards(FileThrottleGuard)
  async download(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('expenseId', uuid) expenseId: string,
    @Param('versionId', uuid) versionId: string,
    @Param('receiptId', uuid) receiptId: string,
    @Query(empty) _q: unknown,
    @Res() res: Response,
  ) {
    const { file, stream } = await this.receipts.download(
      actor,
      id,
      scopeId,
      expenseId,
      versionId,
      receiptId,
    );
    const name = encodeURIComponent(file.filename).replace(
      /[!'()*]/g,
      (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase(),
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', file.actualSize!);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="download"; filename*=UTF-8''${name}`,
    );
    try {
      await pipeline(stream, res);
    } catch {
      res.destroy();
    }
  }
}
