import { Inject, Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';

export type IdentityMail = {
  to: string;
  kind: 'verify-email' | 'reset-password' | 'confirm-email-change';
  url: string;
};

@Injectable()
export class IdentityMailService {
  private readonly messages: IdentityMail[] = [];
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async send(message: IdentityMail): Promise<void> {
    if (this.config.NODE_ENV === 'test') {
      this.messages.push(message);
      if (this.messages.length > 1000) this.messages.shift();
      return;
    }
    if (this.config.MAIL_MODE === 'sink') {
      const directory = path.resolve(this.config.MAIL_SINK_DIR);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(
        path.join(directory, `${randomUUID()}.json`),
        JSON.stringify(message, null, 2),
        { mode: 0o600, flag: 'wx' },
      );
      return;
    }
    const transport = nodemailer.createTransport({
      host: this.config.SMTP_HOST,
      port: this.config.SMTP_PORT,
      secure: this.config.SMTP_PORT === 465,
      requireTLS: true,
      auth: { user: this.config.SMTP_USER!, pass: this.config.SMTP_PASSWORD! },
      logger: false,
      debug: false,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
    });
    await transport.sendMail({
      from: this.config.MAIL_FROM,
      to: message.to,
      subject: `Mehran Planner: ${message.kind}`,
      text: `Complete the requested account action:\n${message.url}\nIf you did not request this, ignore this email.`,
    });
  }

  latestForTest(
    to: string,
    kind: IdentityMail['kind'],
  ): IdentityMail | undefined {
    if (this.config.NODE_ENV !== 'test')
      throw new Error('Test mailbox is unavailable outside tests');
    return this.messages.findLast(
      (message) => message.to === to && message.kind === kind,
    );
  }
}
