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
  Injectable,
  UseGuards,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
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
import { CollaborationService } from '../../spaces/public/index.js';
import { CompaniesService } from '../application/companies.service.js';
const uuid = new ZodValidationPipe(c.CompanyCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.CollaborationEmptySchema),
  emptyBody = new ZodValidationPipe(c.CollaborationEmptySchema.optional());
function rev(v: string | undefined) {
  const n = expectedRevision(v);
  if (n === undefined) throw new BadRequestException();
  return n;
}
@Injectable()
export class CompanyGuard implements CanActivate {
  constructor(
    @Inject(CollaborationService)
    private readonly collaboration: CollaborationService,
  ) {}
  async canActivate(c: ExecutionContext) {
    const req = c
      .switchToHttp()
      .getRequest<Request & { actor?: RequestActor }>();
    c.switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && Object.keys(req.query).length)
      throw new BadRequestException();
    await this.collaboration.request(
      req.ip ?? req.socket.remoteAddress ?? 'unknown',
      req.actor,
      req.path.endsWith('/preview'),
    );
    return true;
  }
}
@Controller('companies')
@UseGuards(VerifiedSessionGuard, CompanyGuard)
export class CompaniesController {
  constructor(
    @Inject(CompaniesService) private readonly service: CompaniesService,
  ) {}
  @Get(':id/contexts/:scopeId/invitations') pendingInvitations(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyPageQuerySchema))
    q: z.infer<typeof c.CompanyPageQuerySchema>,
  ) {
    return this.service.access.pendingSent(actor, id, scopeId, q);
  }
  @Get(':id/contexts/:scopeId/access/me') accessMe(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _q: unknown,
  ) {
    return this.service.accessMe(actor, id, scopeId);
  }
  @Post('') async create(
    @CurrentActor() actor: RequestActor,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyCreateSchema))
    body: z.infer<typeof c.CompanyCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanySchema.parse(
      await this.service.create(actor, body, key),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('') async list(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.CompanyPageQuerySchema))
    query: z.infer<typeof c.CompanyPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyPageSchema.parse(
      await this.service.list(actor, query),
    );
    void res;
    return value;
  }
  @Get(':id') async read(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanySchema.parse(await this.service.read(actor, id));
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Patch(':id') async patch(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyPatchSchema))
    body: z.infer<typeof c.CompanyPatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanySchema.parse(
      await this.service.patch(actor, id, rev(match), body),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post(':id/departments') async createDepartment(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyContextCreateSchema))
    body: z.infer<typeof c.CompanyContextCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyContextSchema.parse(
      await this.service.createContext(actor, id, null, body, key),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get(':id/departments') async departments(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.CompanyPageQuerySchema))
    query: z.infer<typeof c.CompanyPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyContextPageSchema.parse(
      await this.service.contextList(actor, id, null, query),
    );
    void res;
    return value;
  }
  @Get(':id/departments/:departmentId') async department(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('departmentId', uuid) departmentId: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyContextSchema.parse(
      await this.service.contextRead(actor, id, departmentId, 'DEPARTMENT'),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Patch(':id/departments/:departmentId') async patchDepartment(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('departmentId', uuid) departmentId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyPatchSchema))
    body: z.infer<typeof c.CompanyPatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyContextSchema.parse(
      await this.service.contextPatch(
        actor,
        id,
        departmentId,
        'DEPARTMENT',
        rev(match),
        body,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post(':id/departments/:departmentId/units') async createUnit(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('departmentId', uuid) departmentId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyContextCreateSchema))
    body: z.infer<typeof c.CompanyContextCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyContextSchema.parse(
      await this.service.createContext(actor, id, departmentId, body, key),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get(':id/departments/:departmentId/units') async units(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('departmentId', uuid) departmentId: string,
    @Query(new ZodValidationPipe(c.CompanyPageQuerySchema))
    query: z.infer<typeof c.CompanyPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyContextPageSchema.parse(
      await this.service.contextList(actor, id, departmentId, query),
    );
    void res;
    return value;
  }
  @Get(':id/units/:unitId') async unit(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('unitId', uuid) unitId: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyContextSchema.parse(
      await this.service.contextRead(actor, id, unitId, 'UNIT'),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Patch(':id/units/:unitId') async patchUnit(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('unitId', uuid) unitId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyPatchSchema))
    body: z.infer<typeof c.CompanyPatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyContextSchema.parse(
      await this.service.contextPatch(
        actor,
        id,
        unitId,
        'UNIT',
        rev(match),
        body,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get(':id/contexts/:scopeId/members') async members(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyPageQuerySchema))
    query: z.infer<typeof c.CompanyPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyMembershipPageSchema.parse(
      await this.service.members(actor, id, scopeId, query),
    );
    void res;
    return value;
  }
  @Post(':id/contexts/:scopeId/invitations') async invite(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyInvitationCreateSchema))
    body: z.infer<typeof c.CompanyInvitationCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyInvitationDeliverySchema.parse(
      await this.service.invite(actor, id, scopeId, body, key),
    );
    void res;
    return value;
  }
  @Get(':id/contexts/:scopeId/invitations/:invitationId') async invitation(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('invitationId', uuid) invitationId: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyInvitationSchema.parse(
      await this.service.invitation(actor, id, scopeId, invitationId),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post(':id/contexts/:scopeId/invitations/:invitationId/revoke')
  @HttpCode(200)
  async revokeInvitation(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('invitationId', uuid) invitationId: string,
    @Query(empty) _query: unknown,
    @Body(emptyBody) _body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyInvitationSchema.parse(
      await this.service.invitation(
        actor,
        id,
        scopeId,
        invitationId,
        true,
        rev(match),
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Patch(':id/contexts/:scopeId/members/:accessId') async changeMember(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('accessId', uuid) accessId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyMembershipChangeSchema))
    body: z.infer<typeof c.CompanyMembershipChangeSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyMembershipSchema.parse(
      await this.service.changeMember(
        actor,
        id,
        scopeId,
        accessId,
        rev(match),
        body,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post(':id/contexts/:scopeId/leave') @HttpCode(200) async leave(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _query: unknown,
    @Body(emptyBody) _body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyLeaveResultSchema.parse(
      await this.service.leave(actor, id, scopeId, rev(match)),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get(':id/contexts/:scopeId/policy') async policy(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyEffectivePolicySchema.parse(
      await this.service.policy(actor, id, scopeId),
    );
    res.setHeader('ETag', revisionTag(value.version));
    return value;
  }
  @Put(':id/contexts/:scopeId/policy') async publish(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CompanyPolicyPublishSchema))
    body: z.infer<typeof c.CompanyPolicyPublishSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyEffectivePolicySchema.parse(
      await this.service.publish(actor, id, scopeId, rev(match), body),
    );
    res.setHeader('ETag', revisionTag(value.version));
    return value;
  }
}
@Controller('company-invitations')
@UseGuards(VerifiedSessionGuard, CompanyGuard)
export class CompanyInvitationsController {
  constructor(
    @Inject(CompaniesService) private readonly service: CompaniesService,
  ) {}
  @Get() pending(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.CompanyPageQuerySchema))
    q: z.infer<typeof c.CompanyPageQuerySchema>,
  ) {
    return this.service.access.pending(actor, q);
  }
  @Post(':invitationId/accept')
  @HttpCode(200)
  async accept(
    @CurrentActor() actor: RequestActor,
    @Param('invitationId', uuid) invitationId: string,
    @Query(empty) _query: unknown,
    @Body(emptyBody) _body: unknown,
    @Headers('if-match') match: string | undefined,
    @Headers('x-invitation-proof') proof: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyInvitationDecisionSchema.parse(
      await this.service.access.decide(
        actor,
        invitationId,
        proof,
        rev(match),
        true,
      ),
    );
    void res;
    return value;
  }
  @Post(':invitationId/decline')
  @HttpCode(200)
  async decline(
    @CurrentActor() actor: RequestActor,
    @Param('invitationId', uuid) invitationId: string,
    @Query(empty) _query: unknown,
    @Body(emptyBody) _body: unknown,
    @Headers('if-match') match: string | undefined,
    @Headers('x-invitation-proof') proof: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyInvitationDecisionSchema.parse(
      await this.service.access.decide(
        actor,
        invitationId,
        proof,
        rev(match),
        false,
      ),
    );
    void res;
    return value;
  }
}

@Controller('company-invitations')
@UseGuards(CompanyGuard)
export class CompanyInvitationPreviewController {
  constructor(
    @Inject(CompaniesService) private readonly service: CompaniesService,
  ) {}
  @Get('preview') async preview(
    @Query(empty) _query: unknown,
    @Headers('x-invitation-proof') proof: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyInvitationPreviewSchema.parse(
      await this.service.preview(proof),
    );
    void res;
    return value;
  }
}
/** OD-4 in-app delivery of a fresh one-time proof to the verified recipient. */
@Controller('company-invitations')
@UseGuards(VerifiedSessionGuard, CompanyGuard)
export class CompanyInvitationProofController {
  constructor(
    @Inject(CompaniesService) private readonly service: CompaniesService,
  ) {}
  @Post(':invitationId/proof')
  @HttpCode(200)
  issueProof(
    @CurrentActor() actor: RequestActor,
    @Param('invitationId', uuid) invitationId: string,
    @Query(empty) _query: unknown,
    @Body(emptyBody) _body: unknown,
    @Headers('if-match') match: string | undefined,
  ) {
    return this.service.access.issueProof(actor, invitationId, rev(match));
  }
}
