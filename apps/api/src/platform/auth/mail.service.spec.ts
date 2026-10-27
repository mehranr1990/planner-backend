import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { IdentityMailService } from './mail.service.js';
import { parseEnvironment } from '../../bootstrap/environment.js';

const { sendMail, createTransport } = vi.hoisted(() => ({
  sendMail: vi.fn().mockResolvedValue({}),
  createTransport: vi.fn(),
}));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: (...args: unknown[]) => {
      createTransport(...args);
      return { sendMail };
    },
  },
}));
const base = {
  DATABASE_URL: 'postgresql://localhost/unused_test',
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET:
    'mail-adapter-test-synthetic-secret-at-least-32-characters',
};
const message = {
  to: 'fixture@example.test',
  kind: 'verify-email' as const,
  url: 'http://localhost:3000/api/v1/auth/verify-email?token=test-only',
};

describe('identity email transport', () => {
  it('keeps test messages in a non-public in-memory sink', async () => {
    const service = new IdentityMailService(
      parseEnvironment({ ...base, NODE_ENV: 'test' }),
    );
    await service.send(message);
    expect(service.latestForTest(message.to, message.kind)).toEqual(message);
    expect(sendMail).not.toHaveBeenCalled();
  });
  it('writes development email into the ignored private sink', async () => {
    await mkdir('.tools', { recursive: true });
    const directory = await mkdtemp(
      path.resolve('.tools/mail-transport-test-'),
    );
    const service = new IdentityMailService(
      parseEnvironment({
        ...base,
        NODE_ENV: 'development',
        MAIL_SINK_DIR: directory,
      }),
    );
    await service.send(message);
    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    expect(
      JSON.parse(await readFile(path.join(directory, files[0]!), 'utf8')),
    ).toEqual(message);
    expect(() => service.latestForTest(message.to, message.kind)).toThrow(
      'unavailable outside tests',
    );
  });
  it('uses authenticated TLS SMTP with debug logging disabled in production', async () => {
    const service = new IdentityMailService(
      parseEnvironment({
        ...base,
        NODE_ENV: 'production',
        BETTER_AUTH_URL: 'https://api.example.invalid',
        MAIL_MODE: 'smtp',
        SMTP_HOST: 'smtp.example.invalid',
        SMTP_USER: 'fixture',
        SMTP_PASSWORD: 'fixture-only',
        MAIL_FROM: 'no-reply@example.invalid',
      }),
    );
    await service.send(message);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        requireTLS: true,
        logger: false,
        debug: false,
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: message.to,
        text: expect.stringContaining(message.url),
      }),
    );
  });
});
