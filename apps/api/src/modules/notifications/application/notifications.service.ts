import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../../platform/audit/audit.service.js';
import { NotificationsPort } from './notifications.port.js';
import type {
  NotificationResource,
  NotificationWrite,
} from './notifications.port.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import * as c from '@mehran/api-contracts';
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NotificationsPort) private readonly port: NotificationsPort,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}
  private async guarded<T>(scope: AuthorizedSpace, work: () => Promise<T>) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof NotFoundException)
        await this.audit.record({
          action: 'ACCESS_DENIED',
          outcome: 'DENIED',
          actorUserId: scope.actor.userId,
          requestId: scope.actor.requestId,
          correlationId: scope.actor.correlationId,
        });
      throw error;
    }
  }
  async query(
    scope: AuthorizedSpace,
    resource: NotificationResource,
    id: string | undefined,
    query: Record<string, unknown>,
  ) {
    const value = await this.guarded(scope, () =>
      this.port.query(scope, resource, id, query),
    );
    if (resource === 'preferences')
      return c.NotificationPreferenceSchema.parse(value);
    if (resource === 'deliveries')
      return c.NotificationDeliveryPageSchema.parse(value);
    if (resource === 'subscriptions')
      return id
        ? c.PushSubscriptionSchema.parse(value)
        : c.PushSubscriptionPageSchema.parse(value);
    if (resource === 'reminders')
      return id
        ? c.ReminderSchema.parse(value)
        : c.ReminderPageSchema.parse(value);
    return id
      ? c.NotificationSchema.parse(value)
      : c.NotificationPageSchema.parse(value);
  }
  async mutate(scope: AuthorizedSpace, command: NotificationWrite) {
    const value = await this.guarded(scope, () =>
      this.port.mutate(scope, command),
    );
    if (command.action === 'snooze')
      return c.NotificationSnoozeResultSchema.parse(value);
    if (command.resource === 'preferences')
      return c.NotificationPreferenceSchema.parse(value);
    if (command.resource === 'subscriptions')
      return c.PushSubscriptionSchema.parse(value);
    if (command.resource === 'reminders' || command.action === 'test')
      return c.ReminderSchema.parse(value);
    return c.NotificationSchema.parse(value);
  }
}
