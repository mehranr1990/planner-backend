import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
/** ADR0016: only Capture may validate/finalize its expense source within the ledger transaction. */ export abstract class FinanceCaptures {
  abstract lock(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
  ): Promise<void>;
  abstract requireExpense(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    id: string,
    revision: number,
  ): Promise<void>;
  abstract finish(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    transactionId: string,
  ): Promise<{ revision: number }>;
}
