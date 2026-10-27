import { Inject, Injectable } from '@nestjs/common';
import { ProfileSchema, SettingsSchema } from '@mehran/api-contracts';
import type { SettingsPatch } from '@mehran/api-contracts';
import type { VerifiedIdentity } from '../../../platform/auth/identity.js';
import { SETTINGS_REPOSITORY } from './settings.port.js';
import type { SettingsPort } from './settings.port.js';

@Injectable()
export class AccountService {
  constructor(
    @Inject(SETTINGS_REPOSITORY) private readonly settings: SettingsPort,
  ) {}
  profile(identity: VerifiedIdentity) {
    return ProfileSchema.parse({
      id: identity.id,
      name: identity.name,
      email: identity.email,
      emailVerified: identity.emailVerified,
      image: identity.image ?? null,
      createdAt: identity.createdAt.toISOString(),
      updatedAt: identity.updatedAt.toISOString(),
    });
  }
  async preferences(userId: string) {
    return this.mapSettings(await this.settings.forUser(userId));
  }
  async updatePreferences(userId: string, patch: SettingsPatch) {
    return this.mapSettings(await this.settings.update(userId, patch));
  }
  private mapSettings(value: {
    locale: string;
    timezone: string;
    preferredCalendar: string;
    firstDayOfWeek: number;
  }) {
    return SettingsSchema.parse({
      locale: value.locale,
      timezone: value.timezone,
      preferredCalendar: value.preferredCalendar,
      firstDayOfWeek: value.firstDayOfWeek,
    });
  }
}
