import type { Prisma } from '../../../generated/prisma/client.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import type * as c from '@mehran/api-contracts';
export type SharedCalendarCommand =
  | { kind: 'CREATE'; key: string; input: c.CalendarEventCreate }
  | { kind: 'READ'; id: string }
  | { kind: 'PATCH'; id: string; revision: number; input: c.CalendarEventPatch }
  | { kind: 'DELETE'; id: string; revision: number }
  | {
      kind: 'SERIES';
      id: string;
      revision: number;
      key: string;
      input: c.CalendarSeriesEdit;
    }
  | {
      kind: 'SERIES_RESULT';
      id: string;
      revision: number;
      key: string;
      input: c.CalendarSeriesEdit;
    }
  | { kind: 'LIST'; query: { limit?: string; cursor?: string } }
  | { kind: 'VIEW'; query: c.CalendarRangeQuery };
export abstract class SharedCalendar {
  abstract run(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    actor: RequestActor,
    spaceId: string,
    command: SharedCalendarCommand,
  ): Promise<unknown>;
}
