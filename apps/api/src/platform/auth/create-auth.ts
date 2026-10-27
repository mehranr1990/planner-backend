import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { authSchemaOptions } from './auth-options.js';
import { trustedOrigins } from '../../bootstrap/environment.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import type { IdentityMail } from './mail.service.js';
import type { identityClient } from './identity-relations.js';

export function createIdentityAuth(
  config: AppConfig,
  client: ReturnType<typeof identityClient>,
  send: (message: IdentityMail) => Promise<void>,
  diagnostic: () => void,
) {
  const options: BetterAuthOptions = {
    ...authSchemaOptions,
    appName: 'Mehran Planner',
    baseURL: config.BETTER_AUTH_URL,
    basePath: '/api/v1/auth',
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: trustedOrigins(config),
    database: prismaAdapter(client, {
      provider: 'postgresql',
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        send({ to: user.email, url, kind: 'reset-password' }),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) =>
        send({ to: user.email, url, kind: 'verify-email' }),
      afterEmailVerification: async (user) => {
        // Library-managed revocation also forces reauthentication after an email change.
        await revokeUserSessions(user.id);
      },
    },
    user: {
      ...authSchemaOptions.user,
      changeEmail: {
        enabled: true,
        updateEmailWithoutVerification: false,
        sendChangeEmailConfirmation: async ({ user, url }) =>
          send({ to: user.email, url, kind: 'confirm-email-change' }),
      },
    },
    advanced: {
      ...authSchemaOptions.advanced,
      useSecureCookies: config.NODE_ENV === 'production',
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.NODE_ENV === 'production',
        path: '/',
      },
      ipAddress: { ipAddressHeaders: ['x-mehran-client-ip'] },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 10, max: 3 },
        '/request-password-reset': { window: 60, max: 3 },
        '/reset-password': { window: 60, max: 5 },
        '/send-verification-email': { window: 60, max: 3 },
        '/change-email': { window: 60, max: 3 },
        '/list-sessions': { window: 60, max: 20 },
        '/revoke-session': { window: 60, max: 20 },
      },
    },
    logger: { level: 'warn', log: () => diagnostic() },
  };
  const auth = betterAuth(options);
  const revokeUserSessions = async (userId: string): Promise<void> => {
    await (await auth.$context).internalAdapter.deleteUserSessions(userId);
  };
  return auth;
}
