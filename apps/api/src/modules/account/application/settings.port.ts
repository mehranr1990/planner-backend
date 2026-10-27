import type { SettingsPatch } from '@mehran/api-contracts';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
export const SETTINGS_REPOSITORY = Symbol('SETTINGS_REPOSITORY');
export type Preferences = {
  locale: string;
  timezone: string;
  preferredCalendar: string;
  firstDayOfWeek: number;
  revision: number;
};
export interface SettingsPort {
  forUser(userId: string): Promise<Preferences>;
  update(
    scope: AuthorizedSpace,
    data: SettingsPatch,
    revision: number | undefined,
  ): Promise<Preferences>;
}
