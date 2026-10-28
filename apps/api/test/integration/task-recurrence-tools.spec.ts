import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { testApplication } from '../support/application.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import { TaskToolsStore } from '../../src/modules/tasks/infrastructure/task-tools.store.js';
import {
  TaskRecurrenceSchema,
  TaskOccurrenceSchema,
  TaskTemplateSchema,
  SavedTaskFilterSchema,
  BulkTaskResponseSchema,
} from '@mehran/api-contracts';
import type {
  Series,
  Occurrence,
  TaskTemplateCreate,
} from '@mehran/api-contracts';
const databaseUrl = isolatedTestDatabaseUrl(process.env),
  origin = 'http://localhost:3000';
type Actor = { id: string; cookie: string; spaceId: string };
type Task = { id: string; revision: number; status: string; title: string };
describe('P1-02 recurrence, templates, bulk and filters', () => {
  let app: NestExpressApplication, db: DatabaseService, a: Actor, b: Actor;
  const users: string[] = [];
  const call = (
    actor: Actor,
    method: 'get' | 'post' | 'patch' | 'delete' | 'put',
    path: string,
    revision?: number,
  ) => {
    const req = request(app.getHttpServer())
      [method]('/api/v1' + path)
      .set('Cookie', actor.cookie)
      .set('Origin', origin);
    if (revision !== undefined) req.set('If-Match', `"${revision}"`);
    return req;
  };
  async function identity(): Promise<Actor> {
    const email = `p102-${randomUUID()}@example.test`,
      password = 'test-only-recurrence-password-123!';
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .send({ email, password, name: 'P1-02 fixture' })
      .expect(200);
    const id = signup.body.user.id as string;
    users.push(id);
    const url = new URL(
      app.get(IdentityMailService).latestForTest(email, 'verify-email')!.url,
    );
    url.searchParams.delete('callbackURL');
    await request(app.getHttpServer())
      .get(url.pathname + url.search)
      .expect(200);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email, password })
      .expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[])
      .map((value) => value.split(';')[0])
      .join('; ');
    const space = await db.client.space.findFirstOrThrow({
      where: { ownerUserId: id },
    });
    return { id, cookie, spaceId: space.id };
  }
  const task = async (
    actor = a,
    input: object = { title: 'P1-02 task' },
  ): Promise<Task> =>
    (await call(actor, 'post', '/tasks').send(input).expect(201)).body as Task;
  const definition = (patch: object = {}) => ({
    startDate: '2024-01-01',
    endDate: null,
    localTime: '09:00',
    timezone: 'UTC',
    rule: { kind: 'DAILY', interval: 1 },
    exclusionDates: [],
    ...patch,
  });
  async function series(patch: object = {}, actor = a): Promise<Series> {
    const master = await task(actor);
    const result = await call(actor, 'post', '/task-recurrences')
      .send({
        taskId: master.id,
        taskRevision: master.revision,
        definition: definition(patch),
      })
      .expect(201);
    return TaskRecurrenceSchema.parse(result.body);
  }
  async function generate(
    s: Series,
    through: string,
    limit = 100,
    cursor?: string,
  ) {
    const result = await call(a, 'post', `/task-recurrences/${s.id}/catch-up`)
      .send({ through, limit, ...(cursor ? { cursor } : {}) })
      .expect(200);
    return result.body as {
      items: Occurrence[];
      nextCursor: string | null;
      scannedThrough: string | null;
    };
  }
  const readTask = async (id: string) =>
    (await call(a, 'get', `/tasks/${id}`).expect(200)).body as Task;
  const readOccurrence = async (id: string) =>
    TaskOccurrenceSchema.parse(
      (await call(a, 'get', `/task-occurrences/${id}`).expect(200)).body,
    );
  beforeAll(async () => {
    app = await testApplication({ databaseUrl });
    db = app.get(DatabaseService);
    a = await identity();
    b = await identity();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (db) {
      await db.client.securityAuditEvent.deleteMany({
        where: { actorUserId: { in: users } },
      });
      await db.client.space.deleteMany({
        where: { ownerUserId: { in: users } },
      });
      await db.client.user.deleteMany({ where: { id: { in: users } } });
    }
    await app?.close();
  });
  it('keeps master identity/history, excludes it from ordinary filters and denies every actionable mutation', async () => {
    const s = await series();
    const original = await readTask(s.masterTaskId);
    expect(original.revision).toBe(1);
    const list = await call(a, 'get', '/tasks?limit=100').expect(200);
    expect(list.body.items.map((value: Task) => value.id)).not.toContain(
      s.masterTaskId,
    );
    for (const route of ['complete', 'reopen', 'restore'])
      await call(a, 'post', `/tasks/${s.masterTaskId}/${route}`, 1)
        .send({})
        .expect(409);
    await call(a, 'patch', `/tasks/${s.masterTaskId}`, 1)
      .send({ title: 'unsafe' })
      .expect(409);
    await call(a, 'delete', `/tasks/${s.masterTaskId}`, 1).expect(409);
    await call(a, 'post', `/tasks/${s.masterTaskId}/subtasks`)
      .send({ title: 'unsafe' })
      .expect(409);
    const history = await call(
      a,
      'get',
      `/tasks/${s.masterTaskId}/history`,
    ).expect(200);
    expect(history.body.items).toHaveLength(1);
    expect(
      await db.client.securityAuditEvent.count({
        where: { resourceId: s.id, action: 'TASK_RECURRENCE_CREATE' },
      }),
    ).toBe(1);
  });
  it('tracks DST gaps without a Task and uses the earlier fold instant', async () => {
    const spring = await series({
      startDate: '2024-03-09',
      endDate: '2024-03-11',
      localTime: '02:30',
      timezone: 'America/New_York',
    });
    const result = await generate(spring, '2024-03-11');
    expect(result.items).toHaveLength(3);
    expect(result.items[1]).toMatchObject({
      state: 'SKIPPED',
      reason: 'DST_GAP',
      taskId: null,
      scheduledAt: null,
      localDate: '2024-03-10',
    });
    expect(result.items[2]!.scheduledAt).toBe('2024-03-11T06:30:00.000Z');
    expect(
      await db.client.taskOccurrence.count({
        where: { seriesId: spring.id, taskId: { not: null } },
      }),
    ).toBe(2);
    const fall = await series({
      startDate: '2024-11-03',
      endDate: '2024-11-03',
      localTime: '01:30',
      timezone: 'America/New_York',
    });
    expect((await generate(fall, '2024-11-03')).items[0]!.scheduledAt).toBe(
      '2024-11-03T05:30:00.000Z',
    );
  });
  it('persists series-local midnight context independently of account timezone', async () => {
    const s = await series({
      startDate: '2024-01-01',
      endDate: '2024-01-02',
      localTime: '00:00',
      timezone: 'Asia/Tehran',
    });
    const settings = await call(a, 'get', '/me/settings').expect(200);
    await call(a, 'patch', '/me/settings', settings.body.revision)
      .send({ timezone: 'America/New_York' })
      .expect(200);
    const occurrence = (await generate(s, '2024-01-02')).items[0]!;
    expect(occurrence).toMatchObject({
      timezone: 'Asia/Tehran',
      localDate: '2024-01-01',
      scheduledAt: '2023-12-31T20:30:00.000Z',
    });
    expect((await readTask(occurrence.taskId!)).id).not.toBe(s.masterTaskId);
  });
  it('enforces month-end, leap-year and exclusions in persisted occurrences', async () => {
    const monthly = await series({
      startDate: '2024-01-01',
      endDate: '2024-04-30',
      rule: { kind: 'MONTHLY_DATE', interval: 1, day: 31 },
      exclusionDates: ['2024-03-31'],
    });
    expect(
      (await generate(monthly, '2024-04-30')).items.map(
        (item) => item.localDate,
      ),
    ).toEqual(['2024-01-31']);
    const leap = await series({
      startDate: '2023-01-01',
      endDate: '2025-12-31',
      rule: { kind: 'YEARLY', interval: 1, month: 2, day: 29 },
    });
    let page = await generate(leap, '2025-12-31'),
      items = [...page.items];
    while (page.nextCursor) {
      page = await generate(leap, '2025-12-31', 100, page.nextCursor);
      items = items.concat(page.items);
    }
    expect(items.map((item) => item.localDate)).toEqual(['2024-02-29']);
  });
  it('persists bounded catch-up progress, safely replays cursors and rejects foreign or stale cursors', async () => {
    const s = await series(),
      first = await generate(s, '2024-01-05', 2);
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await generate(s, '2024-01-05', 2, first.nextCursor!),
      replay = await generate(s, '2024-01-05', 2, first.nextCursor!);
    expect(replay.items.map((item) => item.id)).toEqual(
      second.items.map((item) => item.id),
    );
    const forged = JSON.parse(
      Buffer.from(first.nextCursor!, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    forged.next = '2024-01-06';
    await call(a, 'post', `/task-recurrences/${s.id}/catch-up`)
      .send({
        through: '2024-01-05',
        limit: 2,
        cursor: Buffer.from(JSON.stringify(forged)).toString('base64url'),
      })
      .expect(400);
    const other = await series();
    await call(a, 'post', `/task-recurrences/${other.id}/catch-up`)
      .send({ through: '2024-01-05', limit: 2, cursor: first.nextCursor })
      .expect(400);
    await call(b, 'post', `/task-recurrences/${s.id}/catch-up`)
      .send({ through: '2024-01-05', limit: 2, cursor: first.nextCursor })
      .expect(404);
    await call(a, 'patch', `/task-recurrences/${s.id}`, s.revision)
      .send({
        scope: 'ENTIRE_SERIES',
        definition: definition({ localTime: '10:00' }),
      })
      .expect(200);
    await call(a, 'post', `/task-recurrences/${s.id}/catch-up`)
      .send({ through: '2024-01-05', limit: 2, cursor: first.nextCursor })
      .expect(409);
  });
  it('serializes concurrent generation, duplicate execution and retries without duplicate Tasks or events', async () => {
    const s = await series({ endDate: '2024-01-03' });
    await Promise.all(
      Array.from({ length: 5 }, () => generate(s, '2024-01-03', 2)),
    );
    const rows = await db.client.taskOccurrence.findMany({
      where: { seriesId: s.id },
    });
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.taskId)).size).toBe(3);
    const taskIds = rows.map((row) => row.taskId!);
    expect(
      await db.client.taskChange.count({
        where: { taskId: { in: taskIds }, kind: 'CREATED' },
      }),
    ).toBe(3);
    expect(
      await db.client.outboxEvent.count({
        where: { aggregateId: { in: taskIds }, type: 'task.created' },
      }),
    ).toBe(3);
  });
  it('atomically couples Task completion and occurrence state without affecting master or siblings', async () => {
    const s = await series(),
      page = await generate(s, '2024-01-02'),
      first = page.items[0]!,
      second = page.items[1]!;
    await call(a, 'post', `/tasks/${first.taskId}/complete`, 1)
      .send({})
      .expect(200);
    expect(await readOccurrence(first.id)).toMatchObject({
      state: 'DONE',
      revision: 2,
    });
    expect((await readOccurrence(second.id)).state).toBe('PENDING');
    expect((await readTask(s.masterTaskId)).status).toBe('OPEN');
    await call(a, 'post', `/tasks/${first.taskId}/reopen`, 2)
      .send({})
      .expect(200);
    expect((await readOccurrence(first.id)).state).toBe('PENDING');
    const current = await readOccurrence(first.id);
    await call(
      a,
      'post',
      `/task-occurrences/${first.id}/complete`,
      current.revision,
    )
      .send({ taskRevision: 3 })
      .expect(200);
    expect((await readTask(first.taskId!)).status).toBe('DONE');
  });
  it('skips and cancels with revision checks and denies accidental resurrection', async () => {
    const s = await series(),
      items = (await generate(s, '2024-01-02')).items;
    await call(a, 'post', `/task-occurrences/${items[0]!.id}/skip`, 1)
      .send({ taskRevision: 9 })
      .expect(409);
    const skipped = await call(
      a,
      'post',
      `/task-occurrences/${items[0]!.id}/skip`,
      1,
    )
      .send({ taskRevision: 1 })
      .expect(200);
    expect(skipped.body).toMatchObject({
      state: 'SKIPPED',
      reason: 'USER_SKIP',
    });
    expect((await readTask(items[0]!.taskId!)).status).toBe('CANCELED');
    await call(a, 'post', `/tasks/${items[0]!.taskId}/reopen`, 2)
      .send({})
      .expect(409);
    await call(a, 'post', `/task-occurrences/${items[1]!.id}/cancel`, 1)
      .send({ taskRevision: 1 })
      .expect(200);
    expect((await readOccurrence(items[1]!.id)).reason).toBe('USER_CANCEL');
    expect(
      await db.client.outboxEvent.count({
        where: { aggregateId: items[0]!.taskId!, type: 'task.completed' },
      }),
    ).toBe(0);
  });
  it('restores deleted pending occurrence Tasks without losing their occurrence link', async () => {
    const s = await series(),
      o = (await generate(s, '2024-01-01')).items[0]!;
    await call(a, 'delete', `/tasks/${o.taskId}`, 1).expect(200);
    expect((await readOccurrence(o.id)).reason).toBe('TASK_DELETED');
    await call(a, 'post', `/tasks/${o.taskId}/restore`, 2).send({}).expect(200);
    expect((await readOccurrence(o.id)).state).toBe('PENDING');
  });
  it('edits one exception, retains terminal records and stable identities through ENTIRE_SERIES edits', async () => {
    const s = await series(),
      items = (await generate(s, '2024-01-03')).items;
    await call(a, 'post', `/tasks/${items[0]!.taskId}/complete`, 1)
      .send({})
      .expect(200);
    const terminal = await readOccurrence(items[0]!.id);
    const one = await call(a, 'patch', `/task-recurrences/${s.id}`, 1)
      .send({
        scope: 'THIS_OCCURRENCE',
        occurrenceId: items[1]!.id,
        occurrenceRevision: 1,
        taskRevision: 1,
        patch: { title: 'Only this', dueAt: '2024-01-02T12:00:00Z' },
      })
      .expect(200);
    expect(one.body.occurrence).toMatchObject({
      exception: true,
      recurrenceKey: items[1]!.recurrenceKey,
    });
    await call(a, 'patch', `/task-recurrences/${s.id}`, 2)
      .send({
        scope: 'ENTIRE_SERIES',
        definition: definition({ localTime: '10:00' }),
      })
      .expect(200);
    expect(await readOccurrence(items[0]!.id)).toEqual(terminal);
    expect((await readOccurrence(items[1]!.id)).scheduledAt).toBe(
      '2024-01-02T12:00:00.000Z',
    );
    expect((await readOccurrence(items[2]!.id)).scheduledAt).toBe(
      '2024-01-03T10:00:00.000Z',
    );
    await generate(s, '2024-01-03');
    expect(
      await db.client.taskOccurrence.count({ where: { seriesId: s.id } }),
    ).toBe(3);
  });
  it('preserves linked series lineage, earlier catch-up and future terminal history when splitting', async () => {
    const s = await series(),
      items = (await generate(s, '2024-01-04')).items;
    await call(a, 'post', `/tasks/${items[3]!.taskId}/complete`, 1)
      .send({})
      .expect(200);
    const terminal = await readOccurrence(items[3]!.id);
    const split = await call(a, 'patch', `/task-recurrences/${s.id}`, 1)
      .send({
        scope: 'THIS_AND_FUTURE',
        occurrenceId: items[1]!.id,
        occurrenceRevision: 1,
        definition: definition({ startDate: '2024-01-02', localTime: '11:00' }),
      })
      .expect(200);
    const successor = TaskRecurrenceSchema.parse(split.body.successor);
    expect(successor.previousSeriesId).toBe(s.id);
    expect(successor.masterTaskId).not.toBe(s.masterTaskId);
    expect((await readOccurrence(items[0]!.id)).state).toBe('PENDING');
    expect((await readOccurrence(items[1]!.id)).reason).toBe('SERIES_SPLIT');
    expect(await readOccurrence(items[3]!.id)).toEqual(terminal);
    const generated = await generate(successor, '2024-01-04');
    expect(generated.items.map((item) => item.localDate)).toEqual([
      '2024-01-02',
      '2024-01-03',
    ]);
    expect(await generate(s, '2024-01-04')).toMatchObject({
      items: [],
      nextCursor: null,
    });
    await call(a, 'patch', `/task-recurrences/${s.id}`, 2)
      .send({ scope: 'ENTIRE_SERIES', definition: definition() })
      .expect(409);
  });
  it('series cancellation retains completed history and cancels pending Tasks atomically', async () => {
    const s = await series(),
      items = (await generate(s, '2024-01-02')).items;
    await call(a, 'post', `/tasks/${items[0]!.taskId}/complete`, 1)
      .send({})
      .expect(200);
    const done = await readOccurrence(items[0]!.id);
    await call(a, 'delete', `/task-recurrences/${s.id}`, 1).expect(200);
    expect(await readOccurrence(items[0]!.id)).toEqual(done);
    expect((await readOccurrence(items[1]!.id)).reason).toBe('SERIES_CANCELED');
    await call(a, 'post', `/task-recurrences/${s.id}/catch-up`)
      .send({ through: '2024-01-03' })
      .expect(409);
  });
  const templateInput: TaskTemplateCreate = {
    name: 'Morning',
    values: {
      version: 1,
      task: { title: 'Template task', priority: 'HIGH' },
      checklist: [{ title: 'First' }, { title: 'Second' }],
    },
  };
  it('copies templates safely, resets checklist state, enforces revisions and replays application once', async () => {
    const created = TaskTemplateSchema.parse(
      (await call(a, 'post', '/task-templates').send(templateInput).expect(201))
        .body,
    );
    const apply = () =>
      call(a, 'post', `/task-templates/${created.id}/apply`)
        .set('Idempotency-Key', 'apply-once')
        .send({ revision: 1, overrides: { title: 'Copied' } });
    const [one, two] = await Promise.all([apply(), apply()]);
    expect(one.status).toBe(201);
    expect(two.body.id).toBe(one.body.id);
    const copied = one.body as Task;
    expect(copied.title).toBe('Copied');
    const checklist = await call(
      a,
      'get',
      `/tasks/${copied.id}/checklist-items`,
    ).expect(200);
    expect(
      checklist.body.items.map(
        (item: { completed: boolean }) => item.completed,
      ),
    ).toEqual([false, false]);
    await call(a, 'patch', `/task-templates/${created.id}`, 1)
      .send({ values: { ...templateInput.values, task: { title: 'Changed' } } })
      .expect(200);
    expect((await readTask(copied.id)).title).toBe('Copied');
    await call(a, 'post', `/task-templates/${created.id}/apply`)
      .set('Idempotency-Key', 'stale-template')
      .send({ revision: 1 })
      .expect(409);
    await call(a, 'post', `/task-templates/${created.id}/apply`)
      .set('Idempotency-Key', 'apply-once')
      .send({ revision: 2 })
      .expect(409);
    await call(b, 'post', `/task-templates/${created.id}/apply`)
      .set('Idempotency-Key', 'foreign-template')
      .send({ revision: 2 })
      .expect(404);
    await call(a, 'delete', `/task-templates/${created.id}`, 2).expect(204);
    expect((await readTask(copied.id)).id).toBe(copied.id);
  });
  it('stores normalized filters, executes existing scoped predicates and denies arbitrary query definitions', async () => {
    const own = await task(a, { title: 'High', priority: 'URGENT' });
    await task(b, { title: 'Foreign high', priority: 'URGENT' });
    const saved = SavedTaskFilterSchema.parse(
      (
        await call(a, 'post', '/saved-task-filters')
          .send({
            name: '  Urgent  ',
            query: {
              version: 1,
              where: {
                priority: 'URGENT',
                rootOnly: 'false',
                deleted: 'false',
              },
            },
          })
          .expect(201)
      ).body,
    );
    expect(saved.query.where).toEqual({ priority: 'URGENT' });
    const page = await call(
      a,
      'get',
      `/saved-task-filters/${saved.id}/tasks`,
    ).expect(200);
    expect(page.body.items.map((item: Task) => item.id)).toEqual([own.id]);
    await call(a, 'post', '/saved-task-filters')
      .send({ name: 'SQL', query: { version: 1, where: { sql: 'SELECT *' } } })
      .expect(400);
    await call(a, 'patch', `/saved-task-filters/${saved.id}`, 1)
      .send({ name: 'Renamed' })
      .expect(200);
    await call(a, 'patch', `/saved-task-filters/${saved.id}`, 1)
      .send({ name: 'Stale' })
      .expect(409);
    await call(a, 'delete', `/saved-task-filters/${saved.id}`, 2).expect(204);
  });
  it('reauthorizes nested filter IDs both on save and execution', async () => {
    const foreign = await task(b);
    await call(a, 'post', '/saved-task-filters')
      .send({
        name: 'Foreign',
        query: { version: 1, where: { parentTaskId: foreign.id } },
      })
      .expect(404);
    const label = (
      await call(a, 'post', '/labels')
        .send({ name: 'filter-owned' })
        .expect(201)
    ).body as { id: string; revision: number };
    const saved = (
      await call(a, 'post', '/saved-task-filters')
        .send({
          name: 'Label',
          query: { version: 1, where: { labelId: label.id } },
        })
        .expect(201)
    ).body as { id: string };
    await call(a, 'delete', `/labels/${label.id}`, label.revision).expect(204);
    await call(a, 'get', `/saved-task-filters/${saved.id}/tasks`).expect(404);
  });
  it('returns 100 independent bulk outcomes with mixed permissions, invalid items and stale revisions', async () => {
    const owned = await task(),
      foreign = await task(b, { title: 'Foreign private bulk task' }),
      others: Task[] = [];
    for (let index = 0; index < 32; index++) others.push(await task());
    const items: Array<unknown> = [
      { action: 'COMPLETE', id: owned.id, revision: 1 },
      { action: 'COMPLETE', id: foreign.id, revision: 1 },
      { action: 'PATCH', id: owned.id, revision: 1, patch: { title: 'stale' } },
      ...others.map((item) => ({
        action: 'PATCH',
        id: item.id,
        revision: 1,
        patch: { priority: 'HIGH' },
      })),
      ...Array.from({ length: 32 }, () => ({
        action: 'COMPLETE',
        id: foreign.id,
        revision: 1,
      })),
      ...Array.from({ length: 33 }, () => ({
        action: 'PATCH',
        id: owned.id,
        revision: 1,
        patch: { title: 'stale' },
      })),
    ];
    const result = await call(a, 'post', '/tasks/bulk')
      .set('Idempotency-Key', 'mixed-100')
      .send({ items })
      .expect(200);
    BulkTaskResponseSchema.parse(result.body);
    expect(result.body).toMatchObject({ succeeded: 33, failed: 67 });
    expect(result.body.items[1]).toMatchObject({
      status: 'REJECTED',
      error: { code: 'NOT_FOUND' },
    });
    expect(result.body.items[2]).toMatchObject({ error: { code: 'CONFLICT' } });
    expect(JSON.stringify(result.body)).not.toContain(foreign.title);
    expect((await readTask(owned.id)).status).toBe('DONE');
    const replay = await call(a, 'post', '/tasks/bulk')
      .set('Idempotency-Key', 'mixed-100')
      .send({ items })
      .expect(200);
    expect(replay.body).toEqual(result.body);
    expect(
      await db.client.outboxEvent.count({
        where: { aggregateId: owned.id, type: 'task.completed' },
      }),
    ).toBe(1);
  });
  it('deduplicates concurrent bulk requests, binds the entire body and requires keys', async () => {
    const owned = await task(),
      items = [{ action: 'COMPLETE', id: owned.id, revision: 1 }];
    const send = () =>
      call(a, 'post', '/tasks/bulk')
        .set('Idempotency-Key', 'bulk-concurrent')
        .send({ items });
    const [first, second] = await Promise.all([send(), send()]);
    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
    await call(a, 'post', '/tasks/bulk')
      .set('Idempotency-Key', 'bulk-concurrent')
      .send({ items: [{ action: 'DELETE', id: owned.id, revision: 2 }] })
      .expect(409);
    await call(a, 'post', '/tasks/bulk').send({ items }).expect(400);
    await call(a, 'post', '/tasks/bulk')
      .set('Idempotency-Key', 'too-many')
      .send({ items: Array(101).fill({}) })
      .expect(400);
    const foreignReplay = await call(b, 'post', '/tasks/bulk')
      .set('Idempotency-Key', 'bulk-concurrent')
      .send({ items })
      .expect(200);
    expect(foreignReplay.body.items[0]).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
  });
  it('isolates every new resource and nested operation from other owners', async () => {
    const s = await series(),
      o = (await generate(s, '2024-01-01')).items[0]!;
    const template = (
      await call(a, 'post', '/task-templates').send(templateInput).expect(201)
    ).body as { id: string };
    const filter = (
      await call(a, 'post', '/saved-task-filters')
        .send({
          name: 'Private',
          query: { version: 1, where: { status: 'OPEN' } },
        })
        .expect(201)
    ).body as { id: string };
    for (const path of [
      `/task-recurrences/${s.id}`,
      `/task-recurrences/${s.id}/occurrences`,
      `/task-occurrences/${o.id}`,
      `/task-templates/${template.id}`,
      `/saved-task-filters/${filter.id}`,
      `/saved-task-filters/${filter.id}/tasks`,
    ])
      await call(b, 'get', path).expect(404);
    await call(b, 'patch', `/task-recurrences/${s.id}`, 1)
      .send({ scope: 'ENTIRE_SERIES', definition: definition() })
      .expect(404);
    await call(b, 'post', `/task-occurrences/${o.id}/skip`, 1)
      .send({ taskRevision: 1 })
      .expect(404);
    await call(b, 'delete', `/task-recurrences/${s.id}`, 1).expect(404);
    await call(b, 'patch', `/task-templates/${template.id}`, 1)
      .send({ name: 'Foreign' })
      .expect(404);
    await call(b, 'delete', `/saved-task-filters/${filter.id}`, 1).expect(404);
    for (const route of [
      'task-recurrences',
      'task-templates',
      'saved-task-filters',
    ]) {
      const page = await call(b, 'get', '/' + route + '?limit=100').expect(200);
      expect(
        page.body.items.every(
          (row: { spaceId: string }) => row.spaceId === b.spaceId,
        ),
      ).toBe(true);
    }
  });
  it('enforces scoped foreign keys, uniqueness and state constraints in PostgreSQL', async () => {
    const s = await series(),
      o = (await generate(s, '2024-01-01')).items[0]!;
    const row = await db.client.taskOccurrence.findUniqueOrThrow({
      where: { id: o.id },
    });
    await expect(
      db.client.taskOccurrence.create({ data: { ...row, id: randomUUID() } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      db.client.taskOccurrence.create({
        data: {
          ...row,
          id: randomUUID(),
          spaceId: b.spaceId,
          taskId: null,
          recurrenceKey: '2024-01-02T09:00:00',
          state: 'SKIPPED',
          reason: 'DST_GAP',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      db.client.taskOccurrence.update({
        where: { id: o.id },
        data: { state: 'SKIPPED', reason: null },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.taskTemplate.create({
        data: {
          spaceId: a.spaceId,
          createdByUserId: b.id,
          name: 'bad-owner',
          values: templateInput.values,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
  it('rolls back generated Tasks, history, outbox and progress if occurrence insertion fails', async () => {
    const s = await series({ endDate: '2024-01-02' }),
      before = await db.client.task.count({ where: { spaceId: a.spaceId } });
    const original = TaskToolsStore.prototype.insertOccurrence;
    let insertions = 0;
    const spy = vi
      .spyOn(TaskToolsStore.prototype, 'insertOccurrence')
      .mockImplementation(async function (this: TaskToolsStore, input) {
        insertions++;
        if (insertions === 2)
          throw new Error('simulated interrupted generation');
        return original.call(this, input);
      });
    try {
      await call(a, 'post', `/task-recurrences/${s.id}/catch-up`)
        .send({ through: '2024-01-02', limit: 2 })
        .expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await db.client.task.count({ where: { spaceId: a.spaceId } })).toBe(
      before,
    );
    expect(
      await db.client.taskOccurrence.count({ where: { seriesId: s.id } }),
    ).toBe(0);
    expect(
      (
        await db.client.taskRecurrence.findUniqueOrThrow({
          where: { id: s.id },
        })
      ).scannedThrough,
    ).toBeNull();
    expect((await generate(s, '2024-01-02')).items).toHaveLength(2);
  });
  it('returns per-item validation failures and continues all supported bulk actions', async () => {
    const owned = await task(),
      label = (
        await call(a, 'post', '/labels')
          .send({ name: 'bulk-label' })
          .expect(201)
      ).body as { id: string };
    const send = (items: unknown[], key: string) =>
      call(a, 'post', '/tasks/bulk')
        .set('Idempotency-Key', key)
        .send({ items });
    const response = await send(
      [
        { action: 'UNKNOWN' },
        { action: 'ADD_LABEL', id: owned.id, revision: 1, labelId: label.id },
        {
          action: 'REMOVE_LABEL',
          id: owned.id,
          revision: 2,
          labelId: label.id,
        },
        { action: 'DELETE', id: owned.id, revision: 3 },
        { action: 'RESTORE', id: owned.id, revision: 4 },
        { action: 'COMPLETE', id: owned.id, revision: 5 },
        { action: 'REOPEN', id: owned.id, revision: 6 },
      ],
      'all-actions',
    ).expect(200);
    expect(response.body).toMatchObject({ succeeded: 6, failed: 1 });
    expect((await readTask(owned.id)).status).toBe('OPEN');
  });
  it('makes stale concurrent series edits conflict and hides mismatched nested occurrences', async () => {
    const s = await series(),
      other = await series(),
      o = (await generate(other, '2024-01-01')).items[0]!;
    await call(a, 'patch', `/task-recurrences/${s.id}`, 1)
      .send({
        scope: 'THIS_OCCURRENCE',
        occurrenceId: o.id,
        occurrenceRevision: 1,
        taskRevision: 1,
        patch: { title: 'wrong series' },
      })
      .expect(404);
    const edit = () =>
      call(a, 'patch', `/task-recurrences/${s.id}`, 1).send({
        scope: 'ENTIRE_SERIES',
        definition: definition({ localTime: '11:00' }),
      });
    const results = await Promise.all([edit(), edit()]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  });
  it('updates series fields only on pending non-exceptions and preserves terminal date context', async () => {
    const s = await series({
        startDate: '2024-03-09',
        endDate: '2024-03-11',
        localTime: '02:30',
        timezone: 'America/New_York',
      }),
      items = (await generate(s, '2024-03-11')).items;
    const gap = await readOccurrence(items[1]!.id);
    const edited = await call(a, 'patch', `/task-recurrences/${s.id}`, 1)
      .send({
        scope: 'ENTIRE_SERIES',
        definition: definition({
          startDate: '2024-03-09',
          endDate: '2024-03-11',
          localTime: '10:00',
          timezone: 'Asia/Tehran',
        }),
        taskPatch: { title: 'Revised series', priority: 'URGENT' },
      })
      .expect(200);
    expect(edited.body.series.definition.timezone).toBe('Asia/Tehran');
    expect((await readTask(s.masterTaskId)).title).toBe('Revised series');
    expect((await readTask(items[0]!.taskId!)).title).toBe('Revised series');
    expect(await readOccurrence(gap.id)).toEqual(gap);
    expect((await readOccurrence(items[0]!.id)).recurrenceKey).toBe(
      items[0]!.recurrenceKey,
    );
    await generate(s, '2024-03-11');
    expect(
      await db.client.taskOccurrence.count({ where: { seriesId: s.id } }),
    ).toBe(3);
  });
  it('converts an affected pending occurrence into a tracked DST skip while retaining its canceled Task history', async () => {
    const s = await series({
        startDate: '2024-03-10',
        endDate: '2024-03-10',
        localTime: '01:30',
        timezone: 'America/New_York',
      }),
      o = (await generate(s, '2024-03-10')).items[0]!;
    await call(a, 'patch', `/task-recurrences/${s.id}`, 1)
      .send({
        scope: 'ENTIRE_SERIES',
        definition: definition({
          startDate: '2024-03-10',
          endDate: '2024-03-10',
          localTime: '02:30',
          timezone: 'America/New_York',
        }),
      })
      .expect(200);
    expect(await readOccurrence(o.id)).toMatchObject({
      state: 'SKIPPED',
      reason: 'DST_GAP',
      localTime: '02:30',
      scheduledAt: null,
      taskId: o.taskId,
    });
    expect((await readTask(o.taskId!)).status).toBe('CANCELED');
    const tasks = await db.client.task.count({ where: { spaceId: a.spaceId } });
    await generate(s, '2024-03-10');
    expect(await db.client.task.count({ where: { spaceId: a.spaceId } })).toBe(
      tasks,
    );
  });
});
