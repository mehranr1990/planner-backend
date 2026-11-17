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
  HttpCode,
  BadRequestException,
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
import { CompanyAccess } from '../../spaces/public/index.js';
import { CompanyAssetsService } from '../application/company-assets.service.js';
import { CompanyPerformanceService } from '../application/company-performance.service.js';
import { CompanyGapQueriesService } from '../application/company-gap-queries.service.js';
import { CompanyAccessGovernanceService } from '../application/company-access-governance.service.js';
import { CompanyApprovalPoliciesService } from '../application/company-approval-policies.service.js';
import { CompanyFinancialApprovalsService } from '../application/company-financial-approvals.service.js';
import { CompanyBudgetAlertsService } from '../application/company-budget-alerts.service.js';
const uuid = new ZodValidationPipe(c.CompanyCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.CollaborationEmptySchema);
function requireKey(v: string | undefined) {
  if (!v) throw new BadRequestException();
  return v;
}
function rev(v: string | undefined) {
  const n = expectedRevision(v);
  if (n === undefined) throw new BadRequestException();
  return n;
}
@Controller('companies/:id')
@UseGuards(VerifiedSessionGuard, CompanyGuard)
export class CompanyGapClosureController {
  constructor(
    @Inject(CompanyAssetsService) private readonly assets: CompanyAssetsService,
    @Inject(CompanyPerformanceService)
    private readonly performance: CompanyPerformanceService,
    @Inject(CompanyGapQueriesService)
    private readonly queries: CompanyGapQueriesService,
    @Inject(CompanyAccessGovernanceService)
    private readonly governance: CompanyAccessGovernanceService,
    @Inject(CompanyApprovalPoliciesService)
    private readonly policies: CompanyApprovalPoliciesService,
    @Inject(CompanyFinancialApprovalsService)
    private readonly approvals: CompanyFinancialApprovalsService,
    @Inject(CompanyBudgetAlertsService)
    private readonly alerts: CompanyBudgetAlertsService,
    @Inject(CompanyAccess) private readonly access: CompanyAccess,
  ) {}
  @Get('organization-chart') async operation0(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyOrganizationChartSchema.strip().parse(
      await this.queries.chart(a, id),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('department-transfers/history') async operation1(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyTransferHistoryPageSchema.strip().parse(
      await this.queries.transfers(a, id, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/reports/department-analytics') async operation2(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyObservationRangeSchema))
    q: z.infer<typeof c.CompanyObservationRangeSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyDepartmentAnalyticsSchema.strip().parse(
      await this.queries.analytics(a, id, scopeId, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('recovery-cases') async operation3(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyRecoveryCasePageSchema.strip().parse(
      await this.governance.recoveries(a, id, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('recovery-cases') @HttpCode(200) async operation4(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyRecoveryCaseInputSchema))
    body: z.infer<typeof c.CompanyRecoveryCaseInputSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyRecoveryCaseSchema.strip().parse(
      await this.governance.recovery(a, id, body, key),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('retention/readiness') async operation5(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyRetentionReadinessSchema.strip().parse(
      await this.access.retentionReadiness(a, id),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('ownership-handovers') async operation6(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyOwnerHandoverPageSchema.strip().parse(
      await this.governance.handovers(a, id, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/sent-invitations') async operation7(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanySentInvitationPageSchema.strip().parse(
      await this.access.sentDetails(a, id, scopeId, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/invitations/:offerId/resend')
  @HttpCode(200)
  async operation8(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('offerId', uuid) offerId: string,
    @Query(empty) _q: unknown,
    @Body(
      new ZodValidationPipe(c.CollaborationEmptySchema.optional().default({})),
    )
    _body: z.infer<typeof c.CollaborationEmptySchema>,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyInvitationSchema.strip().parse(
      await this.access.resend(a, id, scopeId, offerId, rev(match), key),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/resources/:resourceId/asset-tag') async operation9(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('resourceId', uuid) resourceId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyAssetTagSchema.strip().parse(
      await this.assets.tag(a, id, scopeId, resourceId),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/resources/:resourceId/asset-tag')
  @HttpCode(200)
  async operation10(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('resourceId', uuid) resourceId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyAssetTagInputSchema))
    body: z.infer<typeof c.CompanyAssetTagInputSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyAssetTagSchema.strip().parse(
      await this.assets.setTag(a, id, scopeId, resourceId, rev(match), body),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/resources/:resourceId/custody') async operation11(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('resourceId', uuid) resourceId: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyCustodyPageSchema.strip().parse(
      await this.assets.custody(a, id, scopeId, resourceId, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/resources/:resourceId/custody')
  @HttpCode(200)
  async operation12(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('resourceId', uuid) resourceId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyCustodyCreateSchema))
    body: z.infer<typeof c.CompanyCustodyCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyCustodySchema.strip().parse(
      await this.assets.assign(a, id, scopeId, resourceId, body, key),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/resources/:resourceId/custody/:custodyId/return')
  @HttpCode(200)
  async operation13(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('resourceId', uuid) resourceId: string,
    @Param('custodyId', uuid) custodyId: string,
    @Query(empty) _q: unknown,
    @Body(
      new ZodValidationPipe(c.CollaborationEmptySchema.optional().default({})),
    )
    _body: z.infer<typeof c.CollaborationEmptySchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyCustodySchema.strip().parse(
      await this.assets.returnAsset(
        a,
        id,
        scopeId,
        resourceId,
        custodyId,
        rev(match),
      ),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/resources/:resourceId/maintenance') async operation14(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('resourceId', uuid) resourceId: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyMaintenancePageSchema.strip().parse(
      await this.assets.maintenance(a, id, scopeId, resourceId, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/resources/:resourceId/maintenance')
  @HttpCode(200)
  async operation15(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('resourceId', uuid) resourceId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyMaintenanceCreateSchema))
    body: z.infer<typeof c.CompanyMaintenanceCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyMaintenanceSchema.strip().parse(
      await this.assets.schedule(a, id, scopeId, resourceId, body, key),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post(
    'contexts/:scopeId/resources/:resourceId/maintenance/:maintenanceId/state',
  )
  @HttpCode(200)
  async operation16(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('resourceId', uuid) resourceId: string,
    @Param('maintenanceId', uuid) maintenanceId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyMaintenanceChangeSchema))
    body: z.infer<typeof c.CompanyMaintenanceChangeSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyMaintenanceSchema.strip().parse(
      await this.assets.changeMaintenance(
        a,
        id,
        scopeId,
        resourceId,
        maintenanceId,
        rev(match),
        body,
      ),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/reports/kpi-observations') async operation17(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyObservationPageQuerySchema))
    q: z.infer<typeof c.CompanyObservationPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyKpiObservationPageSchema.strip().parse(
      await this.performance.observations(a, id, scopeId, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/reports/kpi-observations')
  @HttpCode(200)
  async operation18(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyKpiObservationCreateSchema))
    body: z.infer<typeof c.CompanyKpiObservationCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyKpiObservationSchema.strip().parse(
      await this.performance.recordObservation(a, id, scopeId, body, key),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/review-cycles') async operation19(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyReviewCyclePageSchema.strip().parse(
      await this.performance.cycles(a, id, scopeId, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/review-cycles') @HttpCode(200) async operation20(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyReviewCycleCreateSchema))
    body: z.infer<typeof c.CompanyReviewCycleCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyReviewCycleSchema.strip().parse(
      await this.performance.createCycle(a, id, scopeId, body, key),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/review-cycles/:cycleId/state')
  @HttpCode(200)
  async operation21(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('cycleId', uuid) cycleId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyReviewCycleChangeSchema))
    body: z.infer<typeof c.CompanyReviewCycleChangeSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyReviewCycleSchema.strip().parse(
      await this.performance.changeCycle(
        a,
        id,
        scopeId,
        cycleId,
        rev(match),
        body,
      ),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/review-cycles/:cycleId/assignments')
  @HttpCode(200)
  async operation22(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('cycleId', uuid) cycleId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyReviewAssignmentSchema))
    body: z.infer<typeof c.CompanyReviewAssignmentSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyPerformanceReviewSchema.strip().parse(
      await this.performance.assignReview(a, id, scopeId, cycleId, body, key),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/performance-reviews') async operation23(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyPerformanceReviewPageSchema.strip().parse(
      await this.performance.reviews(a, id, scopeId, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/performance-reviews/:reviewId') async operation24(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('reviewId', uuid) reviewId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyPerformanceReviewSchema.strip().parse(
      await this.performance.reviewRead(a, id, scopeId, reviewId),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/performance-reviews/:reviewId/submit')
  @HttpCode(200)
  async operation25(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('reviewId', uuid) reviewId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyReviewSubmissionSchema))
    body: z.infer<typeof c.CompanyReviewSubmissionSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyPerformanceReviewSchema.strip().parse(
      await this.performance.submitReview(
        a,
        id,
        scopeId,
        reviewId,
        rev(match),
        body,
      ),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/performance-reviews/:reviewId/complete')
  @HttpCode(200)
  async operation26(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('reviewId', uuid) reviewId: string,
    @Query(empty) _q: unknown,
    @Body(
      new ZodValidationPipe(c.CollaborationEmptySchema.optional().default({})),
    )
    _body: z.infer<typeof c.CollaborationEmptySchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyPerformanceReviewSchema.strip().parse(
      await this.performance.completeReview(
        a,
        id,
        scopeId,
        reviewId,
        rev(match),
      ),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/performance-reviews/:reviewId/history')
  async operation27(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('reviewId', uuid) reviewId: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyPrivateRevisionPageSchema.strip().parse(
      await this.performance.reviewHistory(a, id, scopeId, reviewId, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/one-on-ones') async operation28(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyOneOnOnePageSchema.strip().parse(
      await this.performance.oneList(a, id, scopeId, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/one-on-ones') @HttpCode(200) async operation29(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyOneOnOneCreateSchema))
    body: z.infer<typeof c.CompanyOneOnOneCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyOneOnOneSchema.strip().parse(
      await this.performance.createOne(a, id, scopeId, body, key),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/one-on-ones/:recordId') async operation30(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('recordId', uuid) recordId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyOneOnOneSchema.strip().parse(
      await this.performance.readOne(a, id, scopeId, recordId),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/one-on-ones/:recordId/revisions')
  @HttpCode(200)
  async operation31(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('recordId', uuid) recordId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyOneOnOnePatchSchema))
    body: z.infer<typeof c.CompanyOneOnOnePatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyOneOnOneSchema.strip().parse(
      await this.performance.patchOne(
        a,
        id,
        scopeId,
        recordId,
        rev(match),
        body,
      ),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/one-on-ones/:recordId/history') async operation32(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('recordId', uuid) recordId: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyPrivateRevisionPageSchema.strip().parse(
      await this.performance.oneHistory(a, id, scopeId, recordId, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/one-on-ones/:recordId/actions') async operation33(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('recordId', uuid) recordId: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyOneOnOneActionPageSchema.strip().parse(
      await this.performance.actions(a, id, scopeId, recordId, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/one-on-ones/:recordId/actions')
  @HttpCode(200)
  async operation34(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('recordId', uuid) recordId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyOneOnOneActionCreateSchema))
    body: z.infer<typeof c.CompanyOneOnOneActionCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyOneOnOneActionSchema.strip().parse(
      await this.performance.action(a, id, scopeId, recordId, body, key),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/one-on-ones/:recordId/actions/:actionId/state')
  @HttpCode(200)
  async operation35(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('recordId', uuid) recordId: string,
    @Param('actionId', uuid) actionId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyOneOnOneActionChangeSchema))
    body: z.infer<typeof c.CompanyOneOnOneActionChangeSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyOneOnOneActionSchema.strip().parse(
      await this.performance.changeAction(
        a,
        id,
        scopeId,
        recordId,
        actionId,
        rev(match),
        body,
      ),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/custom-roles') async operation36(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyCustomRolePageSchema.strip().parse(
      await this.governance.roles(a, id, scopeId, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/custom-roles') @HttpCode(200) async operation37(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyCustomRoleInputSchema))
    body: z.infer<typeof c.CompanyCustomRoleInputSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyCustomRoleSchema.strip().parse(
      await this.governance.createRole(a, id, scopeId, body, key),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/custom-roles/:roleId/revisions')
  @HttpCode(200)
  async operation38(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('roleId', uuid) roleId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyCustomRolePatchSchema))
    body: z.infer<typeof c.CompanyCustomRolePatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyCustomRoleSchema.strip().parse(
      await this.governance.updateRole(
        a,
        id,
        scopeId,
        roleId,
        rev(match),
        body,
      ),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/custom-roles/:roleId/archive')
  @HttpCode(200)
  async operation39(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('roleId', uuid) roleId: string,
    @Query(empty) _q: unknown,
    @Body(
      new ZodValidationPipe(c.CollaborationEmptySchema.optional().default({})),
    )
    _body: z.infer<typeof c.CollaborationEmptySchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyCustomRoleSchema.strip().parse(
      await this.governance.archiveRole(a, id, scopeId, roleId, rev(match)),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/custom-roles/:roleId/assignments')
  @HttpCode(200)
  async operation40(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('roleId', uuid) roleId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyRoleAssignmentInputSchema))
    body: z.infer<typeof c.CompanyRoleAssignmentInputSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyRoleAssignmentSchema.strip().parse(
      await this.governance.assignRole(a, id, scopeId, roleId, body, key),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/role-assignments/:assignmentId/revoke')
  @HttpCode(200)
  async operation41(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('assignmentId', uuid) assignmentId: string,
    @Query(empty) _q: unknown,
    @Body(
      new ZodValidationPipe(c.CollaborationEmptySchema.optional().default({})),
    )
    _body: z.infer<typeof c.CollaborationEmptySchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyRoleAssignmentSchema.strip().parse(
      await this.governance.revokeRole(
        a,
        id,
        scopeId,
        assignmentId,
        rev(match),
      ),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/temporary-grants') @HttpCode(200) async operation42(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyTemporaryGrantInputSchema))
    body: z.infer<typeof c.CompanyTemporaryGrantInputSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyTemporaryGrantSchema.strip().parse(
      await this.governance.temporary(a, id, scopeId, body, key),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/temporary-grants/:grantId/revoke')
  @HttpCode(200)
  async operation43(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('grantId', uuid) grantId: string,
    @Query(empty) _q: unknown,
    @Body(
      new ZodValidationPipe(c.CollaborationEmptySchema.optional().default({})),
    )
    _body: z.infer<typeof c.CollaborationEmptySchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyTemporaryGrantSchema.strip().parse(
      await this.governance.revokeTemporary(
        a,
        id,
        scopeId,
        grantId,
        rev(match),
      ),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/access-inventory') async operation44(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyAccessInventorySchema.strip().parse(
      await this.governance.inventory(a, id, scopeId),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/access-reviews') async operation45(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyAccessReviewPageSchema.strip().parse(
      await this.governance.reviews(a, id, scopeId, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/access-reviews') @HttpCode(200) async operation46(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyAccessReviewInputSchema))
    body: z.infer<typeof c.CompanyAccessReviewInputSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyAccessReviewSchema.strip().parse(
      await this.governance.review(a, id, scopeId, body, key),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/approval-delegations') async operation47(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyDelegationPageSchema.strip().parse(
      await this.governance.delegations(a, id, scopeId, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/approval-delegations')
  @HttpCode(200)
  async operation48(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyDelegationCreateSchema))
    body: z.infer<typeof c.CompanyDelegationCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyDelegationSchema.strip().parse(
      await this.governance.delegation(a, id, scopeId, body, key),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/approval-delegations/:delegationId/revoke')
  @HttpCode(200)
  async operation49(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('delegationId', uuid) delegationId: string,
    @Query(empty) _q: unknown,
    @Body(
      new ZodValidationPipe(c.CollaborationEmptySchema.optional().default({})),
    )
    _body: z.infer<typeof c.CollaborationEmptySchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyDelegationSchema.strip().parse(
      await this.governance.revokeDelegation(
        a,
        id,
        scopeId,
        delegationId,
        rev(match),
      ),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/finance/approval-policies') async operation50(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyApprovalPolicyPageSchema.strip().parse(
      await this.policies.list(a, id, scopeId, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/finance/approval-policies')
  @HttpCode(200)
  async operation51(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyApprovalPolicyInputSchema))
    body: z.infer<typeof c.CompanyApprovalPolicyInputSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyApprovalPolicySchema.strip().parse(
      await this.policies.create(a, id, scopeId, body, key),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/finance/approval-policies/:policyId/state')
  @HttpCode(200)
  async operation52(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('policyId', uuid) policyId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyApprovalPolicyChangeSchema))
    body: z.infer<typeof c.CompanyApprovalPolicyChangeSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyApprovalPolicySchema.strip().parse(
      await this.policies.change(a, id, scopeId, policyId, rev(match), body),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/finance/expenses/:expenseId/submit-by-policy')
  @HttpCode(200)
  async operation53(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('expenseId', uuid) expenseId: string,
    @Query(empty) _q: unknown,
    @Body(
      new ZodValidationPipe(c.CollaborationEmptySchema.optional().default({})),
    )
    _body: z.infer<typeof c.CollaborationEmptySchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyFinancialApprovalSchema.strip().parse(
      await this.approvals.expenseSubmit(
        a,
        id,
        scopeId,
        expenseId,
        rev(match),
        null,
      ),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/finance/reimbursements/:requestId/submit-by-policy')
  @HttpCode(200)
  async operation54(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('requestId', uuid) requestId: string,
    @Query(empty) _q: unknown,
    @Body(
      new ZodValidationPipe(c.CollaborationEmptySchema.optional().default({})),
    )
    _body: z.infer<typeof c.CollaborationEmptySchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyFinancialApprovalSchema.strip().parse(
      await this.approvals.reimbursementSubmit(
        a,
        id,
        scopeId,
        requestId,
        rev(match),
        null,
      ),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/finance/approvals/:approvalId/timeline')
  async operation55(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('approvalId', uuid) approvalId: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyApprovalTimelinePageSchema.strip().parse(
      await this.approvals.timeline(a, id, scopeId, approvalId, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/finance/budget-alerts') async operation56(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyBudgetAlertPageSchema.strip().parse(
      await this.alerts.list(a, id, scopeId, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/finance/budget-alerts')
  @HttpCode(200)
  async operation57(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyBudgetAlertInputSchema))
    body: z.infer<typeof c.CompanyBudgetAlertInputSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyBudgetAlertSchema.strip().parse(
      await this.alerts.create(a, id, scopeId, body, key),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/finance/budget-alerts/:ruleId/revoke')
  @HttpCode(200)
  async operation58(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('ruleId', uuid) ruleId: string,
    @Query(empty) _q: unknown,
    @Body(
      new ZodValidationPipe(c.CollaborationEmptySchema.optional().default({})),
    )
    _body: z.infer<typeof c.CollaborationEmptySchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyBudgetAlertSchema.strip().parse(
      await this.alerts.revoke(a, id, scopeId, ruleId, rev(match)),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('security-audit') async operation59(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanySensitiveAuditPageSchema.strip().parse(
      await this.access.sensitiveAudit(a, id, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('recovery-policy-drafts') async operation60(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.CompanyGapPageQuerySchema))
    q: z.infer<typeof c.CompanyGapPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyRecoveryPolicyDraftPageSchema.strip().parse(
      await this.governance.recoveryPolicyDrafts(a, id, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('recovery-policy-drafts') @HttpCode(200) async operation61(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyRecoveryPolicyDraftInputSchema))
    body: z.infer<typeof c.CompanyRecoveryPolicyDraftInputSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyRecoveryPolicyDraftSchema.strip().parse(
      await this.governance.recoveryPolicyDraft(a, id, body, key),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post('contexts/:scopeId/finance/approvals/:approvalId/decision-receipts')
  @HttpCode(200)
  async operation62(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('approvalId', uuid) approvalId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyFinancialApprovalDecisionSchema))
    body: z.infer<typeof c.CompanyFinancialApprovalDecisionSchema>,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyFinancialApprovalSchema.strip().parse(
      await this.approvals.decision(
        a,
        id,
        scopeId,
        approvalId,
        rev(match),
        body,
        requireKey(key),
      ),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/reports/resource-usage') async operation63(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyObservationRangeSchema))
    q: z.infer<typeof c.CompanyObservationRangeSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyResourceUsageSchema.strip().parse(
      await this.assets.utilization(a, id, scopeId, q),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post(
    'contexts/:scopeId/finance/budget-change-requests/:requestId/bind-workflow',
  )
  @HttpCode(200)
  async operation64(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('requestId', uuid) requestId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyFinancialWorkflowBindSchema))
    body: z.infer<typeof c.CompanyFinancialWorkflowBindSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyFinancialApprovalSchema.strip().parse(
      await this.approvals.budgetSubmit(
        a,
        id,
        scopeId,
        requestId,
        rev(match),
        body,
      ),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Post(
    'contexts/:scopeId/finance/budget-change-requests/:requestId/submit-by-policy',
  )
  @HttpCode(200)
  async operation65(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('requestId', uuid) requestId: string,
    @Query(empty) _q: unknown,
    @Body(
      new ZodValidationPipe(c.CollaborationEmptySchema.optional().default({})),
    )
    _body: z.infer<typeof c.CollaborationEmptySchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyFinancialApprovalSchema.strip().parse(
      await this.approvals.budgetSubmit(
        a,
        id,
        scopeId,
        requestId,
        rev(match),
        null,
      ),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/finance/approvals/:approvalId/action-state')
  async operation66(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('approvalId', uuid) approvalId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = c.CompanyApprovalActionStateSchema.strip().parse(
      await this.approvals.actionState(a, id, scopeId, approvalId),
    );
    if ('revision' in result && typeof result.revision === 'number')
      res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('contexts/:scopeId/effective-read-permissions') async operation67(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _q: unknown,
  ) {
    return c.CompanyEffectiveReadPermissionsSchema.parse(
      await this.queries.permissions(a, id, scopeId),
    );
  }
}
