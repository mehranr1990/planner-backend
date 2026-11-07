import {
  Controller,
  Get,
  Post,
  Patch,
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
import { CompanyFinancialApprovalsService } from '../application/company-financial-approvals.service.js';
import { CompanyReimbursementsService } from '../application/company-reimbursements.service.js';
const uuid = new ZodValidationPipe(c.CompanyCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.CollaborationEmptySchema);
function rev(raw: string | undefined) {
  const n = expectedRevision(raw);
  if (n === undefined) throw new BadRequestException();
  return n;
}
@Controller('companies/:id/contexts/:scopeId')
@UseGuards(VerifiedSessionGuard, CompanyGuard)
export class CompanySettlementsController {
  constructor(
    @Inject(CompanyFinancialApprovalsService)
    private readonly flows: CompanyFinancialApprovalsService,
    @Inject(CompanyReimbursementsService)
    private readonly reimbursements: CompanyReimbursementsService,
  ) {}
  @Post('finance/approval-workflows') async workflowCreate(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyFinancialWorkflowCreateSchema))
    body: z.infer<typeof c.CompanyFinancialWorkflowCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyFinancialWorkflowSchema.strip().parse(
      await this.flows.workflowCreate(actor, id, scopeId, body, key),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('finance/approval-workflows') async workflows(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanySettlementPageQuerySchema))
    query: z.infer<typeof c.CompanySettlementPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyFinancialWorkflowPageSchema.strip().parse(
      await this.flows.workflows(actor, id, scopeId, query),
    );
    void res;
    return value;
  }
  @Get('finance/approval-workflows/:target') async workflow(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyFinancialWorkflowSchema.strip().parse(
      await this.flows.workflow(actor, id, scopeId, target),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('finance/approval-workflows/:target/versions') async versionCreate(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyFinancialWorkflowVersionCreateSchema))
    body: z.infer<typeof c.CompanyFinancialWorkflowVersionCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyFinancialWorkflowVersionSchema.strip().parse(
      await this.flows.versionCreate(actor, id, scopeId, target, body, key),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('finance/approval-workflows/:target/versions') async versions(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(new ZodValidationPipe(c.CompanySettlementPageQuerySchema))
    query: z.infer<typeof c.CompanySettlementPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyFinancialWorkflowVersionPageSchema.strip().parse(
      await this.flows.versions(actor, id, scopeId, target, query),
    );
    void res;
    return value;
  }
  @Get('finance/approval-workflow-versions/:target') async version(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyFinancialWorkflowVersionSchema.strip().parse(
      await this.flows.version(actor, id, scopeId, target),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Patch('finance/approval-workflow-versions/:target') async versionPatch(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyFinancialWorkflowVersionInputSchema))
    body: z.infer<typeof c.CompanyFinancialWorkflowVersionInputSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyFinancialWorkflowVersionSchema.strip().parse(
      await this.flows.versionPatch(
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
  @Post('finance/approval-workflow-versions/:target/publish')
  @HttpCode(200)
  async publish(
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
    const value = c.CompanyFinancialWorkflowVersionSchema.strip().parse(
      await this.flows.versionState(
        actor,
        id,
        scopeId,
        target,
        rev(match),
        true,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('finance/approval-workflow-versions/:target/archive')
  @HttpCode(200)
  async archive(
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
    const value = c.CompanyFinancialWorkflowVersionSchema.strip().parse(
      await this.flows.versionState(
        actor,
        id,
        scopeId,
        target,
        rev(match),
        false,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('expenses/:target/workflow-submit') @HttpCode(200) async expenseSubmit(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyFinancialWorkflowBindSchema))
    body: z.infer<typeof c.CompanyFinancialWorkflowBindSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyFinancialApprovalSchema.strip().parse(
      await this.flows.expenseSubmit(
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
  @Post('reimbursements/:target/submit')
  @HttpCode(200)
  async reimbursementSubmit(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyFinancialWorkflowBindSchema))
    body: z.infer<typeof c.CompanyFinancialWorkflowBindSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyFinancialApprovalSchema.strip().parse(
      await this.flows.reimbursementSubmit(
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
  @Get('finance/approvals') async approvals(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanySettlementPageQuerySchema))
    query: z.infer<typeof c.CompanySettlementPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyFinancialApprovalPageSchema.strip().parse(
      await this.flows.approvals(actor, id, scopeId, query),
    );
    void res;
    return value;
  }
  @Get('finance/approvals/:target') async approval(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyFinancialApprovalSchema.strip().parse(
      await this.flows.approval(actor, id, scopeId, target),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('finance/approvals/:target/history') async events(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(new ZodValidationPipe(c.CompanySettlementPageQuerySchema))
    query: z.infer<typeof c.CompanySettlementPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyFinancialApprovalEventPageSchema.strip().parse(
      await this.flows.events(actor, id, scopeId, target, query),
    );
    void res;
    return value;
  }
  @Post('finance/approvals/:target/decision') @HttpCode(200) async decision(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyFinancialApprovalDecisionSchema))
    body: z.infer<typeof c.CompanyFinancialApprovalDecisionSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyFinancialApprovalSchema.strip().parse(
      await this.flows.decision(actor, id, scopeId, target, rev(match), body),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('finance/approvals/:target/escalate') @HttpCode(200) async escalate(
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
    const value = c.CompanyFinancialApprovalSchema.strip().parse(
      await this.flows.escalate(actor, id, scopeId, target, rev(match)),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('finance/approvals/:target/restart') @HttpCode(200) async restart(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyFinancialWorkflowBindSchema))
    body: z.infer<typeof c.CompanyFinancialWorkflowBindSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyFinancialApprovalSchema.strip().parse(
      await this.flows.restart(actor, id, scopeId, target, rev(match), body),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('reimbursements') async create(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyReimbursementCreateSchema))
    body: z.infer<typeof c.CompanyReimbursementCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyReimbursementSchema.strip().parse(
      await this.reimbursements.create(actor, id, scopeId, body, key),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('reimbursements') async list(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanySettlementPageQuerySchema))
    query: z.infer<typeof c.CompanySettlementPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyReimbursementPageSchema.strip().parse(
      await this.reimbursements.list(actor, id, scopeId, query),
    );
    void res;
    return value;
  }
  @Get('reimbursements/:target') async read(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyReimbursementSchema.strip().parse(
      await this.reimbursements.read(actor, id, scopeId, target),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Patch('reimbursements/:target') async patch(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyReimbursementPatchSchema))
    body: z.infer<typeof c.CompanyReimbursementPatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyReimbursementSchema.strip().parse(
      await this.reimbursements.patch(
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
  @Post('reimbursements/:target/cancel') @HttpCode(200) async cancel(
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
    const value = c.CompanyReimbursementSchema.strip().parse(
      await this.reimbursements.cancel(actor, id, scopeId, target, rev(match)),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('reimbursements/:target/close') @HttpCode(200) async close(
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
    const value = c.CompanyReimbursementSchema.strip().parse(
      await this.reimbursements.close(actor, id, scopeId, target, rev(match)),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('reimbursements/:target/history') async history(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(new ZodValidationPipe(c.CompanySettlementPageQuerySchema))
    query: z.infer<typeof c.CompanySettlementPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyReimbursementEffectPageSchema.strip().parse(
      await this.reimbursements.history(actor, id, scopeId, target, query),
    );
    void res;
    return value;
  }
  @Get('expenses/:target/reimbursement-balances') async balances(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(new ZodValidationPipe(c.CompanySettlementPageQuerySchema))
    query: z.infer<typeof c.CompanySettlementPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyReimbursementBalancePageSchema.strip().parse(
      await this.reimbursements.balances(actor, id, scopeId, target, query),
    );
    void res;
    return value;
  }
  @Post('reimbursements/:target/payment-acknowledgements') async proposePayment(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyPaymentAcknowledgementCreateSchema))
    body: z.infer<typeof c.CompanyPaymentAcknowledgementCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyPaymentAcknowledgementSchema.strip().parse(
      await this.reimbursements.proposePayment(
        actor,
        id,
        scopeId,
        target,
        body,
        key,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('reimbursements/:target/payment-acknowledgements') async payments(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(new ZodValidationPipe(c.CompanySettlementPageQuerySchema))
    query: z.infer<typeof c.CompanySettlementPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyPaymentAcknowledgementPageSchema.strip().parse(
      await this.reimbursements.payments(actor, id, scopeId, target, query),
    );
    void res;
    return value;
  }
  @Get('payment-acknowledgements/:target') async payment(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyPaymentAcknowledgementSchema.strip().parse(
      await this.reimbursements.payment(actor, id, scopeId, target),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('payment-acknowledgements/:target/decision')
  @HttpCode(200)
  async paymentDecision(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyPaymentAcknowledgementDecisionSchema))
    body: z.infer<typeof c.CompanyPaymentAcknowledgementDecisionSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyPaymentAcknowledgementSchema.strip().parse(
      await this.reimbursements.paymentDecision(
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
  @Post('payment-acknowledgements/:target/cancel')
  @HttpCode(200)
  async paymentCancel(
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
    const value = c.CompanyPaymentAcknowledgementSchema.strip().parse(
      await this.reimbursements.paymentDecision(
        actor,
        id,
        scopeId,
        target,
        rev(match),
        null,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('payment-acknowledgements/:target/corrections') async proposeCorrection(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyAcknowledgementCorrectionCreateSchema))
    body: z.infer<typeof c.CompanyAcknowledgementCorrectionCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyAcknowledgementCorrectionSchema.strip().parse(
      await this.reimbursements.proposeCorrection(
        actor,
        id,
        scopeId,
        target,
        body,
        key,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('payment-acknowledgements/:target/corrections') async corrections(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(new ZodValidationPipe(c.CompanySettlementPageQuerySchema))
    query: z.infer<typeof c.CompanySettlementPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyAcknowledgementCorrectionPageSchema.strip().parse(
      await this.reimbursements.corrections(actor, id, scopeId, target, query),
    );
    void res;
    return value;
  }
  @Post('acknowledgement-corrections/:target/decision')
  @HttpCode(200)
  async correctionDecision(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _query: unknown,
    @Body(
      new ZodValidationPipe(c.CompanyAcknowledgementCorrectionDecisionSchema),
    )
    body: z.infer<typeof c.CompanyAcknowledgementCorrectionDecisionSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyAcknowledgementCorrectionSchema.strip().parse(
      await this.reimbursements.correctionDecision(
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
  @Post('acknowledgement-corrections/:target/cancel')
  @HttpCode(200)
  async correctionCancel(
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
    const value = c.CompanyAcknowledgementCorrectionSchema.strip().parse(
      await this.reimbursements.correctionDecision(
        actor,
        id,
        scopeId,
        target,
        rev(match),
        null,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
}
