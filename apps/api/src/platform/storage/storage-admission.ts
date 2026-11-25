import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { StoragePolicySchema } from '@mehran/api-contracts';
import { DatabaseService } from '../database/database.service.js';
@Injectable()
export class StorageAdmission {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async check(freeBytes: bigint) {
    const row = await this.db.client.adminOperationalPolicy.findUniqueOrThrow({
      where: { section: 'STORAGE' },
    });
    const policy = StoragePolicySchema.parse(row.value);
    if (freeBytes >= BigInt(policy.minimumFreeBytes)) {
      await this.db.client.adminStoragePressure.deleteMany({
        where: { id: 'storage' },
      });
      return;
    }
    const pressure = await this.db.client.adminStoragePressure.upsert({
      where: { id: 'storage' },
      create: { id: 'storage' },
      update: {},
    });
    if (
      policy.mode === 'BLOCK' ||
      (policy.mode === 'GRACE' &&
        Date.now() - +pressure.since >= policy.graceMinutes * 60000)
    )
      throw new ServiceUnavailableException({
        code: 'STORAGE_CAPACITY_BLOCKED',
      });
  }
}
