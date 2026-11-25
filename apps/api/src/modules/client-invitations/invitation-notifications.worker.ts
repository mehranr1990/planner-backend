import { Injectable, Inject } from '@nestjs/common';
import { CollaborationService, CompanyAccess } from '../spaces/public/index.js';
import { SocialGroupsService } from '../social/public/index.js';
import { MessagingService } from '../messaging/public/index.js';
import { MeetingsService } from '../meetings/public/index.js';
import { InvitationPushDeliveries } from '../notifications/public/invitation-push-module.js';
@Injectable()
export class ClientInvitationWorker {
  constructor(
    @Inject(CollaborationService) private readonly offers: CollaborationService,
    @Inject(CompanyAccess) private readonly company: CompanyAccess,
    @Inject(SocialGroupsService) private readonly social: SocialGroupsService,
    @Inject(MessagingService) private readonly messaging: MessagingService,
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(InvitationPushDeliveries)
    private readonly push: InvitationPushDeliveries,
  ) {}
  consume() {
    return this.push.consume(async (row) => {
      if (row.contextInvitationId) {
        if (row.module === 'COMPANY')
          return this.company.validateInvitationNotification(
            row.contextInvitationId,
            row.userId,
          );
        if (row.module === 'SOCIAL')
          return this.social.validateInvitationNotification(
            row.contextInvitationId,
            row.userId,
          );
        return this.offers.validateInvitationNotification(
          row.contextInvitationId,
          row.userId,
        );
      }
      if (row.conversationInvitationId)
        return this.messaging.validateInvitationNotification(
          row.conversationInvitationId,
          row.userId,
        );
      return this.meetings.validateInvitationNotification(
        row.meetingInvitationId!,
        row.userId,
      );
    });
  }
}
