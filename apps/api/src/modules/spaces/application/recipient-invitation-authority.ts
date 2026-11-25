import { ForbiddenException } from '@nestjs/common';
import type {
  ContextInvitation,
  Prisma,
} from '../../../generated/prisma/client.js';

const token = Symbol('validated recipient invitation');
type Target = Pick<
  ContextInvitation,
  'id' | 'spaceId' | 'scopeId' | 'companyScopeId'
>;

/** Issued only after current recipient authorization, valid in that transaction. */
export class RecipientInvitationAuthority {
  private readonly target: Readonly<Target>;
  constructor(
    authorization: symbol,
    private readonly tx: Prisma.TransactionClient,
    target: Target,
  ) {
    if (authorization !== token) throw new ForbiddenException();
    this.target = Object.freeze({
      id: target.id,
      spaceId: target.spaceId,
      scopeId: target.scopeId,
      companyScopeId: target.companyScopeId,
    });
  }
  require(tx: Prisma.TransactionClient): Readonly<Target> {
    if (tx !== this.tx) throw new ForbiddenException();
    return this.target;
  }
}

export function validatedRecipientInvitation(
  tx: Prisma.TransactionClient,
  row: Target,
) {
  return new RecipientInvitationAuthority(token, tx, row);
}
