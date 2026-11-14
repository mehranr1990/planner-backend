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
import { CompaniesService } from '../application/companies.service.js';
import { CompanyStaffService } from '../application/company-staff.service.js';
import { CompanyResourceRequestsService } from '../application/company-resource-requests.service.js';
import { CompanyReportsService } from '../application/company-reports.service.js';
import { CompanyAssociationsService } from '../application/company-associations.service.js';
const uuid = new ZodValidationPipe(c.CompanyCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.CollaborationEmptySchema),
  emptyBody = new ZodValidationPipe(c.CollaborationEmptySchema.optional()),
  page = new ZodValidationPipe(c.CompanyStaffPageQuerySchema);
type Page = z.infer<typeof c.CompanyStaffPageQuerySchema>;
function rev(v: string | undefined) {
  const n = expectedRevision(v);
  if (n === undefined) throw new BadRequestException();
  return n;
}
function tagged<T extends { revision: number }>(res: Response, value: T) {
  res.setHeader('ETag', revisionTag(value.revision));
  return value;
}
/** C-M1: Company settings (fixed currency, OD-9/F1). */
@Controller('companies/:id/settings')
@UseGuards(VerifiedSessionGuard, CompanyGuard)
export class CompanySettingsController {
  constructor(
    @Inject(CompaniesService) private readonly companies: CompaniesService,
  ) {}
  @Get() async settings(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanySettingsSchema.parse(await this.companies.settings(actor, id)),
    );
  }
  @Put('currency') async currency(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyCurrencyInputSchema))
    body: z.infer<typeof c.CompanyCurrencyInputSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanySettingsSchema.parse(
        await this.companies.setCurrency(actor, id, rev(match), body),
      ),
    );
  }
  @Put('legal') async legal(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyLegalSettingsInputSchema))
    body: z.infer<typeof c.CompanyLegalSettingsInputSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanySettingsSchema.parse(
        await this.companies.setLegal(actor, id, rev(match), body),
      ),
    );
  }
}
/** C-M3 directory/KPIs and C-M4 resource approvals and association summaries. */
@Controller('companies/:id/contexts/:scopeId')
@UseGuards(VerifiedSessionGuard, CompanyGuard)
export class CompanyCompletionController {
  constructor(
    @Inject(CompanyStaffService) private readonly staff: CompanyStaffService,
    @Inject(CompanyResourceRequestsService)
    private readonly requests: CompanyResourceRequestsService,
    @Inject(CompanyReportsService)
    private readonly reports: CompanyReportsService,
    @Inject(CompanyAssociationsService)
    private readonly associations: CompanyAssociationsService,
  ) {}
  @Get('directory') async directory(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(page) q: Page,
  ) {
    return c.CompanyDirectoryPageSchema.parse(
      await this.staff.directory(actor, id, scopeId, q),
    );
  }
  @Put('staff-profiles/:profileId/work-details') async workDetails(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('profileId', uuid) profileId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyWorkDetailsInputSchema))
    body: z.infer<typeof c.CompanyWorkDetailsInputSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyWorkDetailsSchema.parse(
        await this.staff.setWorkDetails(
          actor,
          id,
          scopeId,
          profileId,
          rev(match),
          body,
        ),
      ),
    );
  }
  @Get('reports/kpis') async kpis(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyReportQuerySchema))
    q: z.infer<typeof c.CompanyReportQuerySchema>,
  ) {
    return c.CompanyKpiReportSchema.parse(
      await this.reports.kpis(actor, id, scopeId, q),
    );
  }
  @Get('association-summaries') async summaries(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyAssociationQuerySchema))
    q: z.infer<typeof c.CompanyAssociationQuerySchema>,
  ) {
    return c.CompanyAssociationSummaryPageSchema.parse(
      await this.associations.summaries(actor, id, scopeId, q),
    );
  }
  @Get('association-candidates') async candidates(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _q: unknown,
  ) {
    return c.CompanyAttachCandidatePageSchema.parse(
      await this.associations.candidates(actor, id, scopeId),
    );
  }
  @Get('resource-types') async types(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(page) q: Page,
  ) {
    return c.CompanyResourceTypePageSchema.parse(
      await this.requests.types(actor, id, scopeId, q),
    );
  }
  @Post('resource-types') async createType(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyResourceTypeCreateSchema))
    body: z.infer<typeof c.CompanyResourceTypeCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyResourceTypeSchema.parse(
        await this.requests.createType(actor, id, scopeId, body, key),
      ),
    );
  }
  @Patch('resource-types/:typeId') async patchType(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('typeId', uuid) typeId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyResourceTypePatchSchema))
    body: z.infer<typeof c.CompanyResourceTypePatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyResourceTypeSchema.parse(
        await this.requests.patchType(
          actor,
          id,
          scopeId,
          typeId,
          rev(match),
          body,
        ),
      ),
    );
  }
  @Put('resources/:resourceId/type') async assignType(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('resourceId', uuid) resourceId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyResourceTypeAssignSchema))
    body: z.infer<typeof c.CompanyResourceTypeAssignSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyResourceSchema.parse(
        await this.requests.assignType(
          actor,
          id,
          scopeId,
          resourceId,
          rev(match),
          body,
        ),
      ),
    );
  }
  @Get('resource-workflows') async workflows(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyResourceWorkflowQuerySchema))
    q: z.infer<typeof c.CompanyResourceWorkflowQuerySchema>,
  ) {
    return c.CompanyResourceWorkflowPageSchema.parse(
      await this.requests.workflows(actor, id, scopeId, q),
    );
  }
  @Post('resource-workflows') async createWorkflow(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyResourceWorkflowCreateSchema))
    body: z.infer<typeof c.CompanyResourceWorkflowCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyResourceWorkflowSchema.parse(
        await this.requests.createWorkflow(actor, id, scopeId, body, key),
      ),
    );
  }
  @Get('resource-workflows/:versionId') async workflow(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('versionId', uuid) versionId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyResourceWorkflowSchema.parse(
        await this.requests.readWorkflow(actor, id, scopeId, versionId),
      ),
    );
  }
  @Patch('resource-workflows/:versionId') async patchWorkflow(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('versionId', uuid) versionId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyResourceWorkflowPatchSchema))
    body: z.infer<typeof c.CompanyResourceWorkflowPatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyResourceWorkflowSchema.parse(
        await this.requests.changeWorkflow(
          actor,
          id,
          scopeId,
          versionId,
          rev(match),
          { kind: 'steps', input: body },
        ),
      ),
    );
  }
  @Post('resource-workflows/:versionId/publish') @HttpCode(200) async publish(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('versionId', uuid) versionId: string,
    @Query(empty) _q: unknown,
    @Body(emptyBody) _b: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyResourceWorkflowSchema.parse(
        await this.requests.changeWorkflow(
          actor,
          id,
          scopeId,
          versionId,
          rev(match),
          { kind: 'publish' },
        ),
      ),
    );
  }
  @Post('resource-workflows/:versionId/archive') @HttpCode(200) async archive(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('versionId', uuid) versionId: string,
    @Query(empty) _q: unknown,
    @Body(emptyBody) _b: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyResourceWorkflowSchema.parse(
        await this.requests.changeWorkflow(
          actor,
          id,
          scopeId,
          versionId,
          rev(match),
          { kind: 'archive' },
        ),
      ),
    );
  }
  @Get('resource-requests') async list(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyResourceRequestQuerySchema))
    q: z.infer<typeof c.CompanyResourceRequestQuerySchema>,
  ) {
    return c.CompanyResourceRequestPageSchema.parse(
      await this.requests.requests(actor, id, scopeId, q),
    );
  }
  @Post('resources/:resourceId/requests') async request(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('resourceId', uuid) resourceId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyResourceRequestCreateSchema))
    body: z.infer<typeof c.CompanyResourceRequestCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyResourceRequestSchema.parse(
        await this.requests.createRequest(
          actor,
          id,
          scopeId,
          resourceId,
          body,
          key,
        ),
      ),
    );
  }
  @Get('resource-requests/:requestId') async read(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('requestId', uuid) requestId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyResourceRequestSchema.parse(
        await this.requests.readRequest(actor, id, scopeId, requestId),
      ),
    );
  }
  @Get('resource-requests/:requestId/history') async history(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('requestId', uuid) requestId: string,
    @Query(empty) _q: unknown,
  ) {
    return c.CompanyResourceRequestHistorySchema.parse(
      await this.requests.history(actor, id, scopeId, requestId),
    );
  }
  @Post('resource-requests/:requestId/decision') @HttpCode(200) async decide(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('requestId', uuid) requestId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyResourceRequestDecisionSchema))
    body: z.infer<typeof c.CompanyResourceRequestDecisionSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyResourceRequestSchema.parse(
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
  @Post('resource-requests/:requestId/withdraw') @HttpCode(200) async withdraw(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('requestId', uuid) requestId: string,
    @Query(empty) _q: unknown,
    @Body(emptyBody) _b: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyResourceRequestSchema.parse(
        await this.requests.withdraw(actor, id, scopeId, requestId, rev(match)),
      ),
    );
  }
}
