import { Inject, Injectable } from '@nestjs/common';
import type { SettingsPatch } from '@mehran/api-contracts';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { SettingsPort } from '../application/settings.port.js';

@Injectable()
export class SettingsRepository implements SettingsPort {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  forUser(userId: string) {
    return this.database.client.$transaction(async (tx) => {
      await tx.userSettings.createMany({
        data: [{ userId }],
        skipDuplicates: true,
      });
      return tx.userSettings.findUniqueOrThrow({ where: { userId } });
    });
  }
  update(userId: string, data: SettingsPatch) {
    return this.database.client.userSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }
}
