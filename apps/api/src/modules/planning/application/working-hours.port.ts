import type {
  WorkingHours,
  WorkingHoursViewSchema,
} from '@mehran/api-contracts';
import type { z } from 'zod';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
export abstract class WorkingHoursPort {
  abstract read(
    scope: AuthorizedSpace,
  ): Promise<z.infer<typeof WorkingHoursViewSchema>>;
  abstract write(
    scope: AuthorizedSpace,
    revision: number,
    value: WorkingHours | null,
  ): Promise<z.infer<typeof WorkingHoursViewSchema>>;
}
