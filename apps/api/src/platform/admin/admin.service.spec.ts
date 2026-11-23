import { describe, expect, it, vi } from 'vitest';
import { AdminService } from './admin.service.js';
import type { DatabaseService } from '../database/database.service.js';
import type { AppConfig } from '../../bootstrap/environment.js';

describe('admin authoritative session checks', () => {
  it('denies a provider snapshot when revocation commits during identity loading', async () => {
    let signalLoading!: () => void, resume!: () => void;
    const loading = new Promise<void>((resolve) => {
      signalLoading = resolve;
    });
    const resumed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const user = {
      id: 'admin',
      active: true,
      twoFactorEnabled: true,
      mfaEnrolledAt: new Date(0),
    };
    let revoked = false;
    const database = {
      client: {
        adminUser: {
          findUnique: async () => {
            signalLoading();
            await resumed;
            return user;
          },
        },
        adminSession: {
          findUnique: async () =>
            revoked
              ? null
              : {
                  id: 'session',
                  expiresAt: new Date(Date.now() + 60000),
                  createdAt: new Date(1),
                  mfaVerifiedAt: new Date(2),
                },
        },
      },
    } as unknown as DatabaseService;
    const service = new AdminService({} as AppConfig, database);
    vi.spyOn(service, 'auth', 'get').mockReturnValue({
      api: {
        getSession: async () => ({
          user: { id: 'admin' },
          session: { id: 'session' },
        }),
      },
    } as unknown as AdminService['auth']);
    const pending = service.session({});
    await loading;
    revoked = true;
    resume();
    await expect(pending).rejects.toThrow('Unauthorized');
  });
});
