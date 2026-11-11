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
import { ConnectionsService } from '../application/connections.service.js';
export const socialId = new ZodValidationPipe(
    c.SocialConnectionCreateSchema.shape.id,
  ),
  socialPage = new ZodValidationPipe(c.SocialPageQuerySchema),
  socialEmpty = new ZodValidationPipe(c.SocialEmptySchema),
  socialBody = new ZodValidationPipe(c.SocialEmptySchema.optional());
export function socialExpected(raw: string | undefined) {
  const r = expectedRevision(raw);
  if (r === undefined) throw new BadRequestException();
  return r;
}
export function socialResult<T extends { revision: number }>(
  res: Response,
  v: T,
) {
  res.setHeader('ETag', revisionTag(v.revision));
  return v;
}
@Injectable()
export class SocialGuard implements CanActivate {
  constructor(
    @Inject(CollaborationService)
    private readonly collaboration: CollaborationService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context
      .switchToHttp()
      .getRequest<Request & { actor?: RequestActor }>();
    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader('Cache-Control', 'no-store');
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
@Controller('social')
@UseGuards(VerifiedSessionGuard, SocialGuard)
export class SocialController {
  constructor(
    @Inject(ConnectionsService) private readonly service: ConnectionsService,
  ) {}
  @Get('privacy') async privacy(
    @CurrentActor() a: RequestActor,
    @Query(socialEmpty) _q: unknown,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.service.privacy(a));
  }
  @Patch('privacy') async patchPrivacy(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.SocialPrivacyPatchSchema))
    b: z.infer<typeof c.SocialPrivacyPatchSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') v: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.service.patchPrivacy(a, b, key, socialExpected(v)),
    );
  }
  @Post('discovery') discover(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.SocialDiscoverySchema))
    b: z.infer<typeof c.SocialDiscoverySchema>,
  ) {
    return this.service.discover(a, b.email);
  }
  @Get('connections') connections(
    @CurrentActor() a: RequestActor,
    @Query(socialPage) q: z.infer<typeof c.SocialPageQuerySchema>,
  ) {
    return this.service.list(a, q);
  }
  @Post('connections') async request(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.SocialConnectionCreateSchema))
    b: z.infer<typeof c.SocialConnectionCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.service.request(a, b, key));
  }
  @Post('connections/:id/:action') async decide(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Param('action', new ZodValidationPipe(c.SocialConnectionActionSchema))
    action: z.infer<typeof c.SocialConnectionActionSchema>,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') v: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.service.decide(a, id, action, key, socialExpected(v)),
    );
  }
  @Get('blocks') blocks(
    @CurrentActor() a: RequestActor,
    @Query(socialPage) q: z.infer<typeof c.SocialPageQuerySchema>,
  ) {
    return this.service.contacts.list(a, {
      limit: q.limit,
      ...(q.after ? { cursor: q.after } : {}),
    });
  }
  @Post('blocks') async block(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.SocialBlockCreateSchema))
    b: z.infer<typeof c.SocialBlockCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') v: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.service.block(a, b.targetUserId, key, socialExpected(v)),
    );
  }
  @Post('blocks/:id/unblock') async unblock(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') v: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.service.contacts.set(
        a,
        id,
        false,
        key,
        socialExpected(v),
        true,
      ),
    );
  }
  @Post('restore-replay') replay(
    @CurrentActor() a: RequestActor,
    @Body(socialBody) _b: unknown,
  ) {
    return this.service.replay(a);
  }
  @Get('circles') circles(
    @CurrentActor() a: RequestActor,
    @Query(socialPage) q: z.infer<typeof c.SocialPageQuerySchema>,
  ) {
    return this.service.circles(a, q);
  }
  @Post('circles') async createCircle(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.SocialCircleCreateSchema))
    b: z.infer<typeof c.SocialCircleCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.service.createCircle(a, b, key));
  }
  @Get('circles/:id') async circle(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Query(socialEmpty) _q: unknown,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.service.circle(a, id));
  }
  @Patch('circles/:id') async editCircle(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Body(new ZodValidationPipe(c.SocialCirclePatchSchema))
    b: z.infer<typeof c.SocialCirclePatchSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') v: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.service.editCircle(a, id, b, key, socialExpected(v)),
    );
  }
  @Delete('circles/:id') async deleteCircle(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') v: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.service.editCircle(a, id, null, key, socialExpected(v)),
    );
  }
  @Get('circles/:id/members') labels(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Query(socialPage) q: z.infer<typeof c.SocialPageQuerySchema>,
  ) {
    return this.service.labels(a, id, q);
  }
  @Put('circles/:id/members/:connectionId') label(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Param('connectionId', socialId) connectionId: string,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') v: string | undefined,
  ) {
    return this.service.label(
      a,
      id,
      connectionId,
      true,
      key,
      socialExpected(v),
    );
  }
  @Delete('circles/:id/members/:connectionId') unlabel(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Param('connectionId', socialId) connectionId: string,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') v: string | undefined,
  ) {
    return this.service.label(
      a,
      id,
      connectionId,
      false,
      key,
      socialExpected(v),
    );
  }
}
