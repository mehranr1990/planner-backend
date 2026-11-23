import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminGuard } from './admin.guard.js';
import type { AdminService } from './admin.service.js';

describe('global admin default-deny boundary', () => {
  function fixture(path: string, permission?: string) {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'get').mockReturnValue(false);
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(permission);
    const authorize = vi.fn().mockResolvedValue({});
    const create = vi.fn().mockResolvedValue({});
    const admin = {
      authorize,
      auditDenial: create,
    } as unknown as AdminService;
    const context = {
      getHandler: () => () => {},
      getClass: () => AdminGuard,
      switchToHttp: () => ({
        getRequest: () => ({ path, headers: {}, id: 'request-id' }),
      }),
    } as unknown as ExecutionContext;
    return {
      guard: new AdminGuard(reflector, admin),
      context,
      authorize,
      create,
    };
  }
  it('denies missing metadata, including case-insensitive Express routes, and audits denial', async () => {
    const f = fixture('/API/v1/ADMIN/future-module');
    await expect(f.guard.canActivate(f.context)).rejects.toThrow('Forbidden');
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.create).toHaveBeenCalledWith('request-id');
  });
  it('invokes server authorization for an explicit permission', async () => {
    const f = fixture('/api/v1/admin/session', 'admin.session.read');
    expect(await f.guard.canActivate(f.context)).toBe(true);
    expect(f.authorize).toHaveBeenCalledWith({}, 'admin.session.read');
  });
  it('preserves ordinary API guards without interpreting workspace roles', async () => {
    const f = fixture('/api/v1/me');
    expect(await f.guard.canActivate(f.context)).toBe(true);
    expect(f.authorize).not.toHaveBeenCalled();
  });
});
