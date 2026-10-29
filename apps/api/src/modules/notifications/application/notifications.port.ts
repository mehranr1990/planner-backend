import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
export type NotificationResource =
  | 'reminders'
  | 'notifications'
  | 'deliveries'
  | 'subscriptions'
  | 'preferences';
export type NotificationWrite = {
  resource: NotificationResource;
  action:
    | 'create'
    | 'patch'
    | 'pause'
    | 'resume'
    | 'cancel'
    | 'read'
    | 'dismiss'
    | 'snooze'
    | 'revoke'
    | 'test';
  id?: string;
  revision?: number;
  key: string;
  body: unknown;
};
export abstract class NotificationsPort {
  abstract query(
    scope: AuthorizedSpace,
    resource: NotificationResource,
    id: string | undefined,
    query: Record<string, unknown>,
  ): Promise<unknown>;
  abstract mutate(
    scope: AuthorizedSpace,
    command: NotificationWrite,
  ): Promise<unknown>;
  abstract sweep(after?: string): Promise<string | null>;
  abstract dispatch(id: string): Promise<void>;
  abstract pending(): Promise<Array<{ id: string; at: Date }>>;
  abstract consumeOutbox(): Promise<boolean>;
}
