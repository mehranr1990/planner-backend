import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
