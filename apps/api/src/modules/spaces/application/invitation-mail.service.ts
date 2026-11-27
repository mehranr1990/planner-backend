import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { symmetricEncrypt, symmetricDecrypt } from 'better-auth/crypto';
import type {
  Prisma,
  ContextInvitation,
} from '../../../generated/prisma/client.js';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import { IdentityMailService } from '../../../platform/auth/mail.service.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { SharedIdentity } from '../../../platform/auth/shared-identity.js';
import {
  invitationChannels,
  invitationQuietUntil,
} from '../../notifications/public/invitation-preferences.js';
import { personalNotificationOwner } from '../public/notification-audience.js';
import { enqueueInvitationPush } from '../../notifications/public/enqueue-invitation-push.js';

/** Post-commit delivery only. SMTP failure never grants admission or rolls back an offer. */
@Injectable()
export class InvitationMailService {
  encrypt(proof: string) {
    return symmetricEncrypt({
      key: this.config.BETTER_AUTH_SECRET,
      data: proof,
    });
  }
  decrypt(proof: string) {
    return symmetricDecrypt({
      key: this.config.BETTER_AUTH_SECRET,
      data: proof,
    });
  }
  recipient(email: string, tx = this.db.client as Prisma.TransactionClient) {
    return new SharedIdentity().byEmail(tx, email);
  }
  async notBefore(email: string) {
    const recipient = await this.recipient(email);
    return recipient?.emailVerified
      ? invitationQuietUntil(this.db.client, recipient.id, new Date())
      : new Date();
  }
  async queueAdmin(
    tx: Prisma.TransactionClient,
    auditId: string,
    id: string,
    email: string,
    userId: string | null,
    proof: string,
  ) {
    const encryptedProof = await symmetricEncrypt({
      key: this.config.BETTER_AUTH_SECRET,
      data: proof,
    });
    await tx.adminDelivery.create({
      data: {
        auditId,
        targetUserId: userId,
        recipientEmail: email,
        kind: 'INVITATION_LINK',
        payload: { invitationId: id, encryptedProof },
      },
    });
  }
  async deliverQueued(id: string, email: string, encryptedProof: string) {
    const proof = await symmetricDecrypt({
      key: this.config.BETTER_AUTH_SECRET,
      data: encryptedProof,
    });
    const row = await this.db.client.contextInvitation.findUnique({
      where: { id },
    });
    if (
      !row ||
      row.state !== 'PENDING' ||
      row.expiresAt <= new Date() ||
      row.proofHash !== createHash('sha256').update(proof).digest('hex')
    )
      return 'CANCELED';
    if (row.recipientEmail && row.recipientEmail !== email) return 'CANCELED';
    if (row.recipientUserId) {
      const user = await this.db.client.user.findUnique({
        where: { id: row.recipientUserId },
        select: { email: true, emailVerified: true },
      });
      if (!user?.emailVerified || user.email !== email) return 'CANCELED';
    }
    const state = await this.send(id, email, proof);
    await this.db.client.contextInvitation.updateMany({
      where: { id, state: 'PENDING', proofHash: row.proofHash },
      data: { emailDeliveryState: state },
    });
    return state === 'NONE' ? 'CANCELED' : state;
  }
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(IdentityMailService) private readonly mail: IdentityMailService,
    @Inject(DatabaseService) private readonly db: DatabaseService,
  ) {}
  async deliver(id: string, email: string | null, proof: string | null) {
    if (!email || !proof) return;
    // The offer already stores its encrypted proof in the creation transaction.
    // Legacy resend callers enqueue here; SMTP always runs in the worker.
    await this.db.client.contextInvitation.updateMany({
      where: {
        id,
        state: 'PENDING',
        proofHash: createHash('sha256').update(proof).digest('hex'),
      },
      data: {
        encryptedDeliveryProof: await this.encrypt(proof),
        deliveryAttempts: 0,
        deliveryNotBefore: new Date(),
      },
    });
  }
  async pendingContext() {
    return this.db.client.contextInvitation.findMany({
      where: {
        encryptedDeliveryProof: { not: null },
        state: 'PENDING',
        expiresAt: { gt: new Date() },
        deliveryAttempts: { lt: 5 },
        deliveryNotBefore: { lte: new Date() },
      },
      take: 10,
      orderBy: { deliveryNotBefore: 'asc' },
    });
  }
  async consumeContext(
    validate: (row: ContextInvitation, proof: string) => Promise<unknown>,
  ) {
    const rows = await this.pendingContext();
    for (const row of rows) {
      const claimed = await this.db.client.contextInvitation.updateMany({
        where: {
          id: row.id,
          state: 'PENDING',
          proofHash: row.proofHash,
          encryptedDeliveryProof: row.encryptedDeliveryProof,
          deliveryAttempts: row.deliveryAttempts,
          deliveryNotBefore: { lte: new Date() },
        },
        data: {
          deliveryAttempts: { increment: 1 },
          deliveryNotBefore: new Date(Date.now() + 300000),
        },
      });
      if (!claimed.count) continue;
      let state = 'FAILED';
      try {
        const proof = await this.decrypt(row.encryptedDeliveryProof!);
        await validate(row, proof);
        const recipient = row.recipientUserId
          ? await new SharedIdentity().current(
              this.db.client,
              row.recipientUserId,
            )
          : row.recipientEmail
            ? await this.recipient(row.recipientEmail)
            : null;
        const email =
          row.recipientEmail ??
          (recipient?.emailVerified ? recipient.email : null);
        if (recipient?.emailVerified)
          await this.db.client.$transaction(async (tx) => {
            const current = await tx.contextInvitation.findFirst({
              where: {
                id: row.id,
                state: 'PENDING',
                proofHash: row.proofHash,
                expiresAt: { gt: new Date() },
              },
            });
            if (current)
              await enqueueInvitationPush(
                tx,
                recipient.id,
                await this.contextModule(row.id, tx),
                { contextInvitationId: row.id },
                row.createdAt,
              );
          });
        if (email) {
          const notBefore = await this.notBefore(email);
          if (notBefore.getTime() > Date.now()) {
            await this.db.client.contextInvitation.updateMany({
              where: {
                id: row.id,
                proofHash: row.proofHash,
                deliveryAttempts: row.deliveryAttempts + 1,
              },
              data: {
                deliveryNotBefore: notBefore,
                deliveryAttempts: { decrement: 1 },
              },
            });
            continue;
          }
          state = await this.send(row.id, email, proof);
        }
      } catch {
        /* Retry bounded delivery without logging private offer/proof content. */
      }
      await this.db.client.contextInvitation.updateMany({
        where: {
          id: row.id,
          proofHash: row.proofHash,
          deliveryAttempts: row.deliveryAttempts + 1,
          encryptedDeliveryProof: row.encryptedDeliveryProof,
        },
        data: {
          emailDeliveryState: state,
          encryptedDeliveryProof:
            state === 'FAILED' && row.deliveryAttempts < 4
              ? row.encryptedDeliveryProof
              : null,
          deliveryNotBefore: new Date(
            Date.now() + 60000 * 2 ** row.deliveryAttempts,
          ),
        },
      });
    }
    return rows.length > 0;
  }
  async send(
    id: string,
    email: string,
    proof: string,
    kind?: 'CONVERSATION' | 'MEETING',
  ) {
    const identity = new SharedIdentity();
    const recipient = await identity.byEmail(this.db.client, email);
    if (recipient?.emailVerified) {
      if (!(await personalNotificationOwner(this.db.client, recipient.id)))
        return 'NONE';
      const module = kind ? 'MESSAGING_MEETINGS' : await this.contextModule(id);
      if (
        !this.config.NOTIFICATION_EMAIL_ENABLED ||
        !(await invitationChannels(this.db.client, recipient.id, module)).email
      )
        return 'NONE';
    }
    let state = 'UNAVAILABLE';
    if (this.config.INVITATION_ACCEPT_URL) {
      const url = new URL(this.config.INVITATION_ACCEPT_URL);
      if (
        url.protocol === 'https:' ||
        (this.config.NODE_ENV !== 'production' && url.protocol === 'http:')
      ) {
        url.hash = new URLSearchParams({
          id,
          proof,
          ...(kind ? { kind } : {}),
        }).toString();
        try {
          await this.mail.send({
            metadata: {
              sourceKind:
                kind === 'CONVERSATION'
                  ? 'CONVERSATION_INVITATION'
                  : kind === 'MEETING'
                    ? 'MEETING_INVITATION'
                    : 'CONTEXT_INVITATION',
              sourceId: id,
              category:
                kind === 'CONVERSATION'
                  ? 'CONVERSATION_INVITATION'
                  : kind === 'MEETING'
                    ? 'MEETING_INVITATION'
                    : (
                        {
                          PROJECTS: 'PROJECT_INVITATION',
                          TEAMS: 'TEAM_INVITATION',
                          COMPANY: 'COMPANY_INVITATION',
                          SOCIAL: 'SOCIAL_GROUP_INVITATION',
                        } as const
                      )[await this.contextModule(id)],
              ...(recipient ? { userId: recipient.id } : {}),
            },
            to: email,
            kind: 'invitation',
            url: url.toString(),
          });
          state = 'SENT';
        } catch {
          state = 'FAILED';
        }
      }
    }
    return state;
  }
  private async contextModule(
    id: string,
    tx: Prisma.TransactionClient = this.db.client,
  ) {
    const offer = await tx.contextInvitation.findUniqueOrThrow({
      where: { id },
      select: { scopeId: true, companyScopeId: true },
    });
    if (offer.companyScopeId) return 'COMPANY' as const;
    const domain = await tx.domainScopeCustody.findUnique({
      where: { scopeId: offer.scopeId },
      select: { kind: true },
    });
    const scope =
      domain ??
      (await tx.sharedCustody.findUniqueOrThrow({
        where: { spaceId: offer.scopeId },
        select: { kind: true },
      }));
    if (!['PROJECT', 'TEAM', 'SOCIAL_GROUP'].includes(scope.kind))
      throw new Error('Unsupported invitation context');
    return scope.kind === 'PROJECT'
      ? ('PROJECTS' as const)
      : scope.kind === 'TEAM'
        ? ('TEAMS' as const)
        : ('SOCIAL' as const);
  }
}
