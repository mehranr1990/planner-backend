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
import { CompanyStaffService } from '../application/company-staff.service.js';
import { CompanyEmployeeCasesService } from '../application/company-employee-cases.service.js';
const uuid = new ZodValidationPipe(c.CompanyCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.CollaborationEmptySchema),
  emptyBody = new ZodValidationPipe(c.CollaborationEmptySchema.optional());
function rev(v: string | undefined) {
  const n = expectedRevision(v);
  if (n === undefined) throw new BadRequestException();
  return n;
}
@Controller('companies/:id/contexts/:scopeId')
@UseGuards(VerifiedSessionGuard, CompanyGuard)
export class CompanyStaffController {
  constructor(
    @Inject(CompanyStaffService) private readonly staff: CompanyStaffService,
    @Inject(CompanyEmployeeCasesService)
    private readonly caseService: CompanyEmployeeCasesService,
  ) {}
  @Post('staff-profiles') async createProfile(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyStaffProfileCreateSchema))
    body: z.infer<typeof c.CompanyStaffProfileCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyStaffProfileSchema.parse(
      await this.staff.createProfile(actor, id, scopeId, body, key),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('staff-profiles') async profiles(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyStaffPageQuerySchema))
    query: z.infer<typeof c.CompanyStaffPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyStaffProfilePageSchema.parse(
      await this.staff.profiles(actor, id, scopeId, query),
    );
    void res;
    return value;
  }
  @Get('staff-profiles/:profileId') async profile(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('profileId', uuid) profileId: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyStaffProfileSchema.parse(
      await this.staff.readProfile(actor, id, scopeId, profileId),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Patch('staff-profiles/:profileId') async patchProfile(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('profileId', uuid) profileId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyStaffProfilePatchSchema))
    body: z.infer<typeof c.CompanyStaffProfilePatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyStaffProfileSchema.parse(
      await this.staff.patchProfile(
        actor,
        id,
        scopeId,
        profileId,
        rev(match),
        body,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Put('staff-profiles/:profileId/work-contact') async contact(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('profileId', uuid) profileId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyWorkContactSchema))
    body: z.infer<typeof c.CompanyWorkContactSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyStaffProfileSchema.parse(
      await this.staff.contact(actor, id, scopeId, profileId, rev(match), body),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('staff-profiles/:profileId/erase') @HttpCode(200) async eraseProfile(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('profileId', uuid) profileId: string,
    @Query(empty) _query: unknown,
    @Body(emptyBody) _body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyStaffProfileSchema.parse(
      await this.staff.eraseProfile(actor, id, scopeId, profileId, rev(match)),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('availability') async createAvailability(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyAvailabilityCreateSchema))
    body: z.infer<typeof c.CompanyAvailabilityCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyAvailabilitySchema.parse(
      await this.staff.createAvailability(actor, id, scopeId, body, key),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('availability') async availability(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyStaffPageQuerySchema))
    query: z.infer<typeof c.CompanyStaffPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyAvailabilityPageSchema.parse(
      await this.staff.availability(actor, id, scopeId, query),
    );
    void res;
    return value;
  }
  @Patch('availability/:availabilityId') async patchAvailability(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('availabilityId', uuid) availabilityId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyAvailabilityPatchSchema))
    body: z.infer<typeof c.CompanyAvailabilityPatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyAvailabilitySchema.parse(
      await this.staff.patchAvailability(
        actor,
        id,
        scopeId,
        availabilityId,
        rev(match),
        body,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('resources') async createResource(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyResourceCreateSchema))
    body: z.infer<typeof c.CompanyResourceCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyResourceSchema.parse(
      await this.staff.createResource(actor, id, scopeId, body, key),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('resources') async resources(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyStaffPageQuerySchema))
    query: z.infer<typeof c.CompanyStaffPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyResourcePageSchema.parse(
      await this.staff.resources(actor, id, scopeId, query),
    );
    void res;
    return value;
  }
  @Get('resources/:resourceId') async resource(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('resourceId', uuid) resourceId: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyResourceSchema.parse(
      await this.staff.readResource(actor, id, scopeId, resourceId),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Patch('resources/:resourceId') async patchResource(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('resourceId', uuid) resourceId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyResourcePatchSchema))
    body: z.infer<typeof c.CompanyResourcePatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyResourceSchema.parse(
      await this.staff.patchResource(
        actor,
        id,
        scopeId,
        resourceId,
        rev(match),
        body,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('resources/:resourceId/retire') @HttpCode(200) async retireResource(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('resourceId', uuid) resourceId: string,
    @Query(empty) _query: unknown,
    @Body(emptyBody) _body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyResourceSchema.parse(
      await this.staff.retireResource(
        actor,
        id,
        scopeId,
        resourceId,
        rev(match),
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('resources/:resourceId/allocations') async createAllocation(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('resourceId', uuid) resourceId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyAllocationCreateSchema))
    body: z.infer<typeof c.CompanyAllocationCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyAllocationSchema.parse(
      await this.staff.createAllocation(
        actor,
        id,
        scopeId,
        resourceId,
        body,
        key,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('resources/:resourceId/allocations') async allocations(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('resourceId', uuid) resourceId: string,
    @Query(new ZodValidationPipe(c.CompanyStaffPageQuerySchema))
    query: z.infer<typeof c.CompanyStaffPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyAllocationPageSchema.parse(
      await this.staff.allocations(actor, id, scopeId, resourceId, query),
    );
    void res;
    return value;
  }
  @Get('allocations/:allocationId') async allocation(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('allocationId', uuid) allocationId: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyAllocationSchema.parse(
      await this.staff.readAllocation(actor, id, scopeId, allocationId),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('allocations/:allocationId/cancel')
  @HttpCode(200)
  async cancelAllocation(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('allocationId', uuid) allocationId: string,
    @Query(empty) _query: unknown,
    @Body(emptyBody) _body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyAllocationSchema.parse(
      await this.staff.endAllocation(
        actor,
        id,
        scopeId,
        allocationId,
        rev(match),
        'CANCELED',
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('allocations/:allocationId/return')
  @HttpCode(200)
  async returnAllocation(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('allocationId', uuid) allocationId: string,
    @Query(empty) _query: unknown,
    @Body(emptyBody) _body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyAllocationSchema.parse(
      await this.staff.endAllocation(
        actor,
        id,
        scopeId,
        allocationId,
        rev(match),
        'RETURNED',
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('employee-cases') async createCase(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyEmployeeCaseCreateSchema))
    body: z.infer<typeof c.CompanyEmployeeCaseCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyEmployeeCaseSchema.parse(
      await this.caseService.create(actor, id, scopeId, body, key),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('employee-cases') async cases(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyStaffPageQuerySchema))
    query: z.infer<typeof c.CompanyStaffPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyEmployeeCasePageSchema.parse(
      await this.caseService.list(actor, id, scopeId, query),
    );
    void res;
    return value;
  }
  @Get('employee-cases/:caseId') async case(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('caseId', uuid) caseId: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyEmployeeCaseSchema.parse(
      await this.caseService.read(actor, id, scopeId, caseId),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('employee-cases/:caseId/entries') async appendEntry(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('caseId', uuid) caseId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyCaseEntryCreateSchema))
    body: z.infer<typeof c.CompanyCaseEntryCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyCaseEntryResultSchema.parse(
      await this.caseService.append(
        actor,
        id,
        scopeId,
        caseId,
        rev(match),
        body,
        key,
      ),
    );
    res.setHeader('ETag', revisionTag(value.case.revision));
    return value;
  }
  @Get('employee-cases/:caseId/entries') async entries(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('caseId', uuid) caseId: string,
    @Query(new ZodValidationPipe(c.CompanyStaffPageQuerySchema))
    query: z.infer<typeof c.CompanyStaffPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyCaseEntryPageSchema.parse(
      await this.caseService.entries(actor, id, scopeId, caseId, query),
    );
    void res;
    return value;
  }
  @Post('employee-cases/:caseId/erase') @HttpCode(200) async eraseCase(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('caseId', uuid) caseId: string,
    @Query(empty) _query: unknown,
    @Body(emptyBody) _body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyEmployeeCaseSchema.parse(
      await this.caseService.erase(actor, id, scopeId, caseId, rev(match)),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
}
