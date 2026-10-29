import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as c from '@mehran/api-contracts';
import { testApplication } from '../support/application.js';
import { cleanupFixtureIdentities } from '../support/fixture-cleanup.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import { SyncService } from '../../src/modules/sync/public/index.js';
import { SpacesService } from '../../src/modules/spaces/public/index.js';
import { TasksSync } from '../../src/modules/tasks/public/index.js';
type Actor = { id: string; spaceId: string; cookie: string; epoch: string };
describe('P1-12 bounded personal synchronization', () => {
  let app: NestExpressApplication, db: DatabaseService, a: Actor, b: Actor;
  const users: string[] = [],
    databaseUrl = isolatedTestDatabaseUrl(process.env),
    origin = 'http://localhost:3000';
  const call = (
    who: Actor,
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
  ) =>
    request(app.getHttpServer())
      [method]('/api/v1' + path)
      .set('Cookie', who.cookie)
      .set('Origin', origin);
  async function identity() {
    const email = `sync-${randomUUID()}@example.test`,
      password = 'test-only-sync-password-123!';
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .send({ email, password, name: 'Sync fixture' })
      .expect(200);
    const id = signup.body.user.id as string;
    users.push(id);
    const link = new URL(
      app.get(IdentityMailService).latestForTest(email, 'verify-email')!.url,
    );
    link.searchParams.delete('callbackURL');
    await request(app.getHttpServer())
      .get(link.pathname + link.search)
      .expect(200);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email, password })
      .expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[])
        .map((v) => v.split(';')[0])
        .join('; '),
      space = await db.client.space.findFirstOrThrow({
        where: { ownerUserId: id },
      });
    return { id, spaceId: space.id, cookie, epoch: space.syncEpoch };
  }
  const op = (operation: string, body: object = {}, extra: object = {}) => ({
    clientMutationId: randomUUID(),
    baseRevision: 0,
    operation,
    body,
    ...extra,
  });
  const push = async (operations: object[], who = a) =>
    c.SyncPushResultSchema.parse(
      (
        await call(who, 'post', '/sync/push')
          .send({ epoch: who.epoch, operations })
          .expect(201)
      ).body,
    ).results;
  beforeAll(async () => {
    app = await testApplication({ databaseUrl });
    db = app.get(DatabaseService);
    a = await identity();
    b = await identity();
  });
  afterAll(async () => {
    if (db) await cleanupFixtureIdentities(databaseUrl, { ids: users });
    await app?.close();
  });
  it('applies once under concurrent replay and preserves the permanent receipt', async () => {
    const command = op('TASK_CREATE', { title: 'Offline task' }),
      replies = await Promise.all([push([command]), push([command])]);
    expect(
      replies
        .flat()
        .map((r) => r.status)
        .sort(),
    ).toEqual(['APPLIED', 'DUPLICATE']);
    const id = replies[0]![0]!.resource!.id;
    expect(
      await db.client.task.count({ where: { id, spaceId: a.spaceId } }),
    ).toBe(1);
    expect(
      await db.client.syncChange.count({
        where: { resourceId: id, spaceId: a.spaceId },
      }),
    ).toBe(1);
    await db.client.syncMutationReceipt.updateMany({
      where: { spaceId: a.spaceId, clientMutationId: command.clientMutationId },
      data: { bodyExpiresAt: new Date(Date.now() + 1000) },
    });
    await db.client
      .$executeRaw`UPDATE "SyncMutationReceipt" SET "createdAt"=now()-interval '31 days',"bodyExpiresAt"=now()-interval '1 day' WHERE "spaceId"=${a.spaceId}::uuid AND "clientMutationId"=${command.clientMutationId}::uuid`;
    expect((await push([command]))[0]).toMatchObject({
      status: 'DUPLICATE',
      resultExpired: true,
      resource: null,
    });
  });
  it('rejects a reused identity with changed input and accepts mixed per-item outcomes', async () => {
    const command = op('TASK_CREATE', { title: 'Original' });
    await push([command]);
    const results = await push([
      { ...command, body: { title: 'Changed' } },
      op('FINANCE_POST', { amount: '1' }),
      op('TASK_CREATE', { title: 'Good item' }),
      op('TASK_CREATE', { title: 'x', spaceId: b.spaceId }),
    ]);
    expect(results.map((r) => r.status)).toEqual([
      'REJECTED',
      'REJECTED',
      'APPLIED',
      'REJECTED',
    ]);
    expect(results[0]!.error!.code).toBe('MUTATION_ID_REUSED');
  });
  it('preserves client/server conflict versions and resolves only with a fresh revision', async () => {
    const created = (await push([op('TASK_CREATE', { title: 'Initial' })]))[0]!
      .resource!;
    await push([
      op(
        'TASK_PATCH',
        { title: 'Server' },
        { resourceId: created.id, baseRevision: 1 },
      ),
    ]);
    const stale = op(
        'TASK_PATCH',
        { title: 'Client' },
        { resourceId: created.id, baseRevision: 1 },
      ),
      conflict = (await push([stale]))[0]!;
    expect(conflict.status).toBe('CONFLICT');
    expect(conflict.error!.client).toMatchObject({ title: 'Client' });
    expect(conflict.error!.server).toMatchObject({
      revision: 2,
      data: { title: 'Server' },
    });
    expect((await push([stale]))[0]!.status).toBe('DUPLICATE');
    expect(
      (
        await push([
          op(
            'TASK_PATCH',
            { title: 'Merged' },
            { resourceId: created.id, baseRevision: 2 },
          ),
        ])
      )[0]!.resource!.revision,
    ).toBe(3);
  });
  it('does not disclose foreign resources in commands or conflict bodies', async () => {
    const foreign = (
      await push([op('TASK_CREATE', { title: 'Foreign private' })], b)
    )[0]!.resource!;
    const result = (
      await push([
        op(
          'TASK_PATCH',
          { title: 'Probe' },
          { resourceId: foreign.id, baseRevision: 1 },
        ),
      ])
    )[0]!;
    expect(result.status).toBe('REJECTED');
    expect(JSON.stringify(result)).not.toContain('Foreign private');
    expect(result.error!.server).toBeNull();
  });
  it('provides bounded bootstrap, catches ordinary REST writes and emits deletion tombstones', async () => {
    let page = c.SyncPullResultSchema.parse(
      (await call(a, 'get', '/sync/pull?limit=2').expect(200)).body,
    );
    expect(page.items.length).toBeLessThanOrEqual(2);
    const first = page.cursor;
    const task = c.TaskSchema.parse(
      (
        await call(a, 'post', '/tasks')
          .send({ title: 'Normal REST write' })
          .expect(201)
      ).body,
    );
    for (let n = 0; n < 30 && page.phase === 'BOOTSTRAP'; n++)
      page = c.SyncPullResultSchema.parse(
        (
          await call(
            a,
            'get',
            '/sync/pull?limit=2&cursor=' + encodeURIComponent(page.cursor),
          ).expect(200)
        ).body,
      );
    expect(page.phase).toBe('INCREMENTAL');
    const changed = c.SyncPullResultSchema.parse(
      (
        await call(
          a,
          'get',
          '/sync/pull?cursor=' + encodeURIComponent(page.cursor),
        ).expect(200)
      ).body,
    );
    expect(changed.items.some((v) => v.id === task.id)).toBe(true);
    await call(a, 'delete', '/tasks/' + task.id)
      .set('If-Match', '"1"')
      .expect(200);
    const deleted = c.SyncPullResultSchema.parse(
      (
        await call(
          a,
          'get',
          '/sync/pull?cursor=' + encodeURIComponent(changed.cursor),
        ).expect(200)
      ).body,
    );
    expect(deleted.items.find((v) => v.id === task.id)).toMatchObject({
      deleted: true,
      data: null,
      revision: 2,
    });
    await call(
      b,
      'get',
      '/sync/pull?cursor=' + encodeURIComponent(first),
    ).expect(400);
    await call(
      a,
      'get',
      '/sync/pull?cursor=' + encodeURIComponent(first.slice(0, -1) + '!'),
    ).expect(400);
  });
  it('synchronizes checklist, labels and daily selections through owner revision checks', async () => {
    const task = (await push([op('TASK_CREATE', { title: 'Plan task' })]))[0]!
        .resource!,
      label = (await push([op('LABEL_CREATE', { name: 'Offline label' })]))[0]!
        .resource!;
    expect(
      (
        await push([
          op(
            'TASK_LABEL_SET',
            { labelId: label.id, present: true },
            { resourceId: task.id, baseRevision: 1 },
          ),
        ])
      )[0]!.resource,
    ).toMatchObject({ revision: 2, data: { labelIds: [label.id] } });
    const check = (
      await push([
        op(
          'CHECKLIST_CREATE',
          { title: 'Check item' },
          { parentId: task.id, baseRevision: 2 },
        ),
      ])
    )[0]!;
    expect(check.status).toBe('APPLIED');
    expect(check.resource!.entity).toBe('CHECKLIST');
    const day = (
      await push([op('DAY_CREATE', {}, { localDate: '2026-10-29' })])
    )[0]!.resource!;
    expect(day.entity).toBe('DAILY_PLAN');
    const selected = (
      await push([
        op(
          'DAY_SELECT',
          { plannedMinutes: 30, taskRevision: 3 },
          { localDate: '2026-10-29', resourceId: task.id, baseRevision: 1 },
        ),
      ])
    )[0]!;
    expect(selected.resource).toMatchObject({
      revision: 2,
      data: { items: [{ taskId: task.id, plannedMinutes: 30 }] },
    });
  });
  it('retains note versions and text/expense captures while rejecting binary capture', async () => {
    const note = (
      await push([
        op('NOTE_CREATE', {
          title: 'Offline note',
          content: { format: 'MARKDOWN', version: 1, content: 'Before' },
        }),
      ])
    )[0]!.resource!;
    const next = (
      await push([
        op(
          'NOTE_PATCH',
          { content: { format: 'MARKDOWN', version: 1, content: 'After' } },
          { resourceId: note.id, baseRevision: 1 },
        ),
      ])
    )[0]!;
    expect(next.resource!.revision).toBe(2);
    expect(
      await db.client.note.count({
        where: { spaceId: a.spaceId, logicalId: note.id },
      }),
    ).toBe(2);
    expect(
      (
        await push([
          op('CAPTURE_CREATE', {
            type: 'EXPENSE',
            text: 'Retained expense',
            voiceFileId: null,
          }),
        ])
      )[0]!.status,
    ).toBe('APPLIED');
    expect(
      (
        await push([
          op('CAPTURE_CREATE', {
            type: 'VOICE_MEMO',
            text: 'voice',
            voiceFileId: randomUUID(),
          }),
        ])
      )[0]!.status,
    ).toBe('REJECTED');
  });
  it('requires the current Space epoch and bounds requests', async () => {
    await call(a, 'post', '/sync/push')
      .send({
        epoch: randomUUID(),
        operations: [op('TASK_CREATE', { title: 'Old account' })],
      })
      .expect(409);
    await call(a, 'post', '/sync/push')
      .send({
        epoch: a.epoch,
        operations: Array.from({ length: 51 }, () =>
          op('TASK_CREATE', { title: 'Too many' }),
        ),
      })
      .expect(400);
    await call(a, 'get', '/sync/pull?limit=101').expect(400);
  });
  it('rolls back source state, audit, outbox and feed together on a rejected command', async () => {
    const before = await db.client.syncChange.count({
        where: { spaceId: a.spaceId },
      }),
      source = app.get(TasksSync),
      original = source.command.bind(source),
      spy = vi
        .spyOn(source, 'command')
        .mockImplementationOnce(async (...args) => {
          await original(...args);
          throw new BadRequestException({ code: 'INJECTED_OWNER_REJECTION' });
        });
    try {
      expect(
        (
          await push([op('TASK_CREATE', { title: 'Atomic rollback sentinel' })])
        )[0]!.status,
      ).toBe('REJECTED');
    } finally {
      spy.mockRestore();
    }
    expect(
      await db.client.task.count({
        where: { spaceId: a.spaceId, title: 'Atomic rollback sentinel' },
      }),
    ).toBe(0);
    expect(
      await db.client.syncChange.count({ where: { spaceId: a.spaceId } }),
    ).toBe(before);
  });
  it('deduplicates a stable habit entry across mutation IDs and preserves historical context', async () => {
    const habit = c.HabitSchema.parse(
      (
        await call(a, 'post', '/habits')
          .set('Idempotency-Key', randomUUID())
          .send({
            title: 'Sync water',
            type: 'QUANTITY',
            unit: 'ML',
            purpose: 'WATER',
            target: '500',
            timezone: 'America/New_York',
            schedule: {
              version: 1,
              startDate: '2024-01-01',
              rule: { kind: 'DAILY' },
            },
          })
          .expect(201)
      ).body,
    );
    const clientEntryId = randomUUID(),
      command = op(
        'HABIT_LOG',
        {
          habitRevision: 1,
          localDate: '2024-03-10',
          action: 'LOG',
          value: '250',
        },
        { parentId: habit.id, clientEntryId },
      );
    const first = (await push([command]))[0]!;
    expect(first.status).toBe('APPLIED');
    expect(
      (await push([{ ...command, clientMutationId: randomUUID() }]))[0]!.status,
    ).toBe('DUPLICATE');
    expect(
      await db.client.habitEntry.count({
        where: { spaceId: a.spaceId, habitId: habit.id },
      }),
    ).toBe(1);
    expect(first.resource!.data).toMatchObject({
      localDate: '2024-03-10',
      timezone: 'America/New_York',
      value: '250',
    });
    const corrected = (
      await push([
        op(
          'HABIT_CORRECT',
          { habitRevision: 1, value: '300' },
          {
            parentId: habit.id,
            resourceId: first.resource!.id,
            baseRevision: 1,
          },
        ),
      ])
    )[0]!;
    expect(corrected.status).toBe('APPLIED');
    expect(
      (
        await push([
          op(
            'HABIT_CORRECT',
            { habitRevision: 1, value: '400' },
            {
              parentId: habit.id,
              resourceId: first.resource!.id,
              baseRevision: 1,
            },
          ),
        ])
      )[0]!.status,
    ).toBe('CONFLICT');
    expect(
      await db.client.habitEntry.count({
        where: { spaceId: a.spaceId, habitId: habit.id },
      }),
    ).toBe(2);
    expect(
      (
        await push([
          op(
            'HABIT_LOG',
            {
              habitRevision: 99,
              localDate: '2024-03-11',
              action: 'LOG',
              value: '250',
            },
            { parentId: habit.id },
          ),
        ])
      )[0]!.status,
    ).toBe('CONFLICT');
  });
  it('paginates current state and expires trimmed cursors while preserving replay receipts', async () => {
    const oldCursor = c.SyncPullResultSchema.parse(
      (await call(a, 'get', '/sync/pull?limit=1').expect(200)).body,
    ).cursor;
    for (let batch = 0; batch < 3; batch++)
      await push(
        Array.from({ length: 40 }, (_, i) =>
          op('TASK_CREATE', { title: `Paged ${batch}/${i}` }),
        ),
      );
    let cursor: string | undefined,
      more = true,
      pages = 0;
    const ids = new Set<string>();
    while (more) {
      const page = c.SyncPullResultSchema.parse(
        (
          await call(
            a,
            'get',
            '/sync/pull?limit=37' +
              (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
          ).expect(200)
        ).body,
      );
      for (const item of page.items)
        if (item.entity === 'TASK') ids.add(item.id);
      cursor = page.cursor;
      more = page.hasMore;
      expect(++pages).toBeLessThan(30);
    }
    expect(ids.size).toBeGreaterThanOrEqual(120);
    expect(pages).toBeGreaterThan(3);
    await db.client.syncChange.updateMany({
      where: { spaceId: a.spaceId },
      data: { createdAt: new Date(Date.now() - 31 * 86400000) },
    });
    const command = op('TASK_CREATE', { title: 'After retained boundary' });
    await push([command]);
    for (let i = 0; i < 3; i++) await app.get(SyncService).maintain();
    await call(
      a,
      'get',
      '/sync/pull?cursor=' + encodeURIComponent(oldCursor),
    ).expect(409);
    expect((await push([command]))[0]!.status).toBe('DUPLICATE');
    const state = await db.client.space.findUniqueOrThrow({
      where: { id: a.spaceId },
    });
    expect(state.syncRetainedSequence).toBeGreaterThan(0n);
  });
  it('fences operations after access closure even with an already authorized scope', async () => {
    const scope = await app.get(SpacesService).authorizePersonal({
      userId: b.id,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    });
    await db.client.$transaction((tx) =>
      app.get(SpacesService).setClosed(tx, scope, true),
    );
    await expect(
      app.get(SyncService).push(
        scope,
        c.SyncPushSchema.parse({
          epoch: b.epoch,
          operations: [op('TASK_CREATE', { title: 'Must not commit' })],
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await db.client.$transaction((tx) =>
      app.get(SpacesService).setClosed(tx, scope, false),
    );
  });
});
