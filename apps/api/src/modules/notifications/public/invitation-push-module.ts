import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../platform/database/database.module.js';
import { NotificationChannelModule } from './messaging-push.js';
import { InvitationPushDeliveries } from '../infrastructure/invitation-push.repository.js';
export { InvitationPushDeliveries };
@Module({
  imports: [DatabaseModule, NotificationChannelModule],
  providers: [InvitationPushDeliveries],
  exports: [InvitationPushDeliveries],
})
export class InvitationPushModule {}
