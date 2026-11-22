import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import { IdentityMailService } from '../../../platform/auth/mail.service.js';
import { DatabaseService } from '../../../platform/database/database.service.js';

/** Post-commit delivery only. SMTP failure never grants admission or rolls back an offer. */
@Injectable()
export class InvitationMailService {
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
