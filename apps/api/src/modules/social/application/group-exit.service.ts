import { Injectable, Inject, ConflictException } from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { AuthService } from '../../../platform/auth/auth.service.js';
import {
  SharedKernel,
  CollaborationService,
  SharedLifecycleService,
} from '../../spaces/public/index.js';
import { SocialGroupsService } from './groups.service.js';
import { SocialExpensesService } from './expenses.service.js';
import type { SocialObligation } from './expenses.service.js';
import { socialHash, socialRevision } from './social-context.js';
import type { Tx } from './social-context.js';
const leaveToken = (
  groupId: string,
  userId: string,
  revision: number,
  obligations: SocialObligation[],
) => socialHash(['social.group.leave', groupId, userId, revision, obligations]);
const deleteToken = (groupId: string, revision: number, rows: string[]) =>
  socialHash(['social.group.delete', groupId, revision, rows]);
const unconfirmed = () =>
  new ConflictException({ code: 'OUTSTANDING_BALANCE_CONFIRMATION_REQUIRED' });
/**
 * P6-06 (ADR 0066): Group departure with open balances, Owner deletion into the
 * shared 30-day recovery lifecycle, and Owner-only recovery. Confirmations are
 * re-derived under the custody lock, so a changed balance cannot be bypassed.
 * No debt blocking, collection, money movement or Personal Finance posting.
 */
@Injectable()
export class SocialGroupExitService {
  constructor(
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(CollaborationService)
    private readonly collaboration: CollaborationService,
    @Inject(SharedLifecycleService)
    private readonly lifecycle: SharedLifecycleService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SocialGroupsService) private readonly groups: SocialGroupsService,
    @Inject(SocialExpensesService)
    private readonly expenses: SocialExpensesService,
  ) {}
  async check(actor: RequestActor, id: string) {
    await this.groups.hint(id);
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [id] },
      [{ spaceId: id, scopeId: id, capability: 'task.read' }],
      async (tx, a) => {
        const access = a.require(tx, id, 'task.read'),
          seat = await tx.contextAccess.findUniqueOrThrow({
            where: { id: access.accessId },
          }),
          custody = await tx.sharedCustody.findUniqueOrThrow({
            where: { spaceId: id },
          });
        const obligations = await this.expenses.departureObligations(
          tx,
          id,
          actor.userId,
        );
        let deletion = null;
        if (custody.primaryOwnerAccessId === access.accessId) {
          const group = await tx.socialGroup.findUniqueOrThrow({
              where: { id },
            }),
            open = await this.expenses.groupOutstanding(tx, id);
          deletion = {
            groupRevision: group.revision,
            outstandingLedgerCount: open.ledgerCount,
            outstandingPartyCount: open.partyCount,
            confirmation: open.ledgerCount
              ? deleteToken(id, group.revision, open.fingerprint)
              : null,
          };
        }
        return c.SocialGroupExitCheckSchema.parse({
          groupId: id,
          membershipRevision: seat.revision,
          obligations,
          departureConfirmation: obligations.length
            ? leaveToken(id, actor.userId, seat.revision, obligations)
            : null,
          deletion,
        });
      },
    );
  }
  async leave(
    actor: RequestActor,
    id: string,
    revision: number,
    body: z.infer<typeof c.SocialGroupLeaveSchema> | undefined,
  ) {
    await this.groups.hint(id);
    return this.collaboration.leave(actor, id, revision, async (tx: Tx) => {
      const obligations = await this.expenses.departureObligations(
        tx,
        id,
        actor.userId,
      );
      if (
        obligations.length &&
        body?.outstandingBalanceConfirmation !==
          leaveToken(id, actor.userId, revision, obligations)
      )
        throw unconfirmed();
    });
  }
  async delete(
    actor: RequestActor,
    id: string,
    revision: number,
    body: z.infer<typeof c.SocialGroupDeleteSchema>,
  ) {
    await this.groups.hint(id);
    return this.kernel.socialGroupDelete(actor, id, async (tx) => {
      const row = await tx.socialGroup.findUniqueOrThrow({ where: { id } });
      socialRevision(revision, row.revision);
      await this.auth.verifyPasswordInside(tx, actor.userId, body.password);
      const open = await this.expenses.groupOutstanding(tx, id);
      if (
        open.ledgerCount &&
        body.outstandingBalanceConfirmation !==
          deleteToken(id, row.revision, open.fingerprint)
      )
        throw unconfirmed();
      const updated = await tx.socialGroup.update({
        where: { id },
        data: { revision: { increment: 1 } },
      });
      return c.SocialGroupLifecycleChangeSchema.parse({
        id,
        groupId: id,
        revision: updated.revision,
      });
    });
  }
  async job(actor: RequestActor, id: string) {
    await this.groups.hint(id);
    return this.lifecycle.status(actor, id, 'SOCIAL_GROUP');
  }
  async proof(
    actor: RequestActor,
    id: string,
    revision: number,
    password: string,
  ) {
    await this.groups.hint(id);
    return this.lifecycle.issueProof(
      actor,
      id,
      revision,
      password,
      'SOCIAL_GROUP',
    );
  }
  /** Restores only the primary Owner seat; former members need new admission. */
  async recover(
    actor: RequestActor,
    id: string,
    revision: number,
    generation: number,
    proof: string | undefined,
    password: string,
  ) {
    await this.groups.hint(id);
    return this.lifecycle.recover(
      actor,
      id,
      revision,
      generation,
      proof,
      password,
      async (tx, now) => {
        await tx.socialGroup.update({
          where: { id },
          data: { revision: { increment: 1 }, updatedAt: now },
        });
        await tx.accessScope.update({
          where: { id },
          data: { restoreGeneration: { increment: 1 } },
        });
      },
      'SOCIAL_GROUP',
    );
  }
}
