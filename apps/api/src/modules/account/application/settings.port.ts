import type { SettingsPatch } from '@mehran/api-contracts';
export const SETTINGS_REPOSITORY = Symbol('SETTINGS_REPOSITORY');
export type Preferences = {
  locale: string;
  timezone: string;
  preferredCalendar: string;
  firstDayOfWeek: number;
};
export interface SettingsPort {
  forUser(userId: string): Promise<Preferences>;
  update(userId: string, data: SettingsPatch): Promise<Preferences>;
}
