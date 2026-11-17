import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
/** ADR 0061: explicit, idempotent posting of an external amount the user owns. */
export type ExternalPostingInput = {
  source: {
    kind: 'SOCIAL_EXPENSE_SHARE';
    ref: string;
    revisionRef: string;
  };
  accountId: string;
  categoryId: string | null;
  currency: string;
  amountMinor: string;
  note: string;
};
export type ExternalPostingPreview = {
  accountId: string;
  accountName: string;
  currency: string;
  amount: string;
  categoryId: string | null;
  transactionType: 'EXPENSE';
  localDate: string;
  existing: { transactionId: string; sourceRevisionRef: string | null } | null;
};
export abstract class ExternalExpensePosting {
  abstract preview(
    scope: AuthorizedSpace,
    input: ExternalPostingInput,
  ): Promise<ExternalPostingPreview>;
  abstract post(
    scope: AuthorizedSpace,
    input: ExternalPostingInput,
  ): Promise<{ transactionId: string; created: boolean }>;
}
