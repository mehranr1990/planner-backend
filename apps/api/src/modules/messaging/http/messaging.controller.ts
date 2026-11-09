import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  Headers,
  Res,
  Inject,
  UseGuards,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Response, Request } from 'express';
import type { z } from 'zod';
import { z as schema } from 'zod';
import * as c from '@mehran/api-contracts';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';
import { MessagingService } from '../application/messaging.service.js';
const id = new ZodValidationPipe(schema.uuid()),
  empty = new ZodValidationPipe(c.ConversationEmptySchema.optional()),
  query = new ZodValidationPipe(c.ConversationEmptySchema),
  page = new ZodValidationPipe(c.ConversationPageQuerySchema);
function revision(value: string | undefined) {
  const result = expectedRevision(value);
  if (result === undefined) throw new BadRequestException();
  return result;
}
function result<T extends { revision: number }>(res: Response, value: T) {
  res.setHeader('ETag', revisionTag(value.revision));
  return value;
}
@Injectable()
export class MessagingGuard implements CanActivate {
  constructor(
    @Inject(MessagingService) private readonly service: MessagingService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context
      .switchToHttp()
      .getRequest<Request & { actor: RequestActor }>();
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    await this.service.request(
      req.ip ?? req.socket.remoteAddress ?? 'unknown',
      req.actor,
    );
    return true;
  }
}
@Controller('conversations')
@UseGuards(VerifiedSessionGuard, MessagingGuard)
export class MessagingController {
  constructor(
    @Inject(MessagingService) private readonly service: MessagingService,
  ) {}
  @Post()
  async create(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.ConversationCreateSchema))
    body: z.infer<typeof c.ConversationCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(res, await this.service.create(actor, body, key));
  }
  @Get()
  list(
    @CurrentActor() actor: RequestActor,
    @Query(page) q: z.infer<typeof c.ConversationPageQuerySchema>,
  ) {
    return this.service.list(actor, q);
  }
  @Get(':id')
  async get(
    @CurrentActor() actor: RequestActor,
    @Param('id', id) conversationId: string,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(res, await this.service.get(actor, conversationId));
  }
  @Get(':id/members')
  members(
    @CurrentActor() actor: RequestActor,
    @Param('id', id) conversationId: string,
    @Query(page) q: z.infer<typeof c.ConversationPageQuerySchema>,
  ) {
    return this.service.members(actor, conversationId, q);
  }
  @Post(':id/restore-admission')
  async restoreAdmission(
    @CurrentActor() actor: RequestActor,
    @Param('id', id) conversationId: string,
    @Body(empty) _b: unknown,
    @Query(query) _q: unknown,
    @Headers('if-match') version: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      await this.service.restoreAdmission(
        actor,
        conversationId,
        revision(version),
        key,
      ),
    );
  }
  @Post(':id/invitations')
  async invite(
    @CurrentActor() actor: RequestActor,
    @Param('id', id) conversationId: string,
    @Body(new ZodValidationPipe(c.ConversationInvitationInputSchema))
    body: z.infer<typeof c.ConversationInvitationInputSchema>,
    @Headers('if-match') version: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      await this.service.invite(
        actor,
        conversationId,
        revision(version),
        body,
        key,
      ),
    );
  }
  @Post(':id/invitations/:invitationId/revoke')
  async revoke(
    @CurrentActor() actor: RequestActor,
    @Param('id', id) conversationId: string,
    @Param('invitationId', id) invitationId: string,
    @Headers('if-match') version: string | undefined,
    @Body(empty) _b: unknown,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      await this.service.revokeInvitation(
        actor,
        conversationId,
        invitationId,
        revision(version),
      ),
    );
  }
  @Patch(':id/members/:memberId')
  async role(
    @CurrentActor() actor: RequestActor,
    @Param('id', id) conversationId: string,
    @Param('memberId', id) memberId: string,
    @Body(new ZodValidationPipe(c.ConversationRoleInputSchema))
    body: z.infer<typeof c.ConversationRoleInputSchema>,
    @Headers('if-match') version: string | undefined,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      await this.service.changeMember(
        actor,
        conversationId,
        memberId,
        revision(version),
        body.role,
      ),
    );
  }
  @Post(':id/members/:memberId/remove')
  async remove(
    @CurrentActor() actor: RequestActor,
    @Param('id', id) conversationId: string,
    @Param('memberId', id) memberId: string,
    @Headers('if-match') version: string | undefined,
    @Body(empty) _b: unknown,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      await this.service.changeMember(
        actor,
        conversationId,
        memberId,
        revision(version),
        null,
      ),
    );
  }
  @Post(':id/leave')
  async leave(
    @CurrentActor() actor: RequestActor,
    @Param('id', id) conversationId: string,
    @Headers('if-match') version: string | undefined,
    @Body(empty) _b: unknown,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      await this.service.leave(actor, conversationId, revision(version)),
    );
  }
  @Post(':id/messages')
  send(
    @CurrentActor() actor: RequestActor,
    @Param('id', id) conversationId: string,
    @Body(new ZodValidationPipe(c.ConversationMessageInputSchema))
    body: z.infer<typeof c.ConversationMessageInputSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Query(query) _q: unknown,
  ) {
    return this.service.send(actor, conversationId, body, key);
  }
  @Get(':id/messages')
  messages(
    @CurrentActor() actor: RequestActor,
    @Param('id', id) conversationId: string,
    @Query(page) q: z.infer<typeof c.ConversationPageQuerySchema>,
  ) {
    return this.service.messages(actor, conversationId, q);
  }
}
@Controller('conversation-invitations')
@UseGuards(VerifiedSessionGuard, MessagingGuard)
export class ConversationInvitationsController {
  constructor(
    @Inject(MessagingService) private readonly service: MessagingService,
  ) {}
  @Get()
  list(
    @CurrentActor() actor: RequestActor,
    @Query(page) q: z.infer<typeof c.ConversationPageQuerySchema>,
  ) {
    return this.service.invitations(actor, q);
  }
  @Post(':invitationId/accept')
  async accept(
    @CurrentActor() actor: RequestActor,
    @Param('invitationId', id) invitationId: string,
    @Headers('if-match') version: string | undefined,
    @Body(empty) _b: unknown,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      await this.service.decide(actor, invitationId, revision(version), true),
    );
  }
  @Post(':invitationId/decline')
  async decline(
    @CurrentActor() actor: RequestActor,
    @Param('invitationId', id) invitationId: string,
    @Headers('if-match') version: string | undefined,
    @Body(empty) _b: unknown,
    @Query(query) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      await this.service.decide(actor, invitationId, revision(version), false),
    );
  }
}
