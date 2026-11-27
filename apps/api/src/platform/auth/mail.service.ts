import { SystemEmailEvidence, smtpReceipt } from './email-evidence.js';
import type { EmailMetadata, EmailReceipt } from './email-evidence.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { Inject, Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';

export type IdentityMail = {
  metadata?: EmailMetadata;
  to: string;
  kind:
    | 'verify-email'
    | 'reset-password'
    | 'confirm-email-change'
    | 'invitation'
    | 'administrative';
  url: string;
  message?: string;
};

@Injectable()
export class IdentityMailService {
  private readonly messages: IdentityMail[] = [];
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SystemEmailEvidence) private readonly evidence: SystemEmailEvidence,
  ) {}

  async send(
    message: IdentityMail,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const category =
      message.kind === 'verify-email'
        ? 'REGISTRATION_VERIFICATION'
        : message.kind === 'reset-password'
          ? 'PASSWORD_RECOVERY'
          : message.kind === 'confirm-email-change'
            ? 'EMAIL_CHANGE_VERIFICATION'
            : 'SYSTEM_NOTICE';
    await this.evidence.observe(
      message.to,
      message.metadata ?? { category },
      () => this.deliver(message),
      tx,
    );
  }
  private async deliver(message: IdentityMail): Promise<EmailReceipt> {
    if (this.config.NODE_ENV === 'test') {
      this.messages.push(message);
      if (this.messages.length > 1000) this.messages.shift();
      return { state: 'SINK_ACCEPTED', code: 'SINK_ACCEPTED' };
    }
    if (this.config.MAIL_MODE === 'sink') {
      const directory = path.resolve(this.config.MAIL_SINK_DIR);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(
        path.join(directory, `${randomUUID()}.json`),
        JSON.stringify(message, null, 2),
        { mode: 0o600, flag: 'wx' },
      );
      return { state: 'SINK_ACCEPTED', code: 'SINK_ACCEPTED' };
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
    try {
      const info = await transport.sendMail({
        from: this.config.MAIL_FROM,
        to: message.to,
        subject: `Mehran Planner: ${message.kind}`,
        text:
          message.kind === 'administrative'
            ? `${message.message ?? 'An administrative event requires your attention.'}\n${message.url}`
            : message.kind === 'invitation'
              ? `You have been invited to Mehran Planner. Sign in or register with this email address, then explicitly accept. This invitation expires after seven days.\n${message.url}\nIf unexpected, ignore this email.`
              : `Complete the requested account action:\n${message.url}\nIf you did not request this, ignore this email.`,
      });
      if (Array.isArray(info.rejected) && info.rejected.length) {
        throw Object.assign(new Error('SMTP rejected'), { responseCode: 550 });
      }
      return smtpReceipt(info, message.to);
    } finally {
      transport.close();
    }
  }

  async check(): Promise<void> {
    if (this.config.NODE_ENV === 'test') return;
    if (this.config.MAIL_MODE === 'sink') {
      await mkdir(path.resolve(this.config.MAIL_SINK_DIR), {
        recursive: true,
        mode: 0o700,
      });
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
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
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
