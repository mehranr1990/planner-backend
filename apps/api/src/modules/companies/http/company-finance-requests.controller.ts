import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Headers,
  Res,
  Inject,
  UseGuards,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import type { Response } from 'express';
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
import { CompanyGuard } from './companies.controller.js';
import { CompanyFinanceRequestsService } from '../application/company-finance-requests.service.js';
const uuid = new ZodValidationPipe(c.CompanyCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.BackendCompletionEmptySchema),
  page = new ZodValidationPipe(c.ProjectPageQuerySchema);
type Page = z.infer<typeof c.ProjectPageQuerySchema>;
function rev(v: string | undefined) {
  const n = expectedRevision(v);
  if (n === undefined) throw new BadRequestException();
  return n;
}
function tagged<T extends { revision: number }>(res: Response, value: T) {
  res.setHeader('ETag', revisionTag(value.revision));
  return value;
}
/** ER review history and BU budget change requests (owner-approved 2026-11-13). */
@Controller('companies/:id/contexts/:scopeId')
@UseGuards(VerifiedSessionGuard, CompanyGuard)
export class CompanyFinanceRequestsController {
  constructor(
    @Inject(CompanyFinanceRequestsService)
    private readonly requests: CompanyFinanceRequestsService,
  ) {}
  @Get('expenses/:expenseId/review-history') async reviewHistory(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('expenseId', uuid) expenseId: string,
    @Query(page) q: Page,
  ) {
    return c.CompanyExpenseReviewPageSchema.strip().parse(
      await this.requests.reviewHistory(actor, id, scopeId, expenseId, q),
    );
  }
  @Get('finance/budgets/:budgetId/change-requests') async list(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('budgetId', uuid) budgetId: string,
    @Query(page) q: Page,
  ) {
    return c.CompanyBudgetChangeRequestPageSchema.strip().parse(
      await this.requests.list(actor, id, scopeId, budgetId, q),
    );
  }
  @Post('finance/budgets/:budgetId/change-requests') async create(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('budgetId', uuid) budgetId: string,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(c.CompanyBudgetChangeRequestCreateSchema))
    body: z.infer<typeof c.CompanyBudgetChangeRequestCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyBudgetChangeRequestSchema.strip().parse(
        await this.requests.create(actor, id, scopeId, budgetId, body, key),
      ),
    );
  }
  @Get('finance/budget-change-requests/:requestId') async get(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('requestId', uuid) requestId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyBudgetChangeRequestSchema.strip().parse(
        await this.requests.get(actor, id, scopeId, requestId),
      ),
    );
  }
  @Post('finance/budget-change-requests/:requestId/decision')
  @HttpCode(200)
  async decide(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('requestId', uuid) requestId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(new ZodValidationPipe(c.CompanyBudgetChangeDecisionSchema))
    body: z.infer<typeof c.CompanyBudgetChangeDecisionSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyBudgetChangeRequestSchema.strip().parse(
        await this.requests.decide(
          actor,
          id,
          scopeId,
          requestId,
          rev(match),
          body,
        ),
      ),
    );
  }
  @Post('finance/budget-change-requests/:requestId/withdraw')
  @HttpCode(200)
  async withdraw(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('requestId', uuid) requestId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(empty) _b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyBudgetChangeRequestSchema.strip().parse(
        await this.requests.withdraw(actor, id, scopeId, requestId, rev(match)),
      ),
    );
  }
}
