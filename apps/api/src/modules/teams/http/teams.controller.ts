import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Query,
  Param,
  Headers,
  Res,
  Inject,
  Injectable,
  UseGuards,
  BadRequestException,
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
import { TeamsService } from '../application/teams.service.js';
const id = new ZodValidationPipe(c.TeamCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.CollaborationEmptySchema),
  emptyBody = new ZodValidationPipe(c.CollaborationEmptySchema.optional()),
  page = new ZodValidationPipe(c.TeamPageQuerySchema);
function revision(raw: string | undefined) {
  const v = expectedRevision(raw);
  if (v === undefined) throw new BadRequestException();
  return v;
}
function result<T>(res: Response, value: T, version: number) {
  res.setHeader('ETag', revisionTag(version));
  return value;
}
@Injectable()
export class TeamGuard implements CanActivate {
  constructor(
    @Inject(CollaborationService)
    private readonly collaboration: CollaborationService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context
      .switchToHttp()
      .getRequest<Request & { actor?: RequestActor }>();
    context
      .switchToHttp()
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
@Controller('teams')
@UseGuards(VerifiedSessionGuard, TeamGuard)
export class TeamsController {
  constructor(@Inject(TeamsService) private readonly service: TeamsService) {}
  @Post() async create(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.TeamCreateSchema))
    b: z.infer<typeof c.TeamCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.service.create(a, b, key);
    return result(res, v, v.revision);
  }
  @Get() list(
    @CurrentActor() a: RequestActor,
    @Query(page) q: z.infer<typeof c.TeamPageQuerySchema>,
  ) {
    return this.service.list(a, q);
  }
  @Get(':id') async read(
    @CurrentActor() a: RequestActor,
    @Param('id', id) teamId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.service.read(a, teamId);
    return result(res, v, v.revision);
  }
  @Patch(':id') async patch(
    @CurrentActor() a: RequestActor,
    @Param('id', id) teamId: string,
    @Headers('if-match') match: string | undefined,
    @Body(new ZodValidationPipe(c.TeamPatchSchema))
    b: z.infer<typeof c.TeamPatchSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.service.patch(a, teamId, revision(match), b);
    return result(res, v, v.revision);
  }
  @Get(':id/memberships') members(
    @CurrentActor() a: RequestActor,
    @Param('id', id) teamId: string,
    @Query(page) q: z.infer<typeof c.TeamPageQuerySchema>,
  ) {
    return this.service.members(a, teamId, q);
  }
  @Patch(':id/memberships/:accessId') async change(
    @CurrentActor() a: RequestActor,
    @Param('id', id) teamId: string,
    @Param('accessId', id) accessId: string,
    @Headers('if-match') match: string | undefined,
    @Body(new ZodValidationPipe(c.TeamMembershipChangeSchema))
    b: z.infer<typeof c.TeamMembershipChangeSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.service.hint(teamId);
    const v = c.TeamMembershipSchema.parse(
      await this.service.collaboration.changeMembership(
        a,
        teamId,
        accessId,
        revision(match),
        b,
      ),
    );
    return result(res, v, v.revision);
  }
  @Post(':id/invitations') async invite(
    @CurrentActor() a: RequestActor,
    @Param('id', id) teamId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(c.TeamInvitationCreateSchema))
    b: z.infer<typeof c.TeamInvitationCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.service.hint(teamId);
    const v = c.TeamInvitationDeliverySchema.parse(
      await this.service.collaboration.createInvitation(a, teamId, b, key),
    );
    return result(res, v, v.invitation.revision);
  }
  @Get(':id/invitations/:offerId') async invitation(
    @CurrentActor() a: RequestActor,
    @Param('id', id) teamId: string,
    @Param('offerId', id) offerId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.service.hint(teamId);
    const v = c.TeamInvitationSchema.parse(
      await this.service.collaboration.invitation(a, teamId, offerId),
    );
    return result(res, v, v.revision);
  }
  @Post(':id/invitations/:offerId/revoke') async revoke(
    @CurrentActor() a: RequestActor,
    @Param('id', id) teamId: string,
    @Param('offerId', id) offerId: string,
    @Headers('if-match') match: string | undefined,
    @Body(emptyBody) _b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.service.hint(teamId);
    const v = c.TeamInvitationSchema.parse(
      await this.service.collaboration.revokeInvitation(
        a,
        teamId,
        offerId,
        revision(match),
      ),
    );
    return result(res, v, v.revision);
  }
  @Get(':id/projects') projects(
    @CurrentActor() a: RequestActor,
    @Param('id', id) teamId: string,
    @Query(page) q: z.infer<typeof c.TeamPageQuerySchema>,
  ) {
    return this.service.projectList(a, teamId, q);
  }
  @Post(':id/leave') async leave(
    @CurrentActor() a: RequestActor,
    @Param('id', id) teamId: string,
    @Headers('if-match') match: string | undefined,
    @Body(emptyBody) _b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.service.hint(teamId);
    const v = await this.service.collaboration.leave(
      a,
      teamId,
      revision(match),
    );
    return result(res, v, v.revision);
  }
  @Put(':id/projects/:projectId') async reference(
    @CurrentActor() a: RequestActor,
    @Param('id', id) teamId: string,
    @Param('projectId', id) projectId: string,
    @Headers('if-match') match: string | undefined,
    @Body(emptyBody) _b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.service.reference(
      a,
      teamId,
      projectId,
      expectedRevision(match),
      true,
    );
    return result(res, v, v.revision);
  }
  @Delete(':id/projects/:projectId') async unreference(
    @CurrentActor() a: RequestActor,
    @Param('id', id) teamId: string,
    @Param('projectId', id) projectId: string,
    @Headers('if-match') match: string | undefined,
    @Body(emptyBody) _b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.service.reference(
      a,
      teamId,
      projectId,
      revision(match),
      false,
    );
    return result(res, v, v.revision);
  }
}
@Controller('team-invitations')
export class TeamInvitationController {
  constructor(
    @Inject(CollaborationService)
    private readonly service: CollaborationService,
  ) {}
  @Get('preview')
  @UseGuards(TeamGuard)
  preview(
    @Headers('x-invitation-proof') proof: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.service.preview(proof, 'TEAM');
  }
  @Post(':id/accept')
  @UseGuards(VerifiedSessionGuard, TeamGuard)
  async accept(
    @CurrentActor() a: RequestActor,
    @Param('id', id) offerId: string,
    @Headers('x-invitation-proof') proof: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Body(emptyBody) _b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = c.TeamInvitationAcceptanceSchema.parse(
      await this.service.decideInvitation(
        a,
        offerId,
        proof,
        revision(match),
        true,
        'TEAM',
      ),
    );
    return result(res, v, v.invitation.revision);
  }
  @Post(':id/decline')
  @UseGuards(VerifiedSessionGuard, TeamGuard)
  async decline(
    @CurrentActor() a: RequestActor,
    @Param('id', id) offerId: string,
    @Headers('x-invitation-proof') proof: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Body(emptyBody) _b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = c.TeamInvitationSchema.parse(
      await this.service.decideInvitation(
        a,
        offerId,
        proof,
        revision(match),
        false,
        'TEAM',
      ),
    );
    return result(res, v, v.revision);
  }
}
