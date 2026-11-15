import { Inject, Injectable } from '@nestjs/common';
import { WorkingHoursViewSchema } from '@mehran/api-contracts';
import type { WorkingHours } from '@mehran/api-contracts';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { PlanningPreferences } from '../../account/public/index.js';
import { WorkingHoursPort } from '../application/working-hours.port.js';
@Injectable()
export class WorkingHoursRepository extends WorkingHoursPort {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PlanningPreferences) private readonly account: PlanningPreferences,
  ) {
    super();
  }
  private run(
    scope: AuthorizedSpace,
    update?: { revision: number; value: WorkingHours | null },
  ) {
    return this.db.client.$transaction(async (tx) => {
      await scope.fence(tx);
      if (update)
        await this.account.setWorkingHours(
          tx,
          scope,
          update.revision,
          update.value,
        );
      const prefs = await this.account.read(tx, scope);
      return WorkingHoursViewSchema.parse({
        revision: prefs.revision,
        timezone: prefs.timezone,
        firstDayOfWeek: prefs.firstDayOfWeek,
        workingHours: await this.account.workingHours(tx, scope),
      });
    });
  }
  read(scope: AuthorizedSpace) {
    return this.run(scope);
  }
  write(scope: AuthorizedSpace, revision: number, value: WorkingHours | null) {
    return this.run(scope, { revision, value });
  }
}
