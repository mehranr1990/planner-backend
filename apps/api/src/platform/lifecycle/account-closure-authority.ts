import { ForbiddenException } from '@nestjs/common';
import type { AdminCommand } from '../admin/admin-command.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../authorization/authorized-space.js';
/** A transaction-local Administrative closure capability, never a Planner actor/session. */
export class AccountClosureAuthority {
  private constructor(
    readonly ownerUserId: string,
    readonly spaceId: string,
    readonly initiatorAdminId: string,
    readonly requestId: string,
    private readonly transaction: Prisma.TransactionClient,
    private readonly command: AdminCommand,
  ) {}
  static async issue(
    tx: Prisma.TransactionClient,
    command: AdminCommand,
    ownerUserId: string,
    spaceId: string,
  ) {
    command.require('admin.privacy.accounts.delete');
    await command.verify(tx);
    return new AccountClosureAuthority(
      ownerUserId,
      spaceId,
      command.adminId,
      command.requestId,
      tx,
      command,
    );
  }
  async verify(tx: Prisma.TransactionClient) {
    if (tx !== this.transaction) throw new ForbiddenException();
    await this.command.verify(tx);
  }
}
export type PersonalSuspensionScope = AuthorizedSpace | AccountClosureAuthority;
export async function suspensionOwner(
  tx: Prisma.TransactionClient,
  scope: PersonalSuspensionScope,
) {
  if (scope instanceof AccountClosureAuthority) {
    await scope.verify(tx);
    return scope.ownerUserId;
  }
  return scope.actor.userId;
}
