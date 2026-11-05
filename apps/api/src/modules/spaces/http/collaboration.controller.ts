import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Headers,
  Param,
  Query,
  Res,
  Inject,
  UseGuards,
  BadRequestException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import { z as schema } from 'zod';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';
import { CollaborationService } from '../application/collaboration.service.js';
const empty = new ZodValidationPipe(c.CollaborationEmptySchema.optional()),
  query = new ZodValidationPipe(c.CollaborationEmptySchema),
  id = new ZodValidationPipe(schema.uuid());
function revision(value: string | undefined) {
  const parsed = expectedRevision(value);
  if (parsed === undefined) throw new BadRequestException();
  return parsed;
}
function result<T>(res: Response, value: T, version: number) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('ETag', revisionTag(version));
  return value;
}
@Injectable()
export class CollaborationGuard implements CanActivate {
  constructor(
    @Inject(CollaborationService)
    private readonly service: CollaborationService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { actor?: RequestActor }>();
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    await this.service.request(
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
      request.actor,
      this.reflector.get<boolean>(
        'collaboration.preview',
        context.getHandler(),
      ) ?? false,
    );
    if (request.params.spaceId)
      await this.service.requireContextKind(
        String(request.params.spaceId),
        'PROJECT',
      );
    return true;
  }
}
@Controller('invitations')
export class InvitationRecipientController {
  constructor(
    @Inject(CollaborationService)
    private readonly service: CollaborationService,
  ) {}
  @Get('preview')
  @SetMetadata('collaboration.preview', true)
  @UseGuards(CollaborationGuard)
  async preview(
    @Headers('x-invitation-proof') proof: string | undefined,
    @Query(query) _q: unknown,
  ) {
    return this.service.preview(proof);
  }
  @Post(':id/accept')
  @UseGuards(VerifiedSessionGuard, CollaborationGuard)
  async accept(
    @CurrentActor() actor: RequestActor,
    @Param('id', id) invitationId: string,
    @Headers('x-invitation-proof') proof: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Body(empty) _b: unknown,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.InvitationAcceptanceSchema.parse(
      await this.service.decideInvitation(
        actor,
        invitationId,
        proof,
        revision(match),
        true,
      ),
    );
    return result(res, value, value.invitation.revision);
  }
  @Post(':id/decline')
  @UseGuards(VerifiedSessionGuard, CollaborationGuard)
  async decline(
    @CurrentActor() actor: RequestActor,
    @Param('id', id) invitationId: string,
    @Headers('x-invitation-proof') proof: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Body(empty) _b: unknown,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.InvitationSchema.parse(
      await this.service.decideInvitation(
        actor,
        invitationId,
        proof,
        revision(match),
        false,
      ),
    );
    return result(res, value, value.revision);
  }
}
@Controller('spaces/:spaceId')
@UseGuards(VerifiedSessionGuard, CollaborationGuard)
export class SpaceCollaborationController {
  constructor(
    @Inject(CollaborationService)
    private readonly service: CollaborationService,
  ) {}
  @Post('invitations')
  async invite(
    @CurrentActor() actor: RequestActor,
    @Param('spaceId', id) spaceId: string,
    @Body(new ZodValidationPipe(c.InvitationCreateSchema))
    body: z.infer<typeof c.InvitationCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.createInvitation(
      actor,
      spaceId,
      body,
      key,
    );
    return result(res, value, value.invitation.revision);
  }
  @Get('invitations/:id')
  async invitation(
    @CurrentActor() actor: RequestActor,
    @Param('spaceId', id) spaceId: string,
    @Param('id', id) invitationId: string,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.invitation(actor, spaceId, invitationId);
    return result(res, value, value.revision);
  }
  @Post('invitations/:id/revoke')
  async revoke(
    @CurrentActor() actor: RequestActor,
    @Param('spaceId', id) spaceId: string,
    @Param('id', id) invitationId: string,
    @Headers('if-match') match: string | undefined,
    @Body(empty) _b: unknown,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.revokeInvitation(
      actor,
      spaceId,
      invitationId,
      revision(match),
    );
    return result(res, value, value.revision);
  }
  @Patch('memberships/:id')
  async change(
    @CurrentActor() actor: RequestActor,
    @Param('spaceId', id) spaceId: string,
    @Param('id', id) accessId: string,
    @Headers('if-match') match: string | undefined,
    @Body(new ZodValidationPipe(c.MembershipChangeSchema))
    body: z.infer<typeof c.MembershipChangeSchema>,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.changeMembership(
      actor,
      spaceId,
      accessId,
      revision(match),
      body,
    );
    return result(res, value, value.revision);
  }
  @Post('leave')
  async leave(
    @CurrentActor() actor: RequestActor,
    @Param('spaceId', id) spaceId: string,
    @Headers('if-match') match: string | undefined,
    @Body(empty) _b: unknown,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.leave(actor, spaceId, revision(match));
    return result(res, value, value.revision);
  }
  @Post('ownership-handovers')
  async propose(
    @CurrentActor() actor: RequestActor,
    @Param('spaceId', id) spaceId: string,
    @Body(new ZodValidationPipe(c.HandoverCreateSchema))
    body: z.infer<typeof c.HandoverCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.createHandover(actor, spaceId, body, key);
    return result(res, value, value.revision);
  }
  @Get('ownership-handovers/:id')
  async handover(
    @CurrentActor() actor: RequestActor,
    @Param('spaceId', id) spaceId: string,
    @Param('id', id) handoverId: string,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.handover(actor, spaceId, handoverId);
    return result(res, value, value.revision);
  }
  @Post('ownership-handovers/:id/accept')
  async accept(
    @CurrentActor() actor: RequestActor,
    @Param('spaceId', id) spaceId: string,
    @Param('id', id) handoverId: string,
    @Headers('if-match') match: string | undefined,
    @Body(new ZodValidationPipe(c.HandoverAcceptSchema))
    body: z.infer<typeof c.HandoverAcceptSchema>,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.decideHandover(
      actor,
      spaceId,
      handoverId,
      revision(match),
      'accept',
      body.password,
    );
    return result(res, value, value.revision);
  }
  @Post('ownership-handovers/:id/decline')
  async decline(
    @CurrentActor() actor: RequestActor,
    @Param('spaceId', id) spaceId: string,
    @Param('id', id) handoverId: string,
    @Headers('if-match') match: string | undefined,
    @Body(empty) _b: unknown,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.decideHandover(
      actor,
      spaceId,
      handoverId,
      revision(match),
      'decline',
    );
    return result(res, value, value.revision);
  }
  @Post('ownership-handovers/:id/revoke')
  async cancel(
    @CurrentActor() actor: RequestActor,
    @Param('spaceId', id) spaceId: string,
    @Param('id', id) handoverId: string,
    @Headers('if-match') match: string | undefined,
    @Body(empty) _b: unknown,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.decideHandover(
      actor,
      spaceId,
      handoverId,
      revision(match),
      'revoke',
    );
    return result(res, value, value.revision);
  }
}
