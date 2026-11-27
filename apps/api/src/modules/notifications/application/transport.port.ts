import type { EmailMetadata } from '../../../platform/auth/email-evidence.js';
export type TransportMessage = {
  emailMetadata?: EmailMetadata;
  deliveryId: string;
  notificationId: string;
  channel: 'EMAIL' | 'WEB_PUSH';
  purpose?: 'MESSAGING' | 'INVITATION' | 'ADMIN';
  content?: { subject: string; text: string };
  email?: string;
  subscription?: { endpoint: string; keys: { auth: string; p256dh: string } };
};
export type TransportResult = {
  outcome: 'ACCEPTED' | 'RETRY' | 'FAILED' | 'GONE' | 'AMBIGUOUS';
  code: string;
  providerReference?: string | undefined;
};
/** No private text enters external adapters. Transport errors never escape to queue storage. */
export abstract class NotificationTransport {
  abstract send(message: TransportMessage): Promise<TransportResult>;
}
