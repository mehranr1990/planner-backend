import { z } from 'zod';
export const CommunicationEmailInviteSchema = z.strictObject({
  id: z.uuid(),
  email: z.email().max(320),
});
export const CommunicationEmailOfferSchema = z.strictObject({
  id: z.uuid(),
  state: z.enum(['PENDING', 'CLAIMED', 'EXPIRED', 'REVOKED']),
  revision: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
});
export const CommunicationEmailEmptySchema = z.strictObject({});
