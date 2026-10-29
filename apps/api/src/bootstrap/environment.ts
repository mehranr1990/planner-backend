import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createECDH } from 'node:crypto';

const DatabaseUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ['postgres:', 'postgresql:'].includes(url.protocol) &&
        url.pathname.length > 1
      );
    } catch {
      return false;
    }
  });
const EnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: DatabaseUrlSchema,
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DB_HEALTH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(10000)
    .default(2000),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .refine((value) => !value.startsWith('REPLACE_')),
  BETTER_AUTH_URL: z
    .string()
    .url()
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          url.origin === value &&
          !url.username &&
          !url.password
        );
      } catch {
        return false;
      }
    }),
  CORS_ORIGINS: z.string().default(''),
  MAIL_MODE: z.enum(['sink', 'smtp']).default('sink'),
  MAIL_SINK_DIR: z.string().min(1).default('.tools/mail'),
  MAIL_FROM: z.string().email().default('no-reply@localhost.invalid'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  STORAGE_ROOT: z.string().min(1).default('.tools/private-files'),
  FILE_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(104857600)
    .default(10485760),
  FILE_UPLOAD_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(300000)
    .default(120000),
  FILE_UPLOAD_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(600)
    .max(86400)
    .default(3600),
  JOBS_SCHEMA: z
    .string()
    .regex(/^planner_jobs(?:_test_[a-f0-9]{32})?$/)
    .default('planner_jobs'),
  JOBS_POLL_SECONDS: z.coerce.number().int().min(1).max(30).default(1),
  NOTIFICATION_EMAIL_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  NOTIFICATION_SINK_DIR: z.string().min(1).default('.tools/notifications'),
  PUSH_MODE: z.enum(['disabled', 'sink', 'webpush']).default('disabled'),
  PUSH_VAPID_PUBLIC_KEY: z.string().optional(),
  PUSH_VAPID_PRIVATE_KEY: z.string().optional(),
  PUSH_VAPID_SUBJECT: z.string().optional(),
  FILE_LINK_TTL_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
});
export type AppConfig = Readonly<z.infer<typeof EnvironmentSchema>>;

export function parseEnvironment(environment: NodeJS.ProcessEnv): AppConfig {
  const result = EnvironmentSchema.safeParse(environment);
  if (!result.success) {
    const keys = [
      ...new Set(result.error.issues.map((issue) => issue.path.join('.'))),
    ];
    // Never include Zod's raw input, URLs, passwords or issue messages.
    throw new Error(
      `Invalid configuration: ${keys.join(', ')}. See .env.example.`,
    );
  }
  const config = result.data;
  if (
    config.NODE_ENV === 'production' &&
    (config.PUSH_MODE === 'sink' || config.JOBS_SCHEMA !== 'planner_jobs')
  )
    throw new Error(
      'Invalid configuration: PUSH_MODE/JOBS_SCHEMA test settings forbidden in production.',
    );
  if (
    config.PUSH_MODE === 'webpush' &&
    (!/^[A-Za-z0-9_-]{87}$/.test(config.PUSH_VAPID_PUBLIC_KEY ?? '') ||
      !/^[A-Za-z0-9_-]{43}$/.test(config.PUSH_VAPID_PRIVATE_KEY ?? '') ||
      !config.PUSH_VAPID_SUBJECT ||
      !/^(?:mailto:[^@\s]+@[^@\s]+|https:\/\/[^\s]+)$/.test(
        config.PUSH_VAPID_SUBJECT,
      ))
  )
    throw new Error(
      'Invalid configuration: PUSH_VAPID keys/subject required for webpush.',
    );
  if (config.PUSH_MODE === 'webpush') {
    try {
      const key = createECDH('prime256v1');
      key.setPrivateKey(
        Buffer.from(config.PUSH_VAPID_PRIVATE_KEY!, 'base64url'),
      );
      if (
        key.getPublicKey().toString('base64url') !==
        config.PUSH_VAPID_PUBLIC_KEY
      )
        throw new Error();
      const subject = new URL(config.PUSH_VAPID_SUBJECT!);
      if (subject.username || subject.password || subject.hash)
        throw new Error();
    } catch {
      throw new Error('Invalid configuration: PUSH_VAPID key pair/subject.');
    }
  }
  // Source and compiled bootstrap have the same workspace depth. Relative local
  // roots must not move when pnpm dev changes cwd to apps/api.
  const storageRoot = path.resolve(
    fileURLToPath(new URL('../../../../', import.meta.url)),
    config.STORAGE_ROOT,
  );
  if (
    storageRoot === path.parse(storageRoot).root ||
    (config.NODE_ENV === 'production' && !path.isAbsolute(config.STORAGE_ROOT))
  )
    throw new Error(
      'Invalid configuration: STORAGE_ROOT must be a private directory (absolute in production).',
    );
  const origins = config.CORS_ORIGINS.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    origins.some((value) => {
      try {
        const url = new URL(value);
        return (
          url.origin !== value || !['http:', 'https:'].includes(url.protocol)
        );
      } catch {
        return true;
      }
    })
  )
    throw new Error('Invalid configuration: CORS_ORIGINS. See .env.example.');
  if (
    config.NODE_ENV === 'production' &&
    (!config.BETTER_AUTH_URL.startsWith('https:') ||
      origins.some((value) => !value.startsWith('https:')) ||
      config.MAIL_MODE !== 'smtp')
  )
    throw new Error(
      'Invalid configuration: production requires HTTPS origins and SMTP. See .env.example.',
    );
  if (
    config.MAIL_MODE === 'smtp' &&
    (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASSWORD)
  )
    throw new Error(
      'Invalid configuration: SMTP_HOST, SMTP_USER, SMTP_PASSWORD. See .env.example.',
    );
  return Object.freeze({ ...result.data, STORAGE_ROOT: storageRoot });
}

export function trustedOrigins(config: AppConfig): string[] {
  return [
    config.BETTER_AUTH_URL,
    ...config.CORS_ORIGINS.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ];
}
