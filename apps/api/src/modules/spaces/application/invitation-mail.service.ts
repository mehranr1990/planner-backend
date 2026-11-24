import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { symmetricEncrypt, symmetricDecrypt } from 'better-auth/crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import { IdentityMailService } from '../../../platform/auth/mail.service.js';
import { DatabaseService } from '../../../platform/database/database.service.js';

/** Post-commit delivery only. SMTP failure never grants admission or rolls back an offer. */
@Injectable()
export class InvitationMailService {
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
    return state;
  }
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(IdentityMailService) private readonly mail: IdentityMailService,
    @Inject(DatabaseService) private readonly db: DatabaseService,
  ) {}
  async deliver(id: string, email: string | null, proof: string | null) {
    if (!email || !proof) return;
    const state = await this.send(id, email, proof);
    await this.db.client.contextInvitation.updateMany({
      where: {
        id,
        state: 'PENDING',
        proofHash: createHash('sha256').update(proof).digest('hex'),
      },
      data: { emailDeliveryState: state },
    });
  }
  async send(
    id: string,
    email: string,
    proof: string,
    kind?: 'CONVERSATION' | 'MEETING',
  ) {
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
}
