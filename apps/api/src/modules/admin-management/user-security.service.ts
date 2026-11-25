import { Inject, Injectable } from '@nestjs/common';
import { AdminAccounts } from '../account/public/index.js';
import type { AccountChange } from '../account/public/index.js';
import { DatabaseService } from '../../platform/database/database.service.js';
import { AdminCommand } from '../../platform/admin/admin-command.js';
@Injectable()
export class UserSecurityService {
  constructor(
    @Inject(AdminAccounts) private readonly accounts: AdminAccounts,
    @Inject(DatabaseService) private readonly db: DatabaseService,
  ) {}
  sessions(id: string) {
    return this.accounts.sessions(id);
  }
  async mutate(
    command: AdminCommand,
    id: string,
    operation: string,
    input: AccountChange,
  ) {
    const expected =
      operation === 'revoke-sessions'
        ? 'admin.security.user_sessions.revoke'
        : operation === 'recovery'
          ? 'admin.security.user_recovery.initiate'
          : 'admin.security.user_login.restrict';
    command.require(expected);
    return this.db.client.$transaction((tx) =>
      command.execute(tx, async () => {
        const action =
          operation === 'block-login'
            ? 'suspend'
            : operation === 'unblock-login'
              ? 'reactivate'
              : operation === 'revoke-sessions' && input.sessionIds
                ? 'revoke-selected-sessions'
                : operation;
        const before = await this.accounts.detail(id, tx);
        const after = await this.accounts.change(tx, id, action, input);
        await command.recordChange(
          tx,
          { revision: before.revision, status: before.status },
          { revision: after.revision, status: after.status },
        );
        if (
          operation === 'recovery' ||
          operation === 'block-login' ||
          operation === 'unblock-login'
        )
          await tx.adminDelivery.create({
            data: {
              auditId: command.auditId,
              targetUserId: id,
              kind:
                operation === 'recovery'
                  ? 'PASSWORD_RECOVERY'
                  : 'ACCOUNT_CHANGED',
              payload: { reason: input.reason },
            },
          });
        return { id, revision: after.revision };
      }),
    );
  }
}
