import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
export abstract class PersonalCapacityCalendar {
  abstract busy(
    scope: AuthorizedSpace,
    from: string,
    to: string,
    timezone: string,
  ): Promise<Array<{ start: number; end: number }>>;
}
