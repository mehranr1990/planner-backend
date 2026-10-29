import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../authorization/authorized-space.js';
import { UnprocessableEntityException } from '@nestjs/common';
/** Only source owners supply rows. The shared budget bounds the whole snapshot. */
export class ExportBudget {
  count = 0;
  bytes = 0;
  readonly sections: Record<string, unknown[]> = {};
  remaining() {
    return 100000 - this.count;
  }
  add(name: string, rows: unknown[]) {
    const encoded = JSON.stringify(rows, (_key, value: unknown) =>
      typeof value === 'bigint' ? String(value) : value,
    );
    this.count += rows.length;
    this.bytes += Buffer.byteLength(encoded);
    if (this.count > 100000 || this.bytes > 50 * 1024 * 1024)
      throw new UnprocessableEntityException({ code: 'EXPORT_LIMIT' });
    (this.sections[name] ??= []).push(...(JSON.parse(encoded) as unknown[]));
  }
  async collect<T, C>(
    name: string,
    page: (after: C | undefined) => Promise<T[]>,
    cursor: (row: T) => C,
  ) {
    let after: C | undefined;
    for (;;) {
      const rows = await page(after);
      if (!rows.length) {
        this.sections[name] ??= [];
        return;
      }
      this.add(name, rows);
      after = cursor(rows.at(-1)!);
    }
  }
}
/** Owner-scoped portability and confirmed-erasure commands, never generic ORM access. */
export abstract class PersonalData {
  detach(
    _tx: Prisma.TransactionClient,
    _scope: AuthorizedSpace,
  ): Promise<void> {
    return Promise.resolve();
  }
  suspend(
    _tx: Prisma.TransactionClient,
    _scope: AuthorizedSpace,
  ): Promise<void> {
    return Promise.resolve();
  }
  abstract snapshot(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    budget: ExportBudget,
  ): Promise<void>;
  abstract erase(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
  ): Promise<void>;
}
