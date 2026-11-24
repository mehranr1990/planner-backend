import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID, createHmac } from 'node:crypto';
import request from 'supertest';
import { hashPassword } from 'better-auth/crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { testApplication } from '../support/application.js';
import { cleanupFixtureIdentities } from '../support/fixture-cleanup.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { SpacesService } from '../../src/modules/spaces/public/index.js';
import { AdminSpaces } from '../../src/modules/spaces/public/index.js';
import { AdminAccounts } from '../../src/modules/account/public/index.js';
import { AdminService } from '../../src/platform/admin/admin.service.js';

function code(secret: string) {
  const bits = [...secret]
    .map((c) =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
        .indexOf(c)
        .toString(2)
        .padStart(5, '0'),
    )
    .join('');
  const bytes = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)),
  );
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac('sha1', bytes).update(time).digest();
  return String(
    (hash.readUInt32BE(hash[19]! & 15) & 0x7fffffff) % 1000000,
  ).padStart(6, '0');
}
describe('Platform Admin P1 metadata and account controls', () => {
  const url = isolatedTestDatabaseUrl(process.env),
    email = `p1-admin-${randomUUID()}@example.test`,
    userEmail = `p1-user-${randomUUID()}@example.test`,
    password = 'admin-management-test-password!';
  let app: NestExpressApplication,
    db: DatabaseService,
    adminId: string,
    userId: string,
    spaceId: string;
  const jar = new Map<string, string>();
  const cookies = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const remember = (response: { headers: Record<string, unknown> }) => {
    for (const raw of (response.headers['set-cookie'] as string[]) ?? []) {
      const pair = raw.split(';')[0]!,
        at = pair.indexOf('=');
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
  };
  const post = (path: string, body: object) =>
    request(app.getHttpServer())
      .post('/api/v1/admin/' + path)
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', cookies())
      .send(body);
  const get = (path: string) =>
    request(app.getHttpServer())
      .get('/api/v1/admin/' + path)
      .set('Cookie', cookies());
  beforeAll(async () => {
    app = await testApplication({ databaseUrl: url });
    db = app.get(DatabaseService);
    const actor = await db.client.adminUser.create({
      data: { email, name: 'Admin fixture', role: 'SUPER_ADMIN' },
    });
    adminId = actor.id;
    await db.client.adminAccount.create({
      data: {
        userId: actor.id,
        accountId: actor.id,
        providerId: 'credential',
        password: await hashPassword(password),
      },
    });
    remember(await post('auth/sign-in/email', { email, password }).expect(200));
    const enrollment = await post('auth/two-factor/enable', {
      password,
    }).expect(200);
    remember(enrollment);
    const secret = new URL(enrollment.body.totpURI as string).searchParams.get(
      'secret',
    )!;
    remember(
      await post('auth/two-factor/verify-totp', { code: code(secret) }).expect(
        200,
      ),
    );
    jar.clear();
    remember(await post('auth/sign-in/email', { email, password }).expect(200));
    remember(
      await post('auth/two-factor/verify-totp', { code: code(secret) }).expect(
        200,
      ),
    );
    const user = await db.client.user.create({
      data: {
        email: userEmail,
        name: 'Ordinary fixture',
        emailVerified: true,
        settings: { create: {} },
        spaces: { create: { kind: 'PERSONAL' } },
      },
      include: { spaces: true },
    });
    userId = user.id;
    spaceId = user.spaces[0]!.id;
  });
  afterAll(async () => {
    if (db) {
      if (userId)
        await db.client.adminDelivery.deleteMany({
          where: { targetUserId: userId },
        });
      if (adminId)
        await db.client.adminMutationReceipt.deleteMany({
          where: { actorAdminId: adminId },
        });
      await db.client.adminBulkOperation.deleteMany({
        where: { actorAdminId: adminId },
      });
      await db.client.adminAuditEvent.deleteMany({
        where: { actorAdminId: adminId },
      });
      if (adminId) await db.client.adminUser.delete({ where: { id: adminId } });
      await cleanupFixtureIdentities(url, { emails: [userEmail] });
    }
    await app?.close();
  });
  it('returns bounded metadata, rejects mass assignment and preserves private realms', async () => {
    const users = await get('users?limit=1').expect(200);
    expect(users.body.items).toHaveLength(1);
    const detail = await get('users/' + userId).expect(200);
    expect(detail.body).toMatchObject({
      id: userId,
      status: 'ACTIVE',
      revision: 1,
    });
    expect(JSON.stringify(detail.body)).not.toMatch(
      /password|authaccounts|session_token|internalNote|journalEntries/,
    );
    await post(`users/${userId}/verify-email`, {
      revision: 1,
      reason: 'evidence',
      email: userEmail,
      password: 'injected',
    }).expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', cookies())
      .expect(401);
    await get('users?limit=101').expect(400);
  });
  it('revokes sessions atomically on suspension and expires without restoring them', async () => {
    await db.client.authSession.create({
      data: {
        userId,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 60000),
        updatedAt: new Date(),
      },
    });
    await post(`users/${userId}/suspend`, {
      revision: 1,
      reason: 'Public explanation',
      internalNote: 'Confidential test note',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    }).expect(200);
    expect(await db.client.authSession.count({ where: { userId } })).toBe(0);
    await expect(app.get(AdminService).session({})).rejects.toThrow();
    const state = await get('users/' + userId).expect(200);
    expect(state.body.status).toBe('SUSPENDED');
    expect(JSON.stringify(state.body)).not.toContain('Confidential test note');
    const admission = app.get(SpacesService);
    await expect(admission.admit(userId)).rejects.toThrow('Forbidden');
    await db.client.userSettings.update({
      where: { userId },
      data: {
        suspendedAt: new Date(Date.now() - 120000),
        suspensionExpiresAt: new Date(Date.now() - 1),
      },
    });
    await expect(admission.admit(userId)).resolves.toBeUndefined();
    expect((await get('users/' + userId).expect(200)).body.status).toBe(
      'ACTIVE',
    );
    expect(await db.client.authSession.count({ where: { userId } })).toBe(0);
    await post(`users/${userId}/reactivate`, {
      revision: 2,
      reason: 'Reactivated',
    }).expect(200);
  });
  it('uses revision checks for concurrent state changes with one audit winner', async () => {
    const results = await Promise.all([
      post(`users/${userId}/suspend`, { revision: 3, reason: 'Concurrent A' }),
      post(`users/${userId}/suspend`, { revision: 3, reason: 'Concurrent B' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await db.client.adminAuditEvent.count({
        where: {
          targetUserId: userId,
          action: 'POST users/:id/suspend',
          outcome: 'SUCCEEDED',
        },
      }),
    ).toBe(2);
  });
  it('requires recent server-side MFA proof for sensitive mutation', async () => {
    await db.client.adminSession.updateMany({
      where: { userId: adminId },
      data: { mfaVerifiedAt: new Date(Date.now() - 301000) },
    });
    await post(`users/${userId}/reactivate`, {
      revision: 4,
      reason: 'Stale session',
    }).expect(403);
    await db.client.adminSession.updateMany({
      where: { userId: adminId },
      data: { mfaVerifiedAt: new Date() },
    });
    await post(`users/${userId}/reactivate`, {
      revision: 4,
      reason: 'Current session',
    }).expect(200);
  });
  it('binds bulk previews to exact targets, revisions and safe retry results', async () => {
    const preview = await post('users/bulk/preview', {
      operation: 'suspend',
      userIds: [userId],
      reason: 'Bulk fixture',
    }).expect(200);
    await post('users/bulk/execute', {
      previewId: preview.body.previewId,
      confirmation: [randomUUID()],
    }).expect(400);
    const execute = {
      previewId: preview.body.previewId,
      confirmation: [userId],
    };
    const first = await post('users/bulk/execute', execute).expect(200),
      retry = await post('users/bulk/execute', execute).expect(200);
    expect(first.body).toEqual(retry.body);
    expect((await get('users/' + userId).expect(200)).body.revision).toBe(6);
  });
  it('keeps workspace suspension separate from account state and enforces role permissions', async () => {
    await post(`workspaces/${spaceId}/suspend`, {
      revision: 1,
      reason: 'Workspace restricted',
    }).expect(200);
    expect((await get(`workspaces/${spaceId}`).expect(200)).body.status).toBe(
      'SUSPENDED',
    );
    await db.client.adminUser.update({
      where: { id: adminId },
      data: { role: 'BILLING_MANAGER' },
    });
    await get('users').expect(403);
    await get('dashboard/export').expect(403);
    await db.client.adminUser.update({
      where: { id: adminId },
      data: { role: 'SUPER_ADMIN' },
    });
    await app
      .get(AdminAccounts)
      .metrics(new Date(Date.now() - 604800000), new Date());
    await app
      .get(AdminSpaces)
      .metrics(new Date(Date.now() - 604800000), new Date());
    const csv = await get('dashboard/export?range=7d').expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('users.total');
    await post(`workspaces/${spaceId}/reactivate`, {
      revision: 2,
      reason: 'Restored',
    }).expect(200);
  });
  it('pins manual verification to the current email and preserves migration constraints', async () => {
    const detail = await get('users/' + userId).expect(200);
    await post(`users/${userId}/verify-email`, {
      revision: detail.body.revision,
      reason: 'Reviewed evidence',
      email: 'substituted@example.test',
    }).expect(409);
    expect((await get('users/' + userId).expect(200)).body.revision).toBe(
      detail.body.revision,
    );
    await expect(
      db.client.userSettings.update({
        where: { userId },
        data: {
          suspendedAt: new Date(),
          suspensionExpiresAt: new Date(Date.now() - 60000),
        },
      }),
    ).rejects.toThrow();
    expect(
      (await db.client.user.findUniqueOrThrow({ where: { id: userId } })).email,
    ).toBe(userEmail);
  });
});
