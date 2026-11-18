import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { DatabaseService } from '../../../platform/database/database.service.js';
import type { SharedControl } from '../../../platform/storage/shared-control.js';
import { CollaborationLimit } from './collaboration-limit.js';
import { sharedRatePolicy } from '../domain/http-rate-policy.js';
import { sharedHttpRequest } from '../public/shared-http-request.js';

function fixture() {
  const counts = new Map<string, number>();
  const query = vi.fn(async (_sql: TemplateStringsArray, key: string) => {
    const requests = (counts.get(key) ?? 0) + 1;
    counts.set(key, requests);
    return [{ requests, reset: 17 }];
  });
  const limit = new CollaborationLimit(
    { client: { $queryRaw: query } } as unknown as DatabaseService,
    { opaqueRateKey: (s: string) => s } as SharedControl,
  );
  return { limit, counts, query };
}
const read = { method: 'GET', route: '/api/v1/projects/:id/tasks' };
const write = { ...read, method: 'POST' };

describe('Shared endpoint-aware request budgets', () => {
  it('supports realistic dashboards then rejects excessive reads', async () => {
    const { limit } = fixture();
    for (let n = 0; n < 600; n++) {
      const state = await limit.request('ip', 'alice', false, read);
      expect(state.remaining).toBe(599 - n);
    }
    await expect(
      limit.request('ip', 'alice', false, read),
    ).rejects.toMatchObject({
      state: { limit: 600, remaining: 0, reset: 17 },
    });
  });

  it('separates writes, modules and users; changing IP cannot reset a user budget', async () => {
    const { limit, counts } = fixture();
    for (let n = 0; n < 120; n++)
      await limit.request('nat', 'alice', false, write);
    await expect(
      limit.request('another-ip', 'alice', false, write),
    ).rejects.toThrow();
    const natCount = counts.get('http:v2:projects:write:ip:nat');
    await expect(limit.request('nat', 'alice', false, write)).rejects.toThrow();
    expect(counts.get('http:v2:projects:write:ip:nat')).toBe(natCount);
    await expect(
      limit.request('nat', 'bob', false, write),
    ).resolves.toBeDefined();
    expect(counts.get('http:v2:projects:write:actor:bob')).toBe(1);
    await expect(
      limit.request('nat', 'alice', false, read),
    ).resolves.toMatchObject({ remaining: 599 });
    await expect(
      limit.request('nat', 'alice', false, { method: 'POST', route: '/teams' }),
    ).resolves.toMatchObject({ remaining: 119 });
  });

  it('retains a finite IP ceiling across different users and independent IPs', async () => {
    const { limit } = fixture();
    for (let n = 0; n < 1200; n++)
      await limit.request('nat', 'actor-' + n, false, write);
    await expect(
      limit.request('nat', 'new-user', false, write),
    ).rejects.toMatchObject({ state: { limit: 1200, remaining: 0 } });
    await expect(
      limit.request('other-nat', 'other-user', false, write),
    ).resolves.toBeDefined();
  });

  it('retains actor/IP proof abuse limits and isolates them from normal reads', async () => {
    const { limit } = fixture();
    const sensitive = { method: 'POST', route: '/spaces/:spaceId/invitations' };
    for (let n = 0; n < 20; n++)
      await limit.request('nat', 'alice', false, sensitive);
    await expect(
      limit.request('nat', 'alice', false, sensitive),
    ).rejects.toMatchObject({ state: { limit: 20 } });
    await expect(
      limit.request('nat', 'alice', false, read),
    ).resolves.toBeDefined();
    const preview = { method: 'GET', route: '/invitations/preview' };
    for (let n = 0; n < 30; n++)
      await limit.request('anonymous', undefined, true, preview);
    await expect(
      limit.request('anonymous', undefined, true, preview),
    ).rejects.toMatchObject({ state: { limit: 30 } });
  });

  it('adds an endpoint cap that cannot be evaded by changing resource IDs', async () => {
    const { limit } = fixture();
    const expensive = { method: 'GET', route: '/projects/:id/reports/work' };
    for (let n = 0; n < 30; n++)
      await limit.request('nat', 'alice', false, expensive);
    await expect(
      limit.request('nat', 'alice', false, expensive),
    ).rejects.toMatchObject({ state: { limit: 30 } });
    await expect(
      limit.request('nat', 'alice', false, read),
    ).resolves.toBeDefined();
  });

  it.each([
    '/spaces/:id/ownership-handovers',
    '/teams/:id/memberships/:member',
    '/companies/:id/finance/approvals/:target/decision',
    '/social/discovery',
    '/conversations/:id/contact-block',
    '/meetings/:projectId/lifecycle-job',
    '/projects/:id/resource-grants',
    '/resource-invitations/preview',
    '/conversations/:id/members/:memberId',
    '/meetings/:id/restore-admission',
    '/companies/:id/contexts/:scopeId/policy',
    '/social-activities/:id/invitations',
    '/social-activities/:id/lifecycle/:action',
    '/social-activities/:id/expenses/:expenseId/decisions/:action',
    '/social-groups/:id/settlements/:settlementId/decisions/:action',
    '/social-activities/:id/succession',
    '/social-activities/:id/succession/:action',
    '/social-activities/:id/restore',
    '/social-loans/:id/actions/:action',
    '/social-lost-found/:id/actions/:action',
    '/social-lost-found/:id/claims',
    '/social-lost-found/:id/claims/:claimId/actions/:action',
    '/social-assets/:id/actions/:action',
  ])('keeps %s in the sensitive class', (route) => {
    expect(sharedRatePolicy({ method: 'POST', route }).actor).toBe(20);
  });

  it('treats Activity deletion as sensitive but ordinary edits as writes', () => {
    expect(
      sharedRatePolicy({ method: 'DELETE', route: '/social-activities/:id' })
        .actor,
    ).toBe(20);
    expect(
      sharedRatePolicy({ method: 'PATCH', route: '/social-activities/:id' })
        .actor,
    ).toBe(120);
  });
  it('keeps P6-02/P6-03 routes in the independent Social family', () => {
    for (const route of [
      '/social-activities/:id',
      '/social-activities/:id/rsvp',
      '/social-notices',
    ])
      expect(sharedRatePolicy({ method: 'POST', route }).family).toBe('social');
    expect(
      sharedRatePolicy({ method: 'POST', route: '/social-activities/:id/rsvp' })
        .actor,
    ).toBe(120);
    expect(
      sharedRatePolicy({
        method: 'GET',
        route: '/social-activities/:id/expenses/:expenseId',
      }).actor,
    ).toBe(600);
  });
  it('keeps P6-04 lending and Lost & Found in the Social family', () => {
    for (const route of [
      '/social-assets',
      '/social-loans/:id',
      '/social-lost-found/:id/evidence',
    ])
      expect(sharedRatePolicy({ method: 'POST', route })).toMatchObject({
        family: 'social',
        actor: 120,
      });
    expect(
      sharedRatePolicy({ method: 'GET', route: '/social-loans/:id/history' })
        .actor,
    ).toBe(600);
  });
  it('classifies P6-05 Social goal routes', () => {
    for (const route of ['/social-goals', '/social-goals/:id/entries'])
      expect(sharedRatePolicy({ method: 'POST', route })).toMatchObject({
        family: 'social',
        actor: 120,
      });
    for (const route of [
      '/social-goals/:id/actions/:action',
      '/social-goals/:id/entries/:entryId/actions/:action',
      '/social-goals/:id/corrections',
      '/social-goals/:id/join',
    ])
      expect(sharedRatePolicy({ method: 'POST', route })).toMatchObject({
        family: 'social',
        actor: 20,
      });
    expect(
      sharedRatePolicy({
        method: 'GET',
        route: '/social-goals/:id/participants',
      }).actor,
    ).toBe(600);
  });
  it('classifies P6-06 Social Group exit and recovery routes', () => {
    for (const route of [
      '/social-groups/:id/delete',
      '/social-groups/:id/leave',
      '/social-groups/:id/lifecycle-job/recovery-proof',
      '/social-groups/:id/lifecycle-job/recover',
    ])
      expect(sharedRatePolicy({ method: 'POST', route })).toMatchObject({
        family: 'social',
        actor: 20,
      });
    expect(
      sharedRatePolicy({
        method: 'GET',
        route: '/social-groups/:id/exit-check',
      }).actor,
    ).toBe(600);
    expect(
      sharedRatePolicy({
        method: 'GET',
        route: '/social-groups/:id/lifecycle-job',
      }).kind,
    ).toBe('sensitive');
  });
  it('allows ordinary membership reads and caps aggregation aliases', () => {
    expect(
      sharedRatePolicy({
        method: 'GET',
        route: '/companies/:id/contexts/:scopeId/members',
      }).actor,
    ).toBe(600);
    expect(
      sharedRatePolicy({ method: 'HEAD', route: '/teams/:id/tasks' }).kind,
    ).toBe('read');
    expect(
      sharedRatePolicy({ method: 'GET', route: '/teams/:id/project-summaries' })
        .endpoint,
    ).toBeDefined();
  });

  it('deduplicates overlapping guards and uses the socket IP and route template', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ limit: 600, remaining: 599, reset: 17 });
    const req = {
      method: 'GET',
      route: { path: read.route },
      socket: { remoteAddress: 'real-ip' },
      ip: 'spoofed',
      actor: { userId: 'alice' },
    } as unknown as Request;
    const setHeader = vi.fn();
    const res = { setHeader } as unknown as Response;
    await Promise.all([
      sharedHttpRequest({ request }, req, res),
      sharedHttpRequest({ request }, req, res),
    ]);
    expect(request).toHaveBeenCalledExactlyOnceWith(
      'real-ip',
      { userId: 'alice' },
      false,
      read,
    );
    expect(setHeader).toHaveBeenCalledWith('RateLimit-Remaining', '599');
    expect(setHeader).toHaveBeenCalledWith('RateLimit-Reset', '17');
  });
});
