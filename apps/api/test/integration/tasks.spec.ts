import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID, createHash } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { testApplication } from '../support/application.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import {
  TaskSchema,
  TaskPageSchema,
  TaskChangePageSchema,
} from '@mehran/api-contracts';
import { TasksRepository } from '../../src/modules/tasks/infrastructure/tasks.repository.js';
import { FileCatalog } from '../../src/platform/storage/public/index.js';
import { SpacesService } from '../../src/modules/spaces/public/index.js';

const databaseUrl = isolatedTestDatabaseUrl(process.env),
  origin = 'http://localhost:3000';
type Actor = { id: string; cookie: string; spaceId: string };
type Task = {
  id: string;
  revision: number;
  status: string;
  parentTaskId: string | null;
  completedAt: string | null;
  deletedAt: string | null;
};
describe('P1-01 tasks, organization and ownership', () => {
  let app: NestExpressApplication, db: DatabaseService, a: Actor, b: Actor;
  const users: string[] = [];
  const call = (
    actor: Actor,
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    revision?: number,
  ) => {
    const result = request(app.getHttpServer())
      [method]('/api/v1' + path)
      .set('Cookie', actor.cookie)
      .set('Origin', origin);
    if (revision !== undefined) result.set('If-Match', `"${revision}"`);
    return result;
  };
  async function identity(): Promise<Actor> {
    const email = `p101-${randomUUID()}@example.test`,
      password = 'test-only-task-password-123!';
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .send({ email, password, name: 'Task fixture' })
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
      .map((value) => value.split(';')[0])
      .join('; ');
    const space = await db.client.space.findFirstOrThrow({
      where: { ownerUserId: id },
    });
    return { id, cookie, spaceId: space.id };
  }
  const create = async (
    actor = a,
    input: object = { title: 'Task fixture' },
  ): Promise<Task> => {
    const response = await call(actor, 'post', '/tasks')
      .send(input)
      .expect(201);
    TaskSchema.parse(response.body);
    expect(response.headers.etag).toBe('"1"');
    return response.body as Task;
  };
  const child = async (parent: Task) =>
    (
      await call(a, 'post', `/tasks/${parent.id}/subtasks`)
        .send({ title: 'Child fixture' })
        .expect(201)
    ).body as Task;
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

  it('creates strict task contracts, safe rich content and independent UTC/date-only fields', async () => {
    const input = {
      title: '  سلام 😀  plan ',
      description: {
        format: 'MARKDOWN',
        version: 1,
        content: '<script>private text</script>\n**bold**',
      },
      plannedStartAt: '2026-10-28T18:00:00Z',
      dueAt: '2026-10-30T08:00:00Z',
      scheduledDate: '2026-10-29',
    };
    const task = await create(a, input);
    const response = await call(a, 'get', '/tasks/' + task.id).expect(200);
    expect(response.body).toMatchObject({
      title: 'سلام 😀 plan',
      description: input.description,
      status: 'OPEN',
      priority: 'NONE',
      scheduledDate: '2026-10-29',
      completedAt: null,
      plannedStartAt: '2026-10-28T18:00:00.000Z',
    });
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).not.toHaveProperty('deletionBatchId');
    const page = await call(a, 'get', '/tasks?scheduledDate=2026-10-29').expect(
      200,
    );
    TaskPageSchema.parse(page.body);
    expect(page.body.items.map((item: Task) => item.id)).toContain(task.id);
    for (const body of [
      { title: 'x', status: 'DONE' },
      { title: 'x', spaceId: b.spaceId },
      { title: 'x', createdByUserId: b.id },
      { title: 'x', revision: 99 },
      { title: 'x', recurrence: {} },
      { title: 'x', scheduledDate: '2026-02-29' },
      { title: 'x', description: { format: 'HTML', version: 1, content: 'x' } },
    ])
      await call(a, 'post', '/tasks').send(body).expect(400);
  });
  it('requires strong revisions, preserves successful writes and rejects stale concurrent updates', async () => {
    const task = await create();
    await call(a, 'patch', '/tasks/' + task.id)
      .send({ title: 'no revision' })
      .expect(400);
    for (const tag of ['1', 'W/"1"', '*', '"0"'])
      await call(a, 'patch', '/tasks/' + task.id)
        .set('If-Match', tag)
        .send({ title: 'invalid' })
        .expect(400);
    const results = await Promise.all(
      ['first', 'second'].map((title) =>
        call(a, 'patch', '/tasks/' + task.id, 1).send({ title }),
      ),
    );
    expect(results.map((value) => value.status).sort()).toEqual([200, 409]);
    expect(
      (await call(a, 'get', '/tasks/' + task.id).expect(200)).body.revision,
    ).toBe(2);
    await call(a, 'patch', '/tasks/' + task.id, 1)
      .send({ title: 'stale' })
      .expect(409);
    expect(
      await db.client.taskChange.count({ where: { taskId: task.id } }),
    ).toBe(2);
  });
  it('completes once under concurrency, reopens explicitly and retains private immutable history', async () => {
    const task = await create(a, {
      title: 'private task',
      description: {
        format: 'MARKDOWN',
        version: 1,
        content: 'private description',
      },
    });
    const results = await Promise.all([
      call(a, 'post', `/tasks/${task.id}/complete`, 1).send({}),
      call(a, 'post', `/tasks/${task.id}/complete`, 1).send({}),
    ]);
    expect(results.map((value) => value.status).sort()).toEqual([200, 409]);
    const done = results.find((value) => value.status === 200)!.body as Task;
    expect(done.completedAt).not.toBeNull();
    const repeated = await call(a, 'post', `/tasks/${task.id}/complete`, 2)
      .send({})
      .expect(200);
    expect(repeated.body.revision).toBe(2);
    await call(a, 'patch', `/tasks/${task.id}`, 2)
      .send({ status: 'OPEN' })
      .expect(409);
    const reopened = await call(a, 'post', `/tasks/${task.id}/reopen`, 2)
      .send({})
      .expect(200);
    expect(reopened.body).toMatchObject({
      status: 'OPEN',
      completedAt: null,
      revision: 3,
    });
    const changes = await call(a, 'get', `/tasks/${task.id}/history`).expect(
      200,
    );
    TaskChangePageSchema.parse(changes.body);
    expect(
      changes.body.items.map((item: { kind: string }) => item.kind),
    ).toEqual(['CREATED', 'COMPLETED', 'REOPENED']);
    expect(JSON.stringify(changes.body)).not.toContain('private');
    const events = await db.client.outboxEvent.findMany({
      where: { aggregateId: task.id },
      orderBy: { occurredAt: 'asc' },
    });
    expect(events.map((event) => event.type)).toEqual([
      'task.created',
      'task.completed',
      'task.reopened',
    ]);
    expect(
      events.every((event) => JSON.stringify(event.payload) === '{}'),
    ).toBe(true);
  });
  it('changes due date atomically and retains no-op revision and event counts', async () => {
    const task = await create();
    const input = { dueAt: '2026-11-01T00:00:00Z', priority: 'HIGH' };
    await call(a, 'patch', '/tasks/' + task.id, 1)
      .send(input)
      .expect(200);
    const repeated = await call(a, 'patch', '/tasks/' + task.id, 2)
      .send(input)
      .expect(200);
    expect(repeated.body.revision).toBe(2);
    expect(
      await db.client.outboxEvent.count({
        where: { aggregateId: task.id, type: 'task.due_changed' },
      }),
    ).toBe(1);
    expect(
      await db.client.taskChange.count({ where: { taskId: task.id } }),
    ).toBe(2);
  });
  it('prevents cycles, bounds five nesting edges and accounts for full subtree height when moving', async () => {
    const root = await create(),
      nodes = [root];
    for (let depth = 0; depth < 5; depth++)
      nodes.push(await child(nodes.at(-1)!));
    await call(a, 'post', `/tasks/${nodes.at(-1)!.id}/subtasks`)
      .send({ title: 'too deep' })
      .expect(400);
    await call(a, 'patch', `/tasks/${root.id}`, 1)
      .send({ parentTaskId: nodes[2]!.id })
      .expect(400);
    await call(a, 'patch', `/tasks/${root.id}`, 1)
      .send({ parentTaskId: root.id })
      .expect(400);
    const other = await create();
    await call(a, 'patch', `/tasks/${root.id}`, 1)
      .send({ parentTaskId: other.id })
      .expect(400);
    const listing = await call(
      a,
      'get',
      `/tasks/${root.id}/subtasks?recursive=true`,
    ).expect(200);
    expect(listing.body.items).toHaveLength(5);
    const direct = await call(a, 'get', `/tasks/${root.id}/subtasks`).expect(
      200,
    );
    expect(direct.body.items).toHaveLength(1);
  });
  it('serializes concurrent cross-reparenting so two valid isolated requests cannot create a cycle', async () => {
    const first = await create(),
      second = await create();
    const results = await Promise.all([
      call(a, 'patch', '/tasks/' + first.id, 1).send({
        parentTaskId: second.id,
      }),
      call(a, 'patch', '/tasks/' + second.id, 1).send({
        parentTaskId: first.id,
      }),
    ]);
    expect(results.map((value) => value.status).sort()).toEqual([200, 400]);
  });
  it('soft-deletes and restores subtrees without rewriting independently recovered descendants', async () => {
    const root = await create(),
      one = await child(root),
      two = await child(one);
    const deleted = await call(a, 'delete', '/tasks/' + root.id, 1).expect(200);
    expect(deleted.body.restoreUntil).not.toBeNull();
    for (const node of [root, one, two])
      await call(a, 'get', '/tasks/' + node.id).expect(404);
    await call(a, 'get', '/tasks/' + one.id + '?includeDeleted=true').expect(
      200,
    );
    await call(a, 'post', `/tasks/${one.id}/restore`, 2).send({}).expect(200);
    await call(a, 'patch', '/tasks/' + one.id, 3)
      .send({ title: 'independent recovery' })
      .expect(200);
    await call(a, 'delete', '/tasks/' + one.id, 4).expect(200);
    await call(a, 'post', `/tasks/${root.id}/restore`, 2).send({}).expect(200);
    await call(a, 'get', '/tasks/' + root.id).expect(200);
    await call(a, 'get', '/tasks/' + one.id).expect(404);
    await call(a, 'get', '/tasks/' + two.id).expect(404);
    expect(
      await db.client.task.count({
        where: { id: { in: [root.id, one.id, two.id] } },
      }),
    ).toBe(3);
  });
  it('rejects expired restoration and never purges records while hiding expired trash', async () => {
    const task = await create();
    await call(a, 'delete', '/tasks/' + task.id, 1).expect(200);
    await db.client.task.update({
      where: { id: task.id },
      data: { deletedAt: new Date(Date.now() - 31 * 86400000) },
    });
    await call(a, 'post', `/tasks/${task.id}/restore`, 2).send({}).expect(409);
    await call(a, 'get', '/tasks/' + task.id + '?includeDeleted=true').expect(
      404,
    );
    const page = await call(a, 'get', '/tasks?deleted=true').expect(200);
    expect(page.body.items.map((item: Task) => item.id)).not.toContain(task.id);
    expect(await db.client.task.count({ where: { id: task.id } })).toBe(1);
  });
  it('orders checklist items deterministically, paginates ties and never completes the parent implicitly', async () => {
    const task = await create();
    const first = (
      await call(a, 'post', `/tasks/${task.id}/checklist-items`, 1)
        .send({ title: 'later', position: 5 })
        .expect(201)
    ).body.item as { id: string };
    const second = (
      await call(a, 'post', `/tasks/${task.id}/checklist-items`, 2)
        .send({ title: 'first', position: 0 })
        .expect(201)
    ).body.item as { id: string };
    await call(a, 'post', `/tasks/${task.id}/checklist-items`, 3)
      .send({ title: 'tie', position: 0 })
      .expect(201);
    const page = await call(
      a,
      'get',
      `/tasks/${task.id}/checklist-items?limit=1`,
    ).expect(200);
    expect(page.body.items[0].position).toBe(0);
    const next = await call(
      a,
      'get',
      `/tasks/${task.id}/checklist-items?limit=1&cursor=${page.body.nextCursor}`,
    ).expect(200);
    expect(next.body.items[0].id).not.toBe(page.body.items[0].id);
    expect(next.body.items[0].position).toBe(0);
    const patched = await call(
      a,
      'patch',
      `/tasks/${task.id}/checklist-items/${first.id}`,
      4,
    )
      .send({ position: 0, completed: true })
      .expect(200);
    expect(patched.body.task.status).toBe('OPEN');
    const other = await create();
    await call(a, 'patch', `/tasks/${other.id}/checklist-items/${first.id}`, 1)
      .send({ completed: true })
      .expect(404);
    await call(a, 'patch', `/tasks/${task.id}/checklist-items/${first.id}`, 4)
      .send({ completed: false })
      .expect(409);
    await call(
      a,
      'delete',
      `/tasks/${task.id}/checklist-items/${second.id}`,
      5,
    ).expect(200);
    await call(
      a,
      'get',
      `/tasks/${other.id}/checklist-items?cursor=${page.body.nextCursor}`,
    ).expect(400);
  });
  it('enforces case-insensitive per-space labels, association idempotency and revision-safe label deletion', async () => {
    const name = 'Organization ' + randomUUID();
    const label = (await call(a, 'post', '/labels').send({ name }).expect(201))
      .body as { id: string };
    await call(a, 'post', '/labels')
      .send({ name: name.toUpperCase() })
      .expect(409);
    await call(b, 'post', '/labels')
      .send({ name: name.toUpperCase() })
      .expect(201);
    const task = await create();
    await call(a, 'put', `/tasks/${task.id}/labels/${label.id}`, 1)
      .send({})
      .expect(200);
    const repeated = await call(
      a,
      'put',
      `/tasks/${task.id}/labels/${label.id}`,
      2,
    )
      .send({})
      .expect(200);
    expect(repeated.body.revision).toBe(2);
    expect(
      (
        await call(a, 'get', `/tasks?labelId=${label.id}`).expect(200)
      ).body.items.map((item: Task) => item.id),
    ).toContain(task.id);
    await call(a, 'patch', '/labels/' + label.id, 1)
      .send({ name: 'Renamed ' + name })
      .expect(200);
    await call(a, 'delete', '/labels/' + label.id, 1).expect(409);
    await call(a, 'delete', '/labels/' + label.id, 2).expect(204);
    expect(
      (await call(a, 'get', '/tasks/' + task.id).expect(200)).body.revision,
    ).toBe(3);
    expect(
      (await call(a, 'get', `/tasks/${task.id}/labels`).expect(200)).body.items,
    ).toEqual([]);
    const history = await call(a, 'get', `/tasks/${task.id}/history`).expect(
      200,
    );
    expect(history.body.items.at(-1).kind).toBe('LABEL_REMOVED');
  });
  it('binds only owned READY preexisting files, keeps private metadata and permits unlink after file deletion', async () => {
    const bytes = Buffer.from('private attached content'),
      sha256 = createHash('sha256').update(bytes).digest('hex');
    const file = (
      await call(a, 'post', '/files/uploads')
        .send({
          filename: 'private attachment.txt',
          mimeType: 'text/plain',
          expectedSize: bytes.length,
          sha256,
        })
        .expect(201)
    ).body as { id: string };
    const task = await create();
    await call(a, 'put', `/tasks/${task.id}/attachments/${file.id}`, 1)
      .send({})
      .expect(404);
    await call(a, 'post', `/files/${file.id}/complete`)
      .set('Content-Type', 'application/octet-stream')
      .send(bytes)
      .expect(200);
    const other = await create(b);
    await call(b, 'put', `/tasks/${other.id}/attachments/${file.id}`, 1)
      .send({})
      .expect(404);
    await call(a, 'put', `/tasks/${task.id}/attachments/${file.id}`, 1)
      .send({})
      .expect(200);
    const repeated = await call(
      a,
      'put',
      `/tasks/${task.id}/attachments/${file.id}`,
      2,
    )
      .send({})
      .expect(200);
    expect(repeated.body.revision).toBe(2);
    const page = await call(a, 'get', `/tasks/${task.id}/attachments`).expect(
      200,
    );
    expect(page.body.items[0]).toMatchObject({
      fileId: file.id,
      status: 'READY',
      size: bytes.length,
    });
    const stored = await db.client.storedFile.findUniqueOrThrow({
      where: { id: file.id },
    });
    expect(JSON.stringify(page.body)).not.toContain(stored.objectKey);
    expect(JSON.stringify(page.body)).not.toContain('download');
    await call(a, 'delete', '/files/' + file.id).expect(204);
    expect(
      (await call(a, 'get', `/tasks/${task.id}/attachments`).expect(200)).body
        .items[0].status,
    ).toBe('DELETED');
    await call(
      a,
      'delete',
      `/tasks/${task.id}/attachments/${file.id}`,
      2,
    ).expect(200);
  });
  it('denies every foreign task, nested read and mutation without returning resource contents', async () => {
    const task = await create(a, { title: 'private isolation sentinel' }),
      own = await create(b);
    for (const tail of [
      '',
      '/history',
      '/subtasks',
      '/checklist-items',
      '/labels',
      '/attachments',
    ]) {
      const response = await call(b, 'get', '/tasks/' + task.id + tail).expect(
        404,
      );
      expect(JSON.stringify(response.body)).not.toContain('sentinel');
    }
    for (const action of ['complete', 'reopen', 'restore'])
      await call(b, 'post', `/tasks/${task.id}/${action}`, 1)
        .send({})
        .expect(404);
    await call(b, 'delete', '/tasks/' + task.id, 1).expect(404);
    await call(b, 'patch', '/tasks/' + task.id, 1)
      .send({ title: 'attack' })
      .expect(404);
    await call(b, 'post', `/tasks/${task.id}/subtasks`)
      .send({ title: 'attack' })
      .expect(404);
    await call(b, 'post', `/tasks/${task.id}/checklist-items`, 1)
      .send({ title: 'attack' })
      .expect(404);
    await call(b, 'patch', '/tasks/' + own.id, 1)
      .send({ parentTaskId: task.id })
      .expect(404);
    await call(b, 'get', '/tasks?parentTaskId=' + task.id).expect(404);
    expect(
      (await call(b, 'get', '/tasks').expect(200)).body.items.map(
        (item: Task) => item.id,
      ),
    ).not.toContain(task.id);
    const audits = await db.client.securityAuditEvent.count({
      where: {
        actorUserId: b.id,
        action: 'ACCESS_DENIED',
        resourceId: task.id,
      },
    });
    expect(audits).toBeGreaterThan(0);
  });
  it('isolates label lookup, assignment, modification and deletion across users', async () => {
    const label = (
      await call(a, 'post', '/labels').send({ name: randomUUID() }).expect(201)
    ).body as { id: string };
    const task = await create(b);
    await call(b, 'get', '/labels/' + label.id).expect(404);
    await call(b, 'get', '/tasks?labelId=' + label.id).expect(404);
    await call(b, 'patch', '/labels/' + label.id, 1)
      .send({ name: 'attack' })
      .expect(404);
    await call(b, 'delete', '/labels/' + label.id, 1).expect(404);
    for (const method of ['put', 'delete'] as const)
      await call(b, method, `/tasks/${task.id}/labels/${label.id}`, 1)
        .send({})
        .expect(404);
  });
  it('bounds page sizes, binds cursors to owner and filters and scopes history pagination', async () => {
    await create();
    await create();
    for (const query of [
      'limit=0',
      'limit=101',
      'unexpected=true',
      'cursor=invalid',
    ])
      await call(a, 'get', '/tasks?' + query).expect(400);
    const page = await call(a, 'get', '/tasks?limit=1').expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.nextCursor).toBeTruthy();
    const next = await call(
      a,
      'get',
      '/tasks?limit=1&cursor=' + page.body.nextCursor,
    ).expect(200);
    expect(next.body.items[0].id).not.toBe(page.body.items[0].id);
    await call(b, 'get', '/tasks?cursor=' + page.body.nextCursor).expect(400);
    await call(
      a,
      'get',
      '/tasks?status=DONE&cursor=' + page.body.nextCursor,
    ).expect(400);
    const task = await create();
    await call(a, 'patch', '/tasks/' + task.id, 1)
      .send({ title: 'history change' })
      .expect(200);
    const history = await call(
      a,
      'get',
      `/tasks/${task.id}/history?limit=1`,
    ).expect(200);
    const rest = await call(
      a,
      'get',
      `/tasks/${task.id}/history?cursor=${history.body.nextCursor}`,
    ).expect(200);
    expect(rest.body.items[0].revision).toBe(2);
  });
  it('replays concurrent Task creation safely and binds receipts to body, actor and parent', async () => {
    const key = randomUUID(),
      body = { title: 'idempotent task' };
    const results = await Promise.all(
      [1, 2].map(() =>
        call(a, 'post', '/tasks')
          .set('Idempotency-Key', key)
          .send(body)
          .expect(201),
      ),
    );
    expect(results[0]!.body.id).toBe(results[1]!.body.id);
    expect(
      await db.client.taskChange.count({
        where: { taskId: results[0]!.body.id },
      }),
    ).toBe(1);
    await call(a, 'post', '/tasks')
      .set('Idempotency-Key', key)
      .send({ title: 'different' })
      .expect(409);
    const foreign = await call(b, 'post', '/tasks')
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    expect(foreign.body.id).not.toBe(results[0]!.body.id);
    const root = await create();
    await call(a, 'post', `/tasks/${root.id}/subtasks`)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(409);
  });
  it('rolls back task state, history and outbox together if the transaction fails', async () => {
    const scope = await app.get(SpacesService).authorizePersonal({
      userId: a.id,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    });
    const repository = new TasksRepository(db, app.get(FileCatalog));
    const task = await create();
    await expect(
      repository.transaction(scope, async (tx) => {
        const before = await tx.task(task.id);
        await tx.updateTask(before, { title: 'rollback marker' });
        await tx.events('task.updated', [task.id]);
        await tx.record([
          {
            taskId: task.id,
            kind: 'UPDATED',
            fields: ['title'],
            previousRevision: 1,
            revision: 2,
            beforeStatus: 'OPEN',
            afterStatus: 'OPEN',
            beforePriority: 'NONE',
            afterPriority: 'NONE',
            relatedId: null,
          },
        ]);
        throw new Error('fixture rollback');
      }),
    ).rejects.toThrow('fixture rollback');
    const persisted = await db.client.task.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(persisted.revision).toBe(1);
    expect(persisted.title).not.toBe('rollback marker');
    expect(
      await db.client.outboxEvent.count({ where: { aggregateId: task.id } }),
    ).toBe(1);
    expect(
      await db.client.taskChange.count({ where: { taskId: task.id } }),
    ).toBe(1);
  });
  it('enforces same-space relationships and state invariants in PostgreSQL', async () => {
    const task = await create(),
      foreign = await create(b);
    await expect(
      db.client.task.update({
        where: { id: task.id },
        data: { parentTaskId: foreign.id },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.task.update({
        where: { id: task.id },
        data: { parentTaskId: task.id },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.task.update({
        where: { id: task.id },
        data: { status: 'DONE' },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.task.update({ where: { id: task.id }, data: { revision: 0 } }),
    ).rejects.toThrow();
    const label = await db.client.label.create({
      data: { spaceId: b.spaceId, name: randomUUID() },
    });
    await expect(
      db.client.taskLabel.create({
        data: { spaceId: a.spaceId, taskId: task.id, labelId: label.id },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.taskChecklistItem.create({
        data: {
          spaceId: b.spaceId,
          taskId: task.id,
          title: 'bad scope',
          position: 0,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.taskChecklistItem.create({
        data: {
          spaceId: a.spaceId,
          taskId: task.id,
          title: 'bad order',
          position: -1,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.label.create({
        data: { spaceId: b.spaceId, name: label.name.toUpperCase() },
      }),
    ).rejects.toThrow();
  });
  it('authorizes from Space ownership rather than creator identity', async () => {
    const task = await create();
    await db.client.task.update({
      where: { id: task.id },
      data: { createdByUserId: b.id },
    });
    await call(a, 'get', '/tasks/' + task.id).expect(200);
    await call(b, 'get', '/tasks/' + task.id).expect(404);
  });
  it('blocks unverified and revoked sessions from Task and Label endpoints', async () => {
    const actor = await identity();
    await db.client.user.update({
      where: { id: actor.id },
      data: { emailVerified: false },
    });
    await call(actor, 'get', '/tasks').expect(403);
    await db.client.user.update({
      where: { id: actor.id },
      data: { emailVerified: true },
    });
    await call(actor, 'post', '/auth/sign-out').send({}).expect(200);
    await call(actor, 'get', '/tasks').expect(401);
    await call(actor, 'get', '/labels').expect(401);
  });
  it('locks file readiness throughout the linking transaction and rolls back links on failure', async () => {
    const task = await create(),
      file = await db.client.storedFile.create({
        data: {
          spaceId: a.spaceId,
          ownerUserId: a.id,
          objectKey: randomUUID(),
          filename: 'lock fixture.txt',
          mimeType: 'text/plain',
          expectedSize: 7,
          actualSize: 7,
          sha256: 'a'.repeat(64),
          status: 'READY',
          completedAt: new Date(),
          uploadExpiresAt: new Date(Date.now() + 3600000),
        },
      });
    const scope = await app.get(SpacesService).authorizePersonal({
      userId: a.id,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    });
    const repository = new TasksRepository(db, app.get(FileCatalog));
    await expect(
      repository.transaction(scope, async (tx) => {
        await tx.setAttachment(task.id, file.id, true);
        await expect(
          db.client.$transaction(async (competing) => {
            await competing.$executeRawUnsafe(
              "SET LOCAL lock_timeout = '100ms'",
            );
            await competing.storedFile.update({
              where: { id: file.id },
              data: { status: 'DELETED', deletedAt: new Date() },
            });
          }),
        ).rejects.toThrow();
        throw new Error('fixture link rollback');
      }),
    ).rejects.toThrow('fixture link rollback');
    expect(
      await db.client.taskAttachment.count({ where: { taskId: task.id } }),
    ).toBe(0);
    expect(
      (await db.client.storedFile.findUniqueOrThrow({ where: { id: file.id } }))
        .status,
    ).toBe('READY');
    const foreign = await create(b);
    await expect(
      db.client.taskAttachment.create({
        data: { spaceId: b.spaceId, taskId: foreign.id, fileId: file.id },
      }),
    ).rejects.toThrow();
  });
  it('restores ordinary descendants, preserves preexisting trash and permits detaching a recovered child', async () => {
    const root = await create(),
      ordinary = await child(root),
      grandchild = await child(ordinary),
      oldTrash = await child(root),
      independent = await child(root);
    await call(a, 'delete', '/tasks/' + oldTrash.id, 1).expect(200);
    await call(a, 'delete', '/tasks/' + root.id, 1).expect(200);
    await call(a, 'post', '/tasks/' + independent.id + '/restore', 2)
      .send({})
      .expect(200);
    await call(a, 'patch', '/tasks/' + independent.id, 3)
      .send({ parentTaskId: null })
      .expect(200);
    await call(a, 'post', '/tasks/' + root.id + '/restore', 2)
      .send({})
      .expect(200);
    for (const id of [ordinary.id, grandchild.id])
      expect(
        (await call(a, 'get', '/tasks/' + id).expect(200)).body.revision,
      ).toBe(3);
    expect(
      (await call(a, 'get', '/tasks/' + independent.id).expect(200)).body,
    ).toMatchObject({ parentTaskId: null, revision: 4 });
    await call(a, 'get', '/tasks/' + oldTrash.id).expect(404);
  });
  it('treats SQL and HTML strings as data and rejects invalid history metadata at the DB boundary', async () => {
    const title = "'; SELECT pg_sleep(5); -- <script>secret</script>",
      task = await create(a, { title });
    expect(
      (await call(a, 'get', '/tasks/' + task.id).expect(200)).body.title,
    ).toBe(title);
    const history = await call(
      a,
      'get',
      '/tasks/' + task.id + '/history',
    ).expect(200);
    expect(JSON.stringify(history.body)).not.toContain('script');
    await expect(
      db.client.taskChange.create({
        data: {
          spaceId: a.spaceId,
          taskId: task.id,
          actorUserId: a.id,
          kind: 'UPDATED',
          fields: ['private body'],
          previousRevision: 1,
          revision: 2,
          beforeStatus: 'OPEN',
          afterStatus: 'OPEN',
          beforePriority: 'NONE',
          afterPriority: 'NONE',
        },
      }),
    ).rejects.toThrow();
  });
  it('retains session and CSRF protections and permits trusted PUT preflight', async () => {
    await request(app.getHttpServer()).get('/api/v1/tasks').expect(401);
    const task = await create();
    await request(app.getHttpServer())
      .patch('/api/v1/tasks/' + task.id)
      .set('Cookie', a.cookie)
      .set('If-Match', '"1"')
      .send({ title: 'missing origin' })
      .expect(403);
    await call(a, 'patch', '/tasks/' + task.id, 1)
      .set('Origin', 'https://attacker.invalid')
      .send({ title: 'foreign origin' })
      .expect(403);
    const preflight = await request(app.getHttpServer())
      .options(`/api/v1/tasks/${task.id}/labels/${randomUUID()}`)
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'PUT')
      .set('Access-Control-Request-Headers', 'if-match,content-type')
      .expect(204);
    expect(preflight.headers['access-control-allow-methods']).toContain('PUT');
  });
});
