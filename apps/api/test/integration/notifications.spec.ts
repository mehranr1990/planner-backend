import { cleanupFixtureIdentities } from '../support/fixture-cleanup.js';
import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import request from 'supertest';
import { randomUUID, createECDH } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as c from '@mehran/api-contracts';
import { testApplication } from '../support/application.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import { NotificationsPort } from '../../src/modules/notifications/application/notifications.port.js';
import { NotificationTransport } from '../../src/modules/notifications/application/transport.port.js';
type Actor = { id: string; spaceId: string; cookie: string };
describe('P1-10 private durable reminder scheduling and delivery', () => {
  let app: NestExpressApplication,
    db: DatabaseService,
    port: NotificationsPort,
    a: Actor,
    b: Actor;
  const users: string[] = [],
    origin = 'http://localhost:3000',
    databaseUrl = isolatedTestDatabaseUrl(process.env);
  const call = (
    actor: Actor,
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    revision?: number,
    key = randomUUID(),
  ) => {
    const r = request(app.getHttpServer())
      [method]('/api/v1' + path)
      .set('Cookie', actor.cookie)
      .set('Origin', origin);
    if (method !== 'get') r.set('Idempotency-Key', key);
    if (revision !== undefined) r.set('If-Match', '"' + revision + '"');
    return r;
  };
  async function identity() {
    const email = 'p110-' + randomUUID() + '@example.test',
      password = 'test-only-notifications-password-123!';
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .send({ email, password, name: 'Reminder fixture' })
      .expect(200);
    users.push(signup.body.user.id as string);
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
    const id = signup.body.user.id as string,
      space = await db.client.space.findFirstOrThrow({
        where: { ownerUserId: id },
      });
    return {
      id,
      spaceId: space.id,
      cookie: (login.headers['set-cookie'] as unknown as string[])
        .map((v) => v.split(';')[0])
        .join('; '),
    };
  }
  const at = (minutes = 0) =>
    new Date(Date.now() + minutes * 60000).toISOString();
  async function reminder(body: object = {}, actor = a) {
    return c.ReminderSchema.parse(
      (
        await call(actor, 'post', '/reminders')
          .send({
            title: 'Private journal finance reminder secret',
            rule: { version: 1, kind: 'ABSOLUTE', at: at(-1) },
            ...body,
          })
          .expect(201)
      ).body,
    );
  }
  async function deliveries(id: string, actor = a) {
    return c.NotificationDeliveryPageSchema.parse(
      (
        await call(
          actor,
          'get',
          '/reminders/' + id + '/deliveries?limit=100',
        ).expect(200)
      ).body,
    ).items;
  }
  async function preference(actor = a, body: object = {}) {
    const p = (
      await call(actor, 'get', '/notifications/preferences').expect(200)
    ).body as c.NotificationPreference;
    return c.NotificationPreferenceSchema.parse(
      (
        await call(actor, 'patch', '/notifications/preferences', p.revision)
          .send(body)
          .expect(200)
      ).body,
    );
  }
  async function task(actor = a) {
    return (
      await call(actor, 'post', '/tasks')
        .send({ title: 'Task source', dueAt: at(60) })
        .expect(201)
    ).body as { id: string; revision: number; dueAt: string; status: string };
  }
  async function settleOutbox(actor = a) {
    const where = {
        spaceId: actor.spaceId,
        type: {
          in: [
            'account.timezone_changed',
            'reminder.changed',
            'task.created',
            'task.updated',
            'task.completed',
            'task.reopened',
            'task.deleted',
            'task.due_changed',
          ],
        },
        notificationHandledAt: null,
      },
      ids = (
        await db.client.outboxEvent.findMany({ where, select: { id: true } })
      ).map((e) => e.id);
    for (let pass = 0; pass < 100; pass++) {
      for (let n = 0; n < 100 && (await port.consumeOutbox()); n++) {}
      const left = await db.client.outboxEvent.findMany({
        where: { id: { in: ids }, notificationHandledAt: null },
        select: { notificationFailureCode: true },
      });
      if (!left.length) return;
      if (left.some((e) => e.notificationFailureCode))
        throw new Error('Owned notification reconciliation failed');
    }
    throw new Error('Owned outbox did not settle in bounded passes');
  }
  async function dispatch(r: c.Reminder) {
    for (const d of await deliveries(r.id)) await port.dispatch(d.id);
  }
  beforeAll(async () => {
    app = await testApplication({
      databaseUrl: isolatedTestDatabaseUrl(process.env),
      environment: {
        NOTIFICATION_EMAIL_ENABLED: 'true',
        PUSH_MODE: 'sink',
        DB_HEALTH_TIMEOUT_MS: '2000',
      },
    });
    db = app.get(DatabaseService);
    port = app.get(NotificationsPort);
    a = await identity();
    b = await identity();
    await app.listen(0, '127.0.0.1');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    if (db) await cleanupFixtureIdentities(databaseUrl, { ids: users });
    await app?.close();
  });
  it('creates once with request replay and rejects reused mismatched keys', async () => {
    const key = randomUUID(),
      body = { rule: { version: 1, kind: 'ABSOLUTE', at: at(10) } };
    const one = await call(a, 'post', '/reminders', undefined, key)
        .send(body)
        .expect(201),
      two = await call(a, 'post', '/reminders', undefined, key)
        .send(body)
        .expect(201);
    expect(two.body).toEqual(one.body);
    await call(a, 'post', '/reminders', undefined, key)
      .send({ ...body, title: 'different' })
      .expect(409);
  });
  it('publishes in-app exactly once under concurrent dispatch and duplicate jobs', async () => {
    const r = await reminder(),
      d = (await deliveries(r.id))[0]!;
    await Promise.all([
      port.dispatch(d.id),
      port.dispatch(d.id),
      port.dispatch(d.id),
    ]);
    const rows = await deliveries(r.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe('DELIVERED');
    expect(
      await db.client.notification.count({ where: { reminderId: r.id } }),
    ).toBe(1);
  });
  it('enforces foreign ownership on all resource families and nested reads', async () => {
    const r = await reminder();
    await dispatch(r);
    const n = await db.client.notification.findFirstOrThrow({
      where: { reminderId: r.id },
    });
    for (const p of [
      '/reminders/' + r.id,
      '/reminders/' + r.id + '/deliveries',
      '/notifications/' + n.id,
    ])
      await call(b, 'get', p).expect(404);
    await call(b, 'patch', '/reminders/' + r.id, 1)
      .send({ title: 'foreign' })
      .expect(404);
    await call(b, 'patch', '/notifications/' + n.id + '/read', 1)
      .send({ read: true })
      .expect(404);
    await call(b, 'post', '/notifications/' + n.id + '/snooze', 1)
      .send({ until: at(30) })
      .expect(404);
    const list = await call(b, 'get', '/notifications?history=true').expect(
      200,
    );
    expect(list.body.items).toEqual([]);
  });
  it('requires revisions, strict shapes and trusted origins', async () => {
    const r = await reminder();
    await call(a, 'patch', '/reminders/' + r.id)
      .send({ title: 'missing revision' })
      .expect(400);
    await call(a, 'patch', '/reminders/' + r.id, r.revision)
      .send({ ownerUserId: b.id })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/reminders')
      .set('Cookie', a.cookie)
      .set('Origin', 'https://evil.invalid')
      .set('Idempotency-Key', randomUUID())
      .send({ rule: { version: 1, kind: 'ABSOLUTE', at: at() } })
      .expect(403);
  });
  it('revision checks choose one concurrent edit', async () => {
    const r = await reminder({
      rule: { version: 1, kind: 'ABSOLUTE', at: at(30) },
    });
    const results = await Promise.all(
      ['one', 'two'].map((title) =>
        call(a, 'patch', '/reminders/' + r.id, r.revision).send({ title }),
      ),
    );
    expect(results.map((v) => v.status).sort()).toEqual([200, 409]);
  });
  it('pause cancels unsent, resume is future-only, manual cancel stays canceled', async () => {
    const r = await reminder({
        rule: { version: 1, kind: 'ABSOLUTE', at: at(30) },
      }),
      paused = await call(
        a,
        'post',
        '/reminders/' + r.id + '/pause',
        r.revision,
      )
        .send({})
        .expect(200);
    expect((await deliveries(r.id))[0]!.state).toBe('CANCELED');
    const resumed = await call(
      a,
      'post',
      '/reminders/' + r.id + '/resume',
      paused.body.revision,
    )
      .send({})
      .expect(200);
    expect((await deliveries(r.id))[0]!.state).toBe('PENDING');
    await call(a, 'delete', '/reminders/' + r.id, resumed.body.revision).expect(
      200,
    );
    expect((await deliveries(r.id))[0]!.state).toBe('CANCELED');
  });
  it('recalculates relative Task dates without touching the Task', async () => {
    const t = await task(),
      r = await reminder({
        taskId: t.id,
        taskRevision: t.revision,
        rule: { version: 1, kind: 'TASK', field: 'DUE_AT', offsetMinutes: -5 },
      });
    const old = (await deliveries(r.id))[0]!;
    const changed = await call(a, 'patch', '/tasks/' + t.id, t.revision)
      .send({ dueAt: at(120) })
      .expect(200);
    await settleOutbox();
    const rows = await deliveries(r.id);
    expect(rows.find((d) => d.id === old.id)!.state).toBe('CANCELED');
    expect(rows.filter((d) => d.state === 'PENDING')).toHaveLength(1);
    expect(
      (await db.client.task.findUniqueOrThrow({ where: { id: t.id } }))
        .revision,
    ).toBe(changed.body.revision);
  });
  it('does not deliver completed Task reminders even before outbox consumption', async () => {
    const t = await task(),
      r = await reminder({ taskId: t.id, taskRevision: t.revision });
    await call(a, 'post', '/tasks/' + t.id + '/complete', t.revision)
      .send({})
      .expect(200);
    await dispatch(r);
    expect((await deliveries(r.id))[0]!.state).toBe('CANCELED');
    expect(
      await db.client.notification.count({ where: { reminderId: r.id } }),
    ).toBe(0);
  });
  it('reopen requires preference and a future intended time', async () => {
    const t = await task(),
      r = await reminder({
        taskId: t.id,
        taskRevision: t.revision,
        rule: { version: 1, kind: 'TASK', field: 'DUE_AT' },
      });
    const done = await call(
      a,
      'post',
      '/tasks/' + t.id + '/complete',
      t.revision,
    )
      .send({})
      .expect(200);
    await port.sweep();
    await call(a, 'post', '/tasks/' + t.id + '/reopen', done.body.revision)
      .send({})
      .expect(200);
    await port.sweep();
    expect((await call(a, 'get', '/reminders/' + r.id)).body.state).toBe(
      'CANCELED',
    );
    await preference(a, { reactivateOnReopen: true });
    await port.sweep();
    expect((await call(a, 'get', '/reminders/' + r.id)).body.state).toBe(
      'ACTIVE',
    );
    await preference(a, { reactivateOnReopen: false });
  });
  it('manual cancellation is never undone by Task events', async () => {
    const t = await task(),
      r = await reminder({ taskId: t.id, taskRevision: t.revision });
    await call(a, 'delete', '/reminders/' + r.id, r.revision).expect(200);
    await call(a, 'post', '/tasks/' + t.id + '/complete', t.revision)
      .send({})
      .expect(200);
    await port.sweep();
    const row = (await call(a, 'get', '/reminders/' + r.id)).body;
    expect(row.reason).toBe('USER');
  });
  it('rejects foreign Task references and stale Task selections', async () => {
    const t = await task(b);
    await call(a, 'post', '/reminders')
      .send({
        taskId: t.id,
        taskRevision: t.revision,
        rule: { version: 1, kind: 'TASK', field: 'DUE_AT' },
      })
      .expect(404);
    const own = await task();
    await call(a, 'post', '/reminders')
      .send({
        taskId: own.id,
        taskRevision: 999,
        rule: { version: 1, kind: 'TASK', field: 'DUE_AT' },
      })
      .expect(409);
  });
  it('expires older missed events and delivers within grace', async () => {
    const old = await reminder({
      rule: { version: 1, kind: 'ABSOLUTE', at: at(-8 * 1440) },
    });
    expect((await deliveries(old.id))[0]!.state).toBe('EXPIRED');
    await dispatch(old);
    expect(
      await db.client.notification.count({ where: { reminderId: old.id } }),
    ).toBe(0);
    const recent = await reminder();
    await dispatch(recent);
    expect((await deliveries(recent.id))[0]!.state).toBe('DELIVERED');
  });
  it('persists DST gap history without a transport attempt', async () => {
    const r = await reminder({
      timezoneMode: 'FIXED',
      timezone: 'America/New_York',
      rule: {
        version: 1,
        kind: 'LOCAL',
        startDate: '2024-03-10',
        time: '02:30',
      },
    });
    const d = (await deliveries(r.id))[0]!;
    expect(d.state).toBe('SKIPPED');
    expect(d.reason).toBe('DST_GAP');
    expect(d.scheduledAt).toBeNull();
    expect(d.attempts).toBe(0);
  });
  it('retains fixed context while account-local future schedules follow travel', async () => {
    const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      fixed = await reminder({
        timezoneMode: 'FIXED',
        timezone: 'UTC',
        rule: { version: 1, kind: 'LOCAL', startDate: date, time: '12:00' },
      }),
      local = await reminder({
        rule: { version: 1, kind: 'LOCAL', startDate: date, time: '12:00' },
      }),
      absolute = await reminder({
        rule: { version: 1, kind: 'ABSOLUTE', at: at(1440) },
      }),
      absoluteBefore = (await deliveries(absolute.id))[0]!,
      before = (await deliveries(local.id))[0]!.scheduledAt,
      settings = (await call(a, 'get', '/me/settings')).body;
    await call(a, 'patch', '/me/settings', settings.revision)
      .send({ timezone: 'America/New_York' })
      .expect(200);
    await port.sweep();
    expect((await call(a, 'get', '/reminders/' + fixed.id)).body.timezone).toBe(
      'UTC',
    );
    expect(
      (await deliveries(local.id)).filter((d) => d.state === 'PENDING')[0]!
        .scheduledAt,
    ).not.toBe(before);
    const absoluteAfter = (await deliveries(absolute.id))[0]!;
    expect(absoluteAfter.id).toBe(absoluteBefore.id);
    expect(absoluteAfter.scheduledAt).toBe(absoluteBefore.scheduledAt);
    expect(absoluteAfter.timezone).toBe('America/New_York');
    expect(absoluteAfter.canceledAt).not.toBeNull();
    expect(absoluteAfter.reactivatedAt).not.toBeNull();
    const current = (await call(a, 'get', '/me/settings')).body;
    await call(a, 'patch', '/me/settings', current.revision)
      .send({ timezone: 'Asia/Tehran' })
      .expect(200);
  });
  it('bounds catch-up and persists cursor across passes without duplicate identities', async () => {
    const r = await reminder({
      rule: {
        version: 1,
        kind: 'LOCAL',
        startDate: '2020-01-01',
        time: '12:00',
        recurrence: { version: 1, frequency: 'DAILY' },
      },
    });
    expect(
      await db.client.notificationDelivery.count({
        where: { reminderId: r.id },
      }),
    ).toBe(100);
    const before = (
      await db.client.reminder.findUniqueOrThrow({ where: { id: r.id } })
    ).cursorDate;
    await port.sweep();
    expect(
      await db.client.notificationDelivery.count({
        where: { reminderId: r.id },
      }),
    ).toBe(200);
    expect(
      (
        await db.client.reminder.findUniqueOrThrow({ where: { id: r.id } })
      ).cursorDate!.getTime(),
    ).toBeGreaterThan(before!.getTime());
  });
  it('snooze replay keeps source identity and never changes Task due/status', async () => {
    const t = await task(),
      r = await reminder({ taskId: t.id, taskRevision: t.revision });
    await dispatch(r);
    const n = await db.client.notification.findFirstOrThrow({
        where: { reminderId: r.id },
      }),
      key = randomUUID(),
      body = { until: at(60) };
    const one = await call(
        a,
        'post',
        '/notifications/' + n.id + '/snooze',
        n.revision,
        key,
      )
        .send(body)
        .expect(200),
      two = await call(
        a,
        'post',
        '/notifications/' + n.id + '/snooze',
        n.revision,
        key,
      )
        .send(body)
        .expect(200);
    expect(two.body).toEqual(one.body);
    expect(one.body.deliveries[0].sourceNotificationId).toBe(n.id);
    expect(
      (await db.client.task.findUniqueOrThrow({ where: { id: t.id } }))
        .revision,
    ).toBe(t.revision);
  });
  it('read acknowledgement and dismissal are private revisioned history', async () => {
    const r = await reminder();
    await dispatch(r);
    const n = await db.client.notification.findFirstOrThrow({
        where: { reminderId: r.id },
      }),
      read = await call(
        a,
        'patch',
        '/notifications/' + n.id + '/read',
        n.revision,
      )
        .send({ read: true })
        .expect(200);
    expect(read.body.acknowledgedAt).toBeTruthy();
    await call(
      a,
      'post',
      '/notifications/' + n.id + '/dismiss',
      read.body.revision,
    )
      .send({})
      .expect(200);
    const rows = (
      await call(a, 'get', '/notifications?state=DISMISSED').expect(200)
    ).body.items as c.Notification[];
    expect(rows.some((v) => v.id === n.id)).toBe(true);
  });
  it('rejects invalid quiet availability and defers nonurgent events', async () => {
    const p = (await call(a, 'get', '/notifications/preferences')).body;
    await call(a, 'patch', '/notifications/preferences', p.revision)
      .send({ quietStart: '23:00', quietEnd: '23:00' })
      .expect(400);
    const now = new Date(),
      parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Tehran',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(now.getTime() - 120000)),
      end = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Tehran',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(now.getTime() + 600000));
    await preference(a, { quietStart: parts, quietEnd: end });
    const r = await reminder();
    await dispatch(r);
    expect((await deliveries(r.id))[0]!.state).toBe('PENDING');
    expect(
      new Date((await deliveries(r.id))[0]!.notBefore!).getTime(),
    ).toBeGreaterThan(now.getTime());
    await preference(a, { quietStart: null, quietEnd: null });
  });
  it('external email is opt-in and excludes private title/body', async () => {
    await preference(a, { email: true });
    const send = vi
      .spyOn(app.get(NotificationTransport), 'send')
      .mockResolvedValue({ outcome: 'ACCEPTED', code: 'TEST_ACCEPTED' });
    const r = await reminder({
      channels: ['EMAIL'],
      body: 'Finance and journal secrets',
    });
    await dispatch(r);
    const message = send.mock.calls[0]![0];
    expect(JSON.stringify(message)).not.toContain('secrets');
    expect('title' in message).toBe(false);
    expect((await deliveries(r.id))[0]!.state).toBe('DELIVERED');
    expect(
      (
        await db.client.notification.findFirstOrThrow({
          where: { reminderId: r.id },
        })
      ).inbox,
    ).toBe(false);
  });
  it('bounded transient retry records backoff without a duplicate notification', async () => {
    const send = vi
        .spyOn(app.get(NotificationTransport), 'send')
        .mockResolvedValue({ outcome: 'RETRY', code: 'TEST_TEMPORARY' }),
      r = await reminder({ channels: ['EMAIL'] });
    await dispatch(r);
    const d = (await deliveries(r.id))[0]!;
    expect(d.state).toBe('RETRY');
    expect(d.attempts).toBe(1);
    await dispatch(r);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await db.client.notification.count({ where: { reminderId: r.id } }),
    ).toBe(1);
  });
  it('ambiguous acceptance is terminal and never retried', async () => {
    const send = vi
        .spyOn(app.get(NotificationTransport), 'send')
        .mockResolvedValue({ outcome: 'AMBIGUOUS', code: 'TEST_UNKNOWN' }),
      r = await reminder({ channels: ['EMAIL'] });
    await dispatch(r);
    await dispatch(r);
    expect((await deliveries(r.id))[0]!.state).toBe('AMBIGUOUS');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('recovers an expired pre-network lease while preserving uncertain network history', async () => {
    const r = await reminder({ channels: ['EMAIL'] }),
      d = (await deliveries(r.id))[0]!;
    await db.client.notificationDelivery.update({
      where: { id: d.id },
      data: {
        state: 'PROCESSING',
        leaseToken: randomUUID(),
        leaseUntil: new Date(Date.now() - 1000),
      },
    });
    await port.sweep();
    expect((await deliveries(r.id))[0]!.state).toBe('RETRY');
    await db.client.notificationDelivery.update({
      where: { id: d.id },
      data: {
        state: 'PROCESSING',
        leaseToken: randomUUID(),
        leaseUntil: new Date(Date.now() - 1000),
        networkStartedAt: new Date(),
      },
    });
    await port.sweep();
    expect((await deliveries(r.id))[0]!.state).toBe('AMBIGUOUS');
  });
  it('Push subscriptions redact secrets, enforce ownership, and permit explicit revocation', async () => {
    const key = createECDH('prime256v1');
    key.generateKeys();
    const body = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/' + randomUUID(),
      keys: {
        auth: Buffer.alloc(16, 2).toString('base64url'),
        p256dh: key.getPublicKey().toString('base64url'),
      },
    };
    const sub = (
      await call(a, 'post', '/push/subscriptions').send(body).expect(201)
    ).body as c.PushSubscription;
    expect('endpoint' in sub).toBe(false);
    expect('auth' in sub).toBe(false);
    await call(
      b,
      'delete',
      '/push/subscriptions/' + sub.id,
      sub.revision,
    ).expect(404);
    await call(
      a,
      'delete',
      '/push/subscriptions/' + sub.id,
      sub.revision,
    ).expect(200);
    const row = await db.client.pushSubscription.findUniqueOrThrow({
      where: { id: sub.id },
    });
    expect(row.endpoint).toBeNull();
    expect(row.auth).toBeNull();
  });
  it('Push 410 revokes the endpoint without retrying successful siblings', async () => {
    await preference(a, { webPush: true });
    for (let n = 0; n < 2; n++) {
      const key = createECDH('prime256v1');
      key.generateKeys();
      await call(a, 'post', '/push/subscriptions')
        .send({
          endpoint: 'https://fcm.googleapis.com/fcm/send/' + randomUUID(),
          keys: {
            auth: Buffer.alloc(16, n + 3).toString('base64url'),
            p256dh: key.getPublicKey().toString('base64url'),
          },
        })
        .expect(201);
    }
    const send = vi
        .spyOn(app.get(NotificationTransport), 'send')
        .mockResolvedValueOnce({ outcome: 'GONE', code: 'PUSH_GONE' })
        .mockResolvedValue({ outcome: 'ACCEPTED', code: 'TEST_ACCEPTED' }),
      r = await reminder({ channels: ['WEB_PUSH'] });
    await dispatch(r);
    await dispatch(r);
    const rows = await deliveries(r.id);
    expect(rows.filter((v) => v.kind === 'CHANNEL')).toHaveLength(1);
    expect(rows.filter((v) => v.kind === 'ENDPOINT')).toHaveLength(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(rows.find((v) => v.kind === 'CHANNEL')!.state).toBe('DELIVERED');
  });
  it('database constraints reject duplicate logical identities even outside application locks', async () => {
    const r = await reminder(),
      row = await db.client.notificationDelivery.findFirstOrThrow({
        where: { reminderId: r.id },
      });
    const { id: _id, ...copy } = row;
    await expect(
      db.client.notificationDelivery.create({
        data: { ...copy, id: randomUUID() },
      }),
    ).rejects.toThrow();
  });
  it('stops external retries after five definitive temporary failures', async () => {
    const send = vi
        .spyOn(app.get(NotificationTransport), 'send')
        .mockResolvedValue({ outcome: 'RETRY', code: 'TEST_TEMPORARY' }),
      r = await reminder({ channels: ['EMAIL'] });
    const d = (await deliveries(r.id))[0]!;
    for (let n = 0; n < 5; n++) {
      await db.client.notificationDelivery.update({
        where: { id: d.id },
        data: { retryAt: null, notBefore: new Date(Date.now() - 1000) },
      });
      await port.dispatch(d.id);
    }
    expect((await deliveries(r.id))[0]!.state).toBe('FAILED');
    expect((await deliveries(r.id))[0]!.attempts).toBe(5);
    await port.dispatch(d.id);
    expect(send).toHaveBeenCalledTimes(5);
  });
  it('cancels before the final send gate and records an already authorized in-flight acceptance', async () => {
    const r = await reminder({ channels: ['EMAIL'] }),
      d = (await deliveries(r.id))[0]!;
    const send = vi
      .spyOn(app.get(NotificationTransport), 'send')
      .mockImplementation(async () => {
        const current = (await call(a, 'get', '/reminders/' + r.id)).body;
        await call(a, 'delete', '/reminders/' + r.id, current.revision).expect(
          200,
        );
        return { outcome: 'ACCEPTED', code: 'TEST_ACCEPTED' };
      });
    await port.dispatch(d.id);
    const result = (await deliveries(r.id))[0]!;
    expect(result.state).toBe('DELIVERED');
    expect(result.cancelRequestedAt).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
    await port.dispatch(d.id);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('does not revive a completed Task whose intended time is past', async () => {
    await preference(a, { reactivateOnReopen: true });
    const t = await task(),
      r = await reminder({ taskId: t.id, taskRevision: t.revision });
    const done = await call(
      a,
      'post',
      '/tasks/' + t.id + '/complete',
      t.revision,
    )
      .send({})
      .expect(200);
    await dispatch(r);
    await call(a, 'post', '/tasks/' + t.id + '/reopen', done.body.revision)
      .send({})
      .expect(200);
    await port.sweep();
    expect((await call(a, 'get', '/reminders/' + r.id)).body.state).toBe(
      'CANCELED',
    );
    await preference(a, { reactivateOnReopen: false });
  });
  it('deleted Task references cancel without deleting notification history', async () => {
    const t = await task(),
      r = await reminder({ taskId: t.id, taskRevision: t.revision });
    await dispatch(r);
    const count = await db.client.notification.count({
      where: { reminderId: r.id },
    });
    await call(a, 'delete', '/tasks/' + t.id, t.revision).expect(200);
    await port.sweep();
    expect((await call(a, 'get', '/reminders/' + r.id)).body.state).toBe(
      'CANCELED',
    );
    expect(
      await db.client.notification.count({ where: { reminderId: r.id } }),
    ).toBe(count);
  });
  it('date-only Task rules require and retain explicit local time', async () => {
    const t = await task(),
      date = new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      changed = await call(a, 'patch', '/tasks/' + t.id, t.revision)
        .send({ scheduledDate: date })
        .expect(200);
    const r = await reminder({
      taskId: t.id,
      taskRevision: changed.body.revision,
      timezoneMode: 'FIXED',
      timezone: 'UTC',
      rule: {
        version: 1,
        kind: 'TASK',
        field: 'SCHEDULED_DATE',
        localTime: '09:30',
        offsetMinutes: -30,
      },
    });
    expect((await deliveries(r.id))[0]!.scheduledAt).toBe(
      date + 'T09:00:00.000Z',
    );
  });
  it('pause and resume do not backfill paused recurrence dates', async () => {
    const r = await reminder({
        rule: {
          version: 1,
          kind: 'LOCAL',
          startDate: '2020-01-01',
          time: '12:00',
          recurrence: { version: 1, frequency: 'DAILY' },
        },
      }),
      paused = (
        await call(a, 'post', '/reminders/' + r.id + '/pause', r.revision)
          .send({})
          .expect(200)
      ).body;
    await call(a, 'post', '/reminders/' + r.id + '/resume', paused.revision)
      .send({})
      .expect(200);
    await port.sweep();
    const recent = await db.client.notificationDelivery.findMany({
      where: { reminderId: r.id, state: 'PENDING' },
    });
    expect(
      recent.every((d) => d.scheduledAt! > new Date(Date.now() - 1000)),
    ).toBe(true);
  });
  it('session logout does not remove a separately opted-in Push subscription', async () => {
    const owner = b,
      ec = createECDH('prime256v1');
    ec.generateKeys();
    const sub = (
      await call(owner, 'post', '/push/subscriptions')
        .send({
          endpoint: 'https://fcm.googleapis.com/fcm/send/' + randomUUID(),
          keys: {
            auth: Buffer.alloc(16, 7).toString('base64url'),
            p256dh: ec.getPublicKey().toString('base64url'),
          },
        })
        .expect(201)
    ).body;
    await call(owner, 'post', '/auth/sign-out').send({}).expect(200);
    await call(owner, 'get', '/push/subscriptions').expect(401);
    expect(
      (
        await db.client.pushSubscription.findUniqueOrThrow({
          where: { id: sub.id },
        })
      ).state,
    ).toBe('ACTIVE');
  });
  it.each(['EMAIL', 'WEB_PUSH'] as const)(
    'suppresses a moved local identity while %s is already in flight',
    async (channel) => {
      const r = await reminder({ channels: [channel] }),
        first = await db.client.notificationDelivery.findFirstOrThrow({
          where: { reminderId: r.id, kind: 'CHANNEL' },
        }),
        { id: _id, ...copy } = first,
        second = await db.client.notificationDelivery.create({
          data: {
            ...copy,
            id: randomUUID(),
            scheduledAt: new Date(first.scheduledAt!.getTime() - 1000),
          },
        });
      const send = vi
        .spyOn(app.get(NotificationTransport), 'send')
        .mockImplementation(async () => {
          await port.dispatch(second.id);
          return { outcome: 'ACCEPTED', code: 'TEST_ACCEPTED' };
        });
      await port.dispatch(first.id);
      expect(
        (
          await db.client.notificationDelivery.findUniqueOrThrow({
            where: { id: second.id },
          })
        ).state,
      ).toBe('SKIPPED');
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
  it('uses a fixed reminder zone for quiet hours after account travel', async () => {
    const clock = (d: Date) => d.toISOString().slice(11, 16),
      now = new Date();
    await preference(a, {
      quietStart: clock(new Date(now.getTime() - 120000)),
      quietEnd: clock(new Date(now.getTime() + 600000)),
    });
    const r = await reminder({ timezoneMode: 'FIXED', timezone: 'UTC' });
    await dispatch(r);
    expect((await deliveries(r.id))[0]!.state).toBe('PENDING');
    expect(
      new Date((await deliveries(r.id))[0]!.notBefore!).getTime(),
    ).toBeGreaterThan(now.getTime());
    await preference(a, { quietStart: null, quietEnd: null });
  });
  it('shows missing Task date blocking and unblocks from current source state', async () => {
    const t = (
      await call(a, 'post', '/tasks').send({ title: 'No due date' }).expect(201)
    ).body;
    const r = await reminder({
      taskId: t.id,
      taskRevision: t.revision,
      rule: { version: 1, kind: 'TASK', field: 'DUE_AT' },
    });
    expect(r.reason).toBe('MISSING_SOURCE_DATE');
    expect(await deliveries(r.id)).toHaveLength(0);
    await call(a, 'patch', '/tasks/' + t.id, t.revision)
      .send({ dueAt: at(60) })
      .expect(200);
    await port.sweep();
    expect((await call(a, 'get', '/reminders/' + r.id)).body.reason).toBeNull();
    expect((await deliveries(r.id))[0]!.state).toBe('PENDING');
  });
  it('enforces the active reminder cap on automatic reopen and audits automatic cancellation', async () => {
    const owner = await identity(),
      t = await task(owner),
      r = await reminder(
        {
          taskId: t.id,
          taskRevision: t.revision,
          rule: { version: 1, kind: 'TASK', field: 'DUE_AT' },
        },
        owner,
      ),
      before = await db.client.securityAuditEvent.count({
        where: { resourceId: r.id, action: 'REMINDER_CHANGE' },
      });
    const done = await call(
      owner,
      'post',
      '/tasks/' + t.id + '/complete',
      t.revision,
    )
      .send({})
      .expect(200);
    await port.dispatch((await deliveries(r.id, owner))[0]!.id);
    expect(
      await db.client.securityAuditEvent.count({
        where: { resourceId: r.id, action: 'REMINDER_CHANGE' },
      }),
    ).toBeGreaterThan(before);
    await preference(owner, { reactivateOnReopen: true });
    const ids = Array.from({ length: 1000 }, () => randomUUID());
    try {
      await db.client.reminder.createMany({
        data: ids.map((id) => ({
          id,
          spaceId: owner.spaceId,
          ownerUserId: owner.id,
          createdByUserId: owner.id,
          title: 'Owned cap fixture',
          rule: { version: 1, kind: 'ABSOLUTE', at: at(60) },
          timezoneMode: 'FIXED',
          timezone: 'UTC',
          channels: ['IN_APP'],
        })),
      });
      await call(
        owner,
        'post',
        '/tasks/' + t.id + '/reopen',
        done.body.revision,
      )
        .send({})
        .expect(200);
      await settleOutbox(owner);
      expect((await call(owner, 'get', '/reminders/' + r.id)).body.state).toBe(
        'CANCELED',
      );
      expect(
        await db.client.reminder.count({
          where: { spaceId: owner.spaceId, state: 'ACTIVE' },
        }),
      ).toBe(1000);
    } finally {
      await db.client.reminder.deleteMany({
        where: { spaceId: owner.spaceId, id: { in: ids } },
      });
    }
  });
  it('retains an explicit pause through source completion and opt-in reopen', async () => {
    await preference(a, { reactivateOnReopen: true });
    const t = await task(),
      r = await reminder({
        taskId: t.id,
        taskRevision: t.revision,
        rule: { version: 1, kind: 'TASK', field: 'DUE_AT' },
      });
    await call(a, 'post', '/reminders/' + r.id + '/pause', r.revision)
      .send({})
      .expect(200);
    const done = await call(
      a,
      'post',
      '/tasks/' + t.id + '/complete',
      t.revision,
    )
      .send({})
      .expect(200);
    await settleOutbox();
    await call(a, 'post', '/tasks/' + t.id + '/reopen', done.body.revision)
      .send({})
      .expect(200);
    await settleOutbox();
    expect((await call(a, 'get', '/reminders/' + r.id)).body.state).toBe(
      'PAUSED',
    );
    expect((await deliveries(r.id)).every((d) => d.state === 'CANCELED')).toBe(
      true,
    );
    await preference(a, { reactivateOnReopen: false });
  });
  it('fences late external acknowledgements from a replaced lease token', async () => {
    const r = await reminder({ channels: ['EMAIL'] }),
      d = (await deliveries(r.id))[0]!,
      replacement = randomUUID(),
      send = vi
        .spyOn(app.get(NotificationTransport), 'send')
        .mockImplementation(async () => {
          await db.client.notificationDelivery.update({
            where: { id: d.id },
            data: { leaseToken: replacement },
          });
          return { outcome: 'ACCEPTED', code: 'TEST_LATE_ACCEPTED' };
        });
    await port.dispatch(d.id);
    const current = await db.client.notificationDelivery.findUniqueOrThrow({
      where: { id: d.id },
    });
    expect(current.leaseToken).toBe(replacement);
    expect(current.state).toBe('PROCESSING');
    expect(current.sentAt).toBeNull();
    await db.client.notificationDelivery.update({
      where: { id: d.id },
      data: { leaseUntil: new Date(Date.now() - 1000) },
    });
    await port.sweep();
    await port.dispatch(d.id);
    expect((await deliveries(r.id))[0]!.state).toBe('AMBIGUOUS');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('rejects recurrence masters and cancels a skipped actionable occurrence without duplicating Tasks', async () => {
    const master = await task(),
      today = new Date().toISOString().slice(0, 10),
      series = (
        await call(a, 'post', '/task-recurrences')
          .send({
            taskId: master.id,
            taskRevision: master.revision,
            definition: {
              startDate: today,
              endDate: null,
              localTime: '09:00',
              timezone: 'UTC',
              rule: { kind: 'DAILY', interval: 1 },
              exclusionDates: [],
            },
          })
          .expect(201)
      ).body;
    await call(a, 'post', '/reminders')
      .send({
        taskId: master.id,
        taskRevision: master.revision,
        rule: { version: 1, kind: 'ABSOLUTE', at: at() },
      })
      .expect(400);
    const expanded = (
        await call(a, 'post', '/task-recurrences/' + series.id + '/catch-up')
          .send({ through: today, limit: 1 })
          .expect(200)
      ).body,
      occurrence = expanded.items[0],
      t = (await call(a, 'get', '/tasks/' + occurrence.taskId).expect(200))
        .body,
      r = await reminder({ taskId: t.id, taskRevision: t.revision });
    await call(
      a,
      'post',
      '/task-occurrences/' + occurrence.id + '/skip',
      occurrence.revision,
    )
      .send({ taskRevision: t.revision })
      .expect(200);
    await dispatch(r);
    expect((await deliveries(r.id))[0]!.state).toBe('CANCELED');
    expect(
      await db.client.notification.count({ where: { reminderId: r.id } }),
    ).toBe(0);
    expect(
      (await db.client.task.findUniqueOrThrow({ where: { id: t.id } })).id,
    ).toBe(t.id);
    expect(
      (await db.client.task.findUniqueOrThrow({ where: { id: master.id } }))
        .status,
    ).toBe('OPEN');
  });
  it('keeps outbox consumer state isolated from immutable event bodies', async () => {
    const r = await reminder(),
      before = await db.client.outboxEvent.findFirstOrThrow({
        where: { type: 'reminder.changed', aggregateId: r.id },
      });
    await settleOutbox();
    const after = await db.client.outboxEvent.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.payload).toEqual(before.payload);
    expect(after.occurredAt).toEqual(before.occurredAt);
    expect(after.notificationHandledAt).not.toBeNull();
  });
});
