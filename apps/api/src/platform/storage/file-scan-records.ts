import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, StoredFile } from '../../generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import type { FileEvidence, ReadExpectation } from './storage.port.js';

type Client = Prisma.TransactionClient | DatabaseService['client'];

/** ADR 0068 persisted CLEAN verdicts. A verdict is trusted only while its hash
 * equals the file's current hash; storage re-verifies that hash on every read. */
@Injectable()
export class FileScanRecords {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  /** Records the upload-time verdict inside the caller's READY transaction. */
  async recordUpload(tx: Client, fileId: string, evidence: FileEvidence) {
    if (evidence.scan)
      await this.record(tx, fileId, evidence.sha256, evidence.scan.engine);
  }
  record(client: Client, fileId: string, sha256: string, engine: string) {
    const verdict = { sha256, engine, scannedAt: new Date() };
    return client.storedFileScan.upsert({
      where: { fileId },
      create: { fileId, ...verdict },
      update: verdict,
    });
  }
  async expectation(
    file: Pick<StoredFile, 'id' | 'actualSize' | 'sha256'>,
    client: Client = this.database.client,
  ): Promise<ReadExpectation> {
    const sha256 = file.sha256!,
      scan = await client.storedFileScan.findUnique({
        where: { fileId: file.id },
        select: { sha256: true },
      });
    return {
      size: file.actualSize!,
      sha256,
      verified: scan?.sha256 === sha256,
      // Outside the caller's transaction: a lost record only costs a rescan.
      onVerified: async (engine) => {
        await this.record(this.database.client, file.id, sha256, engine);
      },
    };
  }
}
