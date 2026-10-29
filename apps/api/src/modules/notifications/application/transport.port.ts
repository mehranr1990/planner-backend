export type TransportMessage = {
  deliveryId: string;
  notificationId: string;
  channel: 'EMAIL' | 'WEB_PUSH';
  email?: string;
  subscription?: { endpoint: string; keys: { auth: string; p256dh: string } };
};
export type TransportResult = {
  outcome: 'ACCEPTED' | 'RETRY' | 'FAILED' | 'GONE' | 'AMBIGUOUS';
  code: string;
};
/** No private text enters external adapters. Transport errors never escape to queue storage. */
export abstract class NotificationTransport {
  abstract send(message: TransportMessage): Promise<TransportResult>;
}
