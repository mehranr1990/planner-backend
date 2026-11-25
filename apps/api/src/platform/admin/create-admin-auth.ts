import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { twoFactor } from 'better-auth/plugins';
import { APIError } from 'better-auth/api';
import { AdminSecurityPolicySchema } from '@mehran/api-contracts';
import {
  SECURITY_POLICY_ID,
  defaultAdminSecurityPolicy,
} from './security-policy.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { trustedOrigins, type AppConfig } from '../../bootstrap/environment.js';

/** Separate Better Auth realm; never creates a Planner User or Space. */
export function createAdminAuth(config: AppConfig, client: PrismaClient) {
  const loginRule = async () => {
    const row = await client.adminSecurityPolicy.findUnique({
      where: { id: SECURITY_POLICY_ID },
    });
    return {
      window: 60,
      max: AdminSecurityPolicySchema.parse(
        row?.policy ?? defaultAdminSecurityPolicy,
      ).adminLoginMax,
    };
  };
  const admission = async (userId: string) => {
    const user = await client.adminUser.findUnique({ where: { id: userId } });
    if (
      !user?.active ||
      (user.signInBlockedUntil && user.signInBlockedUntil > new Date())
    )
      throw new APIError('FORBIDDEN', { message: 'Admin account unavailable' });
  };
  return betterAuth({
    appName: 'Mehran Platform Admin',
    baseURL: config.BETTER_AUTH_URL,
    basePath: '/api/v1/admin/auth',
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: trustedOrigins(config),
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            await admission(session.userId);
            return { data: session };
          },
          after: async (session) => {
            try {
              await admission(session.userId);
            } catch (error) {
              await client.adminSession.deleteMany({
                where: { userId: session.userId },
              });
              throw error;
            }
          },
        },
      },
    },
    database: prismaAdapter(client, {
      provider: 'postgresql',
      transaction: true,
    }),
    user: {
      modelName: 'AdminUser',
      additionalFields: {
        role: {
          type: 'string',
          required: true,
          defaultValue: 'SUPPORT',
          input: false,
        },
        active: {
          type: 'boolean',
          required: true,
          defaultValue: true,
          input: false,
        },
      },
    },
    session: {
      modelName: 'AdminSession',
      expiresIn: 3600,
      freshAge: 300,
      cookieCache: { enabled: false },
    },
    account: { modelName: 'AdminAccount', accountLinking: { enabled: false } },
    verification: { modelName: 'AdminVerification', storeInDatabase: true },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 16,
    },
    plugins: [
      twoFactor({
        issuer: 'Mehran Platform Admin',
        twoFactorTable: 'AdminTwoFactor',
        skipVerificationOnEnable: false,
      }),
    ],
    advanced: {
      database: { generateId: 'uuid' },
      cookiePrefix: 'mehran-admin',
      useSecureCookies: config.NODE_ENV === 'production',
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'strict',
        secure: config.NODE_ENV === 'production',
        path: '/api/v1/admin',
      },
      ipAddress: { ipAddressHeaders: ['x-mehran-client-ip'] },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      customRules: {
        '/sign-in/email': loginRule,
        '/two-factor/*': loginRule,
      },
    },
    logger: { disabled: true },
  });
}
