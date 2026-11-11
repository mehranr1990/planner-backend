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
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import { CollaborationService } from '../../spaces/public/index.js';
import { SocialGroupsService } from '../application/groups.service.js';
import {
  SocialGuard,
  socialId,
  socialPage,
  socialEmpty,
  socialBody,
  socialExpected,
  socialResult,
} from './social.controller.js';
@Controller('social-groups')
@UseGuards(VerifiedSessionGuard, SocialGuard)
export class SocialGroupsController {
  constructor(
    @Inject(SocialGroupsService) private readonly service: SocialGroupsService,
  ) {}
  @Post() async create(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.SocialGroupCreateSchema))
    b: z.infer<typeof c.SocialGroupCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.service.create(a, b, key));
  }
  @Get() list(
    @CurrentActor() a: RequestActor,
    @Query(socialPage) q: z.infer<typeof c.SocialPageQuerySchema>,
  ) {
    return this.service.list(a, q);
  }
  @Get('discover') discover(
    @CurrentActor() a: RequestActor,
    @Query(socialPage) q: z.infer<typeof c.SocialPageQuerySchema>,
  ) {
    return this.service.discover(a, q);
  }
  @Get(':id') async read(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Query(socialEmpty) _q: unknown,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.service.read(a, id));
  }
  @Patch(':id') async patch(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Body(new ZodValidationPipe(c.SocialGroupPatchSchema))
    b: z.infer<typeof c.SocialGroupPatchSchema>,
    @Headers('if-match') v: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.service.patch(a, id, b, socialExpected(v)),
    );
  }
  @Get(':id/memberships') members(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Query(socialPage) q: z.infer<typeof c.SocialPageQuerySchema>,
  ) {
    return this.service.members(a, id, q);
  }
  @Patch(':id/memberships/:accessId') async change(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Param('accessId', socialId) accessId: string,
    @Body(new ZodValidationPipe(c.SocialMembershipChangeSchema))
    b: z.infer<typeof c.SocialMembershipChangeSchema>,
    @Headers('if-match') v: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    await this.service.hint(id);
    return socialResult(
      r,
      c.SocialMembershipSchema.parse(
        await this.service.collaboration.changeMembership(
          a,
          id,
          accessId,
          socialExpected(v),
          b,
        ),
      ),
    );
  }
  @Post(':id/invitations') async invite(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Body(new ZodValidationPipe(c.SocialGroupInvitationCreateSchema))
    b: z.infer<typeof c.SocialGroupInvitationCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return c.SocialGroupInvitationDeliverySchema.parse(
      await this.service.invite(a, id, b, key),
    );
  }
  @Get(':id/invitations/:offerId') async invitation(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Param('offerId', socialId) offerId: string,
    @Query(socialEmpty) _q: unknown,
  ) {
    await this.service.hint(id);
    return c.SocialGroupInvitationSchema.parse(
      await this.service.collaboration.invitation(a, id, offerId),
    );
  }
  @Post(':id/invitations/:offerId/revoke') async revoke(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Param('offerId', socialId) offerId: string,
    @Body(socialBody) _b: unknown,
    @Headers('if-match') v: string | undefined,
  ) {
    await this.service.hint(id);
    return c.SocialGroupInvitationSchema.parse(
      await this.service.collaboration.revokeInvitation(
        a,
        id,
        offerId,
        socialExpected(v),
      ),
    );
  }
  @Post(':id/join-requests') join(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Body(new ZodValidationPipe(c.SocialJoinCreateSchema))
    b: z.infer<typeof c.SocialJoinCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.service.join(a, id, b, key);
  }
  @Get(':id/join-requests') requests(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Query(socialPage) q: z.infer<typeof c.SocialPageQuerySchema>,
  ) {
    return this.service.requests(a, id, q);
  }
  @Post(':id/join-requests/:requestId/:action') decide(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Param('requestId', socialId) requestId: string,
    @Param('action', new ZodValidationPipe(c.SocialJoinActionSchema))
    action: z.infer<typeof c.SocialJoinActionSchema>,
    @Body(socialBody) _b: unknown,
    @Headers('if-match') v: string | undefined,
  ) {
    return this.service.decideJoin(a, id, requestId, action, socialExpected(v));
  }
  @Post(':id/leave') async leave(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Body(socialBody) _b: unknown,
    @Headers('if-match') v: string | undefined,
  ) {
    await this.service.hint(id);
    return this.service.collaboration.leave(a, id, socialExpected(v));
  }
  @Post(':id/handovers') async handover(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Body(new ZodValidationPipe(c.HandoverCreateSchema))
    b: z.infer<typeof c.HandoverCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    await this.service.hint(id);
    return this.service.collaboration.createHandover(a, id, b, key);
  }
  @Get(':id/handovers/:handoverId') async handoverStatus(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Param('handoverId', socialId) handoverId: string,
    @Query(socialEmpty) _q: unknown,
  ) {
    await this.service.hint(id);
    return this.service.collaboration.handover(a, id, handoverId);
  }
  @Post(':id/handovers/:handoverId/decline') async declineHandover(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Param('handoverId', socialId) handoverId: string,
    @Body(socialBody) _b: unknown,
    @Headers('if-match') v: string | undefined,
  ) {
    await this.service.hint(id);
    return this.service.collaboration.decideHandover(
      a,
      id,
      handoverId,
      socialExpected(v),
      'decline',
    );
  }
  @Post(':id/handovers/:handoverId/revoke') async revokeHandover(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Param('handoverId', socialId) handoverId: string,
    @Body(socialBody) _b: unknown,
    @Headers('if-match') v: string | undefined,
  ) {
    await this.service.hint(id);
    return this.service.collaboration.decideHandover(
      a,
      id,
      handoverId,
      socialExpected(v),
      'revoke',
    );
  }
  @Post(':id/handovers/:handoverId/accept') async acceptHandover(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Param('handoverId', socialId) handoverId: string,
    @Body(new ZodValidationPipe(c.HandoverAcceptSchema))
    b: z.infer<typeof c.HandoverAcceptSchema>,
    @Headers('if-match') v: string | undefined,
  ) {
    await this.service.hint(id);
    return this.service.collaboration.decideHandover(
      a,
      id,
      handoverId,
      socialExpected(v),
      'accept',
      b.password,
    );
  }
}
@Controller('social-group-invitations')
export class SocialGroupInvitationsController {
  constructor(
    @Inject(CollaborationService)
    private readonly collaboration: CollaborationService,
    @Inject(SocialGroupsService) private readonly service: SocialGroupsService,
  ) {}
  @Get('preview') @UseGuards(SocialGuard) preview(
    @Headers('x-invitation-proof') proof: string | undefined,
    @Query(socialEmpty) _q: unknown,
  ) {
    return this.collaboration.preview(proof, 'SOCIAL_GROUP');
  }
  @Post(':id/accept')
  @UseGuards(VerifiedSessionGuard, SocialGuard)
  async accept(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Headers('x-invitation-proof') proof: string | undefined,
    @Headers('if-match') v: string | undefined,
    @Body(socialBody) _b: unknown,
  ) {
    return c.SocialGroupInvitationAcceptanceSchema.parse(
      await this.service.decideInvitation(
        a,
        id,
        proof,
        socialExpected(v),
        true,
      ),
    );
  }
  @Post(':id/decline')
  @UseGuards(VerifiedSessionGuard, SocialGuard)
  async decline(
    @CurrentActor() a: RequestActor,
    @Param('id', socialId) id: string,
    @Headers('x-invitation-proof') proof: string | undefined,
    @Headers('if-match') v: string | undefined,
    @Body(socialBody) _b: unknown,
  ) {
    return c.SocialGroupInvitationSchema.parse(
      await this.service.decideInvitation(
        a,
        id,
        proof,
        socialExpected(v),
        false,
      ),
    );
  }
}
