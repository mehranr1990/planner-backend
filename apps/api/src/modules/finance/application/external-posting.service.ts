import {
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { FINANCE_REPOSITORY } from './finance.port.js';
import type { FinancePort, FinanceTransactionPort } from './finance.port.js';
import { LedgerService } from './ledger.service.js';
import { localDate } from '../domain/dates.js';
import {
  ExternalExpensePosting,
  type ExternalPostingInput,
} from '../public/external-posting.js';
/** Exact minor units to the account's decimal representation; no floating point. */
function decimal(minor: string, scale: number) {
  const digits = minor.padStart(scale + 1, '0');
  return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
}
/**
 * ADR 0061: Finance owns validation, the EXPENSE transaction and the source
 * link. One posting per source per Personal space; later Shared revisions never
 * rewrite or reverse it.
 */
@Injectable()
export class ExternalPostingService extends ExternalExpensePosting {
  constructor(
    @Inject(FINANCE_REPOSITORY) private readonly repo: FinancePort,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {
    super();
  }
  private async validate(
    tx: FinanceTransactionPort,
    input: ExternalPostingInput,
  ) {
    const account = await tx.get('account', input.accountId);
    if (account.archived)
      throw new UnprocessableEntityException({ code: 'ACCOUNT_ARCHIVED' });
    if (account.currency !== input.currency)
      throw new UnprocessableEntityException({ code: 'CURRENCY_MISMATCH' });
    if (input.categoryId) {
      const category = await tx.get('category', input.categoryId);
      if (category.kind !== 'EXPENSE' || category.archived)
        throw new UnprocessableEntityException({ code: 'CATEGORY_INVALID' });
    }
    return { account, amount: decimal(input.amountMinor, account.scale) };
  }
  preview(scope: AuthorizedSpace, input: ExternalPostingInput) {
    return this.repo.run(scope, async (tx) => {
      const { account, amount } = await this.validate(tx, input);
      return {
        accountId: account.id,
        accountName: account.name,
        currency: account.currency,
        amount,
        categoryId: input.categoryId,
        transactionType: 'EXPENSE' as const,
        // Finance owns the posting date: today in the owner's Finance time zone.
        localDate: localDate(new Date(), (await tx.preferences()).timezone),
        existing: await tx.externalPosting(input.source.kind, input.source.ref),
      };
    });
  }
  async post(scope: AuthorizedSpace, input: ExternalPostingInput) {
    const linked = await this.repo.run(scope, (tx) =>
      tx.externalPosting(input.source.kind, input.source.ref),
    );
    if (linked) return { transactionId: linked.transactionId, created: false };
    // Server-derived key: client retries and different keys converge on one source.
    const key = createHash('sha256')
      .update(`external:${input.source.kind}:${input.source.ref}`)
      .digest('hex');
    const result = await this.repo.once(
      scope,
      'post.finance.external',
      key,
      input,
      async (tx) => {
        const existing = await tx.externalPosting(
          input.source.kind,
          input.source.ref,
        );
        if (existing) return { id: existing.transactionId, created: false };
        const { amount } = await this.validate(tx, input);
        const posted = await this.ledger.postInside(tx, {
          type: 'EXPENSE',
          accountId: input.accountId,
          amount,
          categoryId: input.categoryId,
          note: input.note,
        });
        await tx.linkExternal(
          input.source.kind,
          input.source.ref,
          input.source.revisionRef,
          posted.id,
        );
        return { id: posted.id, created: true };
      },
    );
    return { transactionId: result.id, created: result.created };
  }
}
