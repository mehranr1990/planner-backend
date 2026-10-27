import { z } from 'zod';

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
  return Object.freeze(result.data);
}
