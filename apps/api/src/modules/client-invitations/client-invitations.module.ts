import {
  Module,
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Inject,
  UseGuards,
  HttpCode,
  NotFoundException,
} from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../bootstrap/zod-validation.pipe.js';
import { VerifiedSessionGuard } from '../../platform/auth/session.guard.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { CurrentActor } from '../../platform/auth/request-actor.js';
import type { RequestActor } from '../../platform/auth/request-actor.js';
import {
  SpacesModule,
  SharedKernel,
  CollaborationService,
  CompanyAccess,
} from '../spaces/public/index.js';
import { SocialModule, SocialGroupsService } from '../social/public/index.js';
import {
  MessagingModule,
  MessagingService,
} from '../messaging/public/index.js';
import { MeetingsService } from '../meetings/public/index.js';
import { projectInvitationDisplay } from '../projects/public/invitation-display.js';
import { teamInvitationDisplay } from '../teams/public/invitation-display.js';
import { companyInvitationDisplay } from '../companies/public/invitation-display.js';
import { invitationChannels } from '../notifications/public/invitation-preferences.js';
import { CollaborationGuard } from '../spaces/public/index.js';
import { ClientInvitationWorker } from './invitation-notifications.worker.js';
import { InvitationPushModule } from '../notifications/public/invitation-push-module.js';

@Controller('invitation-notifications')
@UseGuards(VerifiedSessionGuard, CollaborationGuard)
export class ClientInvitationNotificationsController {
  constructor(
    @Inject(CollaborationService) private readonly offers: CollaborationService,
    @Inject(CompanyAccess) private readonly company: CompanyAccess,
    @Inject(SocialGroupsService) private readonly social: SocialGroupsService,
    @Inject(MessagingService) private readonly messaging: MessagingService,
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
  ) {}
  @Get()
  async list(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.InvitationNotificationQuerySchema))
    query: z.infer<typeof c.InvitationNotificationQuerySchema>,
  ) {
    const q = { limit: query.limit, after: query.after },
      comm = { limit: query.limit, cursor: query.after };
    const page =
      query.kind === 'COMPANY'
        ? await this.company.pending(actor, q, companyInvitationDisplay)
        : query.kind === 'SOCIAL_GROUP'
          ? await this.social.pendingInvitations(actor, q)
          : query.kind === 'CONVERSATION'
            ? await this.messaging.invitations(actor, comm)
            : query.kind === 'MEETING'
              ? await this.meetings.invitations(actor, comm)
              : await this.offers.pendingOffers(
                  actor,
                  query.kind,
                  q,
                  undefined,
                  query.kind === 'PROJECT'
                    ? projectInvitationDisplay
                    : teamInvitationDisplay,
                );
    const module =
      query.kind === 'PROJECT'
        ? 'PROJECTS'
        : query.kind === 'TEAM'
          ? 'TEAMS'
          : query.kind === 'COMPANY'
            ? 'COMPANY'
            : query.kind === 'SOCIAL_GROUP'
              ? 'SOCIAL'
              : 'MESSAGING_MEETINGS';
    const channels = await this.kernel.personalWork(actor, (tx) =>
      invitationChannels(tx, actor.userId, module),
    );
    return c.InvitationNotificationPageSchema.parse({
      items: channels.inApp
        ? page.items
            .filter((item) => !('state' in item) || item.state === 'PENDING')
            .map((item) => item.notification)
        : [],
      nextCursor: page.nextCursor,
    });
  }
  @Post(':kind/:id/read')
  @HttpCode(200)
  async read(
    @CurrentActor() actor: RequestActor,
    @Param('kind', new ZodValidationPipe(c.InvitationFeedFields.kind))
    kind: z.infer<typeof c.InvitationFeedFields.kind>,
    @Param('id', new ZodValidationPipe(c.InvitationFeedFields.invitationId))
    id: string,
    @Body(new ZodValidationPipe(c.BackendCompletionEmptySchema)) _body: unknown,
    @Query(new ZodValidationPipe(c.BackendCompletionEmptySchema))
    _query: unknown,
  ) {
    if (kind === 'COMPANY') return this.company.markInvitationRead(actor, id);
    if (kind === 'SOCIAL_GROUP')
      return this.social.markInvitationRead(actor, id);
    if (kind === 'CONVERSATION')
      return this.messaging.markInvitationRead(actor, id);
    if (kind === 'MEETING') return this.meetings.markInvitationRead(actor, id);
    if (kind === 'PROJECT' || kind === 'TEAM')
      return this.offers.markInvitationRead(actor, kind, id);
    throw new NotFoundException();
  }
}
@Module({})
export class ClientInvitationsModule {
  static register(meetings: DynamicModule): DynamicModule {
    return {
      module: ClientInvitationsModule,
      imports: [
        AuditModule,
        SpacesModule,
        SocialModule,
        MessagingModule,
        meetings,
        InvitationPushModule,
      ],
      providers: [ClientInvitationWorker],
      exports: [ClientInvitationWorker],
      controllers: [ClientInvitationNotificationsController],
    };
  }
}
