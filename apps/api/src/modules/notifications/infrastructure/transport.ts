import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ECDH, createHash } from 'node:crypto';
import { Agent } from 'node:https';
import { lookup } from 'node:dns';
import { isIP } from 'node:net';
import nodemailer from 'nodemailer';
import webpush from 'web-push';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import { NotificationTransport } from '../application/transport.port.js';
import type {
  TransportMessage,
  TransportResult,
} from '../application/transport.port.js';
const providers = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
];
export function safeEndpoint(value: string) {
  try {
    const u = new URL(value);
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.hash ||
      (u.port && u.port !== '443') ||
      isIP(u.hostname) ||
      !(
        providers.includes(u.hostname) ||
        /^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname)
      )
    )
      return null;
    return {
      endpoint: u.href,
      host: u.hostname,
      hash: createHash('sha256').update(u.href).digest('hex'),
    };
  } catch {
    return null;
  }
}
export function validPushKeys(keys: { auth: string; p256dh: string }) {
  try {
    const auth = Buffer.from(keys.auth, 'base64url'),
      pub = Buffer.from(keys.p256dh, 'base64url');
    return (
      auth.length === 16 &&
      pub.length === 65 &&
      auth.toString('base64url') === keys.auth &&
      pub.toString('base64url') === keys.p256dh &&
      Buffer.from(
        ECDH.convertKey(
          pub,
          'prime256v1',
          undefined,
          undefined,
          'uncompressed',
        ),
      ).equals(pub)
    );
  } catch {
    return false;
  }
}
export function publicAddress(address: string) {
  if (isIP(address) === 4) {
    const p = address.split('.').map(Number);
    return (
      p[0] !== 0 &&
      p[0] !== 10 &&
      p[0] !== 127 &&
      !(p[0] === 169 && p[1] === 254) &&
      !(p[0] === 192 && (p[1] === 168 || (p[1] === 0 && p[2] === 0))) &&
      !(p[0] === 172 && p[1]! >= 16 && p[1]! <= 31) &&
      p[0]! < 224 &&
      !(p[0] === 100 && p[1]! >= 64 && p[1]! <= 127) &&
      !(p[0] === 198 && (p[1] === 18 || p[1] === 19))
    );
  }
  return (
    isIP(address) === 6 &&
    /^2[0-9a-f]{3}:/i.test(address) &&
    !/^2002:|^2001:(?:0|0000|db8):/i.test(address)
  );
}
@Injectable()
export class ChannelTransport extends NotificationTransport {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }
  async send(m: TransportMessage): Promise<TransportResult> {
    const sink =
      m.channel === 'EMAIL'
        ? this.config.MAIL_MODE === 'sink'
        : this.config.PUSH_MODE === 'sink';
    if (sink) {
      if (this.config.NODE_ENV === 'production')
        return { outcome: 'FAILED', code: 'SINK_FORBIDDEN' };
      const root = path.resolve(
        fileURLToPath(new URL('../../../../../../', import.meta.url)),
        this.config.NOTIFICATION_SINK_DIR,
      );
      await fs.mkdir(root, { recursive: true });
      try {
        await fs.writeFile(
          path.join(root, m.deliveryId + '.json'),
          JSON.stringify({
            deliveryId: m.deliveryId,
            notificationId: m.notificationId,
            channel: m.channel,
            text: 'Mehran Planner has a reminder for you.',
          }),
          { flag: 'wx', mode: 0o600 },
        );
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'EEXIST'
        ))
          return { outcome: 'RETRY', code: 'SINK_UNAVAILABLE' };
      }
      return { outcome: 'ACCEPTED', code: 'SINK_ACCEPTED' };
    }
    if (m.channel === 'EMAIL') {
      if (!m.email || !this.config.NOTIFICATION_EMAIL_ENABLED)
        return { outcome: 'FAILED', code: 'EMAIL_DISABLED' };
      const transport = nodemailer.createTransport({
        host: this.config.SMTP_HOST,
        port: this.config.SMTP_PORT,
        secure: this.config.SMTP_PORT === 465,
        requireTLS: true,
        auth: { user: this.config.SMTP_USER, pass: this.config.SMTP_PASSWORD },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
      });
      try {
        await transport.sendMail({
          from: this.config.MAIL_FROM,
          to: m.email,
          subject: 'Mehran Planner reminder',
          text: 'Mehran Planner has a reminder for you. Open your private notification inbox.',
          messageId: '<' + m.deliveryId + '@planner.invalid>',
        });
        return { outcome: 'ACCEPTED', code: 'SMTP_ACCEPTED' };
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'responseCode' in error
            ? Number(error.responseCode)
            : 0;
        return code >= 500
          ? { outcome: 'FAILED', code: 'SMTP_REJECTED' }
          : code >= 400
            ? { outcome: 'RETRY', code: 'SMTP_TEMPORARY' }
            : { outcome: 'AMBIGUOUS', code: 'SMTP_ACCEPTANCE_UNKNOWN' };
      } finally {
        transport.close();
      }
    }
    if (
      this.config.PUSH_MODE !== 'webpush' ||
      !m.subscription ||
      !safeEndpoint(m.subscription.endpoint) ||
      !validPushKeys(m.subscription.keys)
    )
      return { outcome: 'FAILED', code: 'PUSH_UNAVAILABLE' };
    const agent = new Agent({
      keepAlive: false,
      lookup: (host, options, callback) => {
        lookup(host, { ...options, all: true }, (error, addresses) => {
          if (
            error ||
            addresses.length === 0 ||
            addresses.some((a) => !publicAddress(a.address))
          ) {
            callback(new Error('PUSH_DNS_REJECTED'), []);
            return;
          }
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0]!.address, addresses[0]!.family);
        });
      },
    });
    const deadline = setTimeout(() => agent.destroy(), 10000);
    deadline.unref();
    try {
      await webpush.sendNotification(
        m.subscription,
        JSON.stringify({
          title: 'Mehran Planner',
          body: 'You have a reminder.',
          notificationId: m.notificationId,
          tag: m.notificationId,
        }),
        {
          TTL: 300,
          urgency: 'normal',
          topic: createHash('sha256')
            .update(m.deliveryId)
            .digest('base64url')
            .slice(0, 32),
          timeout: 10000,
          agent,
          vapidDetails: {
            subject: this.config.PUSH_VAPID_SUBJECT!,
            publicKey: this.config.PUSH_VAPID_PUBLIC_KEY!,
            privateKey: this.config.PUSH_VAPID_PRIVATE_KEY!,
          },
        },
      );
      return { outcome: 'ACCEPTED', code: 'PUSH_ACCEPTED' };
    } catch (error) {
      const status =
        typeof error === 'object' && error !== null && 'statusCode' in error
          ? Number(error.statusCode)
          : 0;
      return status === 404 || status === 410
        ? { outcome: 'GONE', code: 'PUSH_GONE' }
        : status === 429 || status >= 500
          ? { outcome: 'RETRY', code: 'PUSH_TEMPORARY' }
          : status >= 400
            ? { outcome: 'FAILED', code: 'PUSH_REJECTED' }
            : { outcome: 'AMBIGUOUS', code: 'PUSH_ACCEPTANCE_UNKNOWN' };
    } finally {
      clearTimeout(deadline);
      agent.destroy();
    }
  }
}
