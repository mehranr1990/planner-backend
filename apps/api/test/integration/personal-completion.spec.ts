import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { testApplication } from '../support/application.js';
import { cleanupFixtureIdentities } from '../support/fixture-cleanup.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import * as clockModule from '../../src/modules/focus/infrastructure/focus-clock.js';
type Actor = { id: string; spaceId: string; cookie: string };
describe('P1-GAP-CLOSURE Personal contracts', () => {
  let app: NestExpressApplication, db: DatabaseService, a: Actor, b: Actor;
  const users: string[] = [],
    origin = 'http://localhost:3000',
    url = isolatedTestDatabaseUrl(process.env);
  const at = (ms: number) => new Date(Date.UTC(2026, 10, 1) + ms);
  let clock = at(0);
  const call = (
    who: Actor,
    method: 'get' | 'post' | 'patch' | 'put',
    path: string,
    revision?: number,
    key = randomUUID(),
  ) => {
    const r = request(app.getHttpServer())
      [method]('/api/v1' + path)
      .set('Cookie', who.cookie)
      .set('Origin', origin);
    if (revision !== undefined) r.set('If-Match', '"' + revision + '"');
    if (method !== 'get') r.set('Idempotency-Key', key);
    return r;
  };
  async function identity(): Promise<Actor> {
    const email = 'personal-completion-' + randomUUID() + '@example.test',
      password = 'fixture-personal-completion-123!';
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .send({ email, password, name: 'Personal fixture' })
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
    const space = await db.client.space.findFirstOrThrow({
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
  beforeAll(async () => {
    vi.spyOn(clockModule, 'readFocusClock').mockImplementation(
      async () => new Date(clock),
    );
    app = await testApplication({
      databaseUrl: url,
      environment: { PERSONAL_ERASURE_POLICY_VERSION: 'fixture-approved-v1' },
    });
    db = app.get(DatabaseService);
    a = await identity();
    b = await identity();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (db) await cleanupFixtureIdentities(url, { ids: users });
    await app?.close();
  });
  it('discovers only approved deletion metadata and scoped current status', async () => {
    const policy = await call(a, 'get', '/me/deletion-policy').expect(200);
    expect(policy.body).toEqual({
      policyVersion: 'fixture-approved-v1',
      retentionAcknowledgementRequired: true,
      gracePeriodDays: 7,
      backupExpiryMaximumDays: 30,
      cancellationRequiresPassword: true,
      cancellationRequiresRecoveryCapability: true,
    });
    expect(
      (await call(a, 'get', '/me/deletion-request/current').expect(200)).body
        .job,
    ).toBeNull();
    await request(app.getHttpServer())
      .get('/api/v1/me/deletion-policy')
      .expect(401);
    const unconfigured = await testApplication({ databaseUrl: url });
    try {
      await request(unconfigured.getHttpServer())
        .get('/api/v1/me/deletion-policy')
        .set('Cookie', a.cookie)
        .expect(409);
    } finally {
      await unconfigured.close();
    }
  });
  it('counts over 100 notifications, scopes filters, and reflects committed read/dismiss/snooze changes', async () => {
    const r = await call(a, 'post', '/reminders')
      .send({
        rule: {
          version: 1,
          kind: 'ABSOLUTE',
          at: new Date(Date.now() + 3600000).toISOString(),
        },
      })
      .expect(201);
    await db.client.notification.createMany({
      data: Array.from({ length: 105 }, (_, i) => ({
        spaceId: a.spaceId,
        ownerUserId: a.id,
        createdByUserId: a.id,
        reminderId: r.body.id as string,
        scheduledAt: new Date(Date.now() + i),
        occurrenceKey: 'fixture-' + i,
        timezone: 'UTC',
        localDate: at(0),
        title: 'fixture',
        inbox: true,
      })),
    });
    const path = '/notifications/unread-count?reminderId=' + r.body.id;
    expect((await call(a, 'get', path).expect(200)).body.count).toBe(105);
    await call(b, 'get', path).expect(404);
    const rows = await db.client.notification.findMany({
      where: { reminderId: r.body.id as string },
      take: 3,
    });
    await Promise.all([
      call(a, 'patch', '/notifications/' + rows[0]!.id + '/read', 1)
        .send({ read: true })
        .expect(200),
      call(a, 'post', '/notifications/' + rows[1]!.id + '/dismiss', 1)
        .send({})
        .expect(200),
    ]);
    expect((await call(a, 'get', path).expect(200)).body.count).toBe(103);
    await call(a, 'post', '/notifications/' + rows[2]!.id + '/snooze', 1)
      .send({ until: new Date(Date.now() + 7200000).toISOString() })
      .expect(200);
    // Existing snooze acknowledges but does not mark read or dismiss the source.
    expect((await call(a, 'get', path).expect(200)).body.count).toBe(103);
  });
  it('runs routine occurrences once, preserves schedule/history and never fabricates Habit entries', async () => {
    const r = await call(a, 'post', '/routines')
        .send({ title: 'routine', habitIds: [] })
        .expect(201),
      id = r.body.id as string;
    const prefs = await db.client.userSettings.findUniqueOrThrow({
      where: { userId: a.id },
    });
    const schedule = {
      startDate: '2026-11-01',
      kind: 'DAILY',
      startTime: '09:00',
      timezone: prefs.timezone,
      reminder: true,
    };
    await call(a, 'patch', '/routines/' + id + '/schedule', 1)
      .send({ schedule })
      .expect(200);
    await call(b, 'get', '/routines/' + id + '/schedule').expect(404);
    const path =
      '/routines/' + id + '/occurrences?from=2026-11-01&to=2026-11-04&limit=2';
    const page = await call(a, 'get', path).expect(200);
    expect(page.body.items).toHaveLength(2);
    expect(page.body.nextDate).toBe('2026-11-02');
    const run = '/routines/' + id + '/occurrences/2026-11-01/execute',
      key = randomUUID();
    const one = await call(a, 'post', run, 2, key)
      .send({ action: 'START' })
      .expect(201);
    expect(
      (await call(a, 'post', run, 2, key).send({ action: 'START' }).expect(201))
        .body,
    ).toEqual(one.body);
    await call(a, 'post', run, one.body.revision as number)
      .send({ action: 'COMPLETE' })
      .expect(201);
    await call(a, 'post', run, one.body.revision as number)
      .send({ action: 'COMPLETE' })
      .expect(409);
    const history = await call(a, 'get', path).expect(200);
    expect(history.body.items[0].state).toBe('COMPLETED');
    expect(
      await db.client.habitEntry.count({ where: { spaceId: a.spaceId } }),
    ).toBe(0);
    expect(
      await db.client.reminder.count({
        where: { spaceId: a.spaceId, routineId: id, state: 'ACTIVE' },
      }),
    ).toBe(1);
  });
  it('keeps capacity unknown, unions weekly hours, and applies nonworking date exceptions', async () => {
    expect(
      (
        await call(
          b,
          'get',
          '/planning/capacity/schedule?date=2026-11-02',
        ).expect(200)
      ).body.availableMinutes,
    ).toBeNull();
    const config = (await call(b, 'get', '/planning/working-hours').expect(200))
      .body;
    const workingHours = {
      intervalsByWeekday: Array.from({ length: 7 }, () => [
        { start: '09:00', end: '12:00' },
        { start: '11:00', end: '13:00' },
      ]),
      exceptions: [{ date: '2026-11-02', intervals: [] }],
    };
    await call(b, 'put', '/planning/working-hours', config.revision as number)
      .send({ workingHours })
      .expect(200);
    await call(b, 'put', '/planning/working-hours', config.revision as number)
      .send({ workingHours })
      .expect(409);
    expect(
      (
        await call(
          b,
          'get',
          '/planning/capacity/schedule?date=2026-11-02',
        ).expect(200)
      ).body.availableMinutes,
    ).toBe(0);
    expect(
      (
        await call(
          b,
          'get',
          '/planning/capacity/schedule?date=2026-11-03',
        ).expect(200)
      ).body.availableMinutes,
    ).toBe(240);
  });
  it('unions authorized event and TimeBlock reservations without foreign occupancy', async () => {
    const timezone = (
      await call(b, 'get', '/planning/working-hours').expect(200)
    ).body.timezone as string;
    for (const [who, path, start, end] of [
      [b, 'events', '09:00', '11:00'],
      [b, 'events', '10:00', '12:00'],
      [b, 'time-blocks', '11:00', '12:00'],
      [a, 'events', '12:00', '13:00'],
    ] as const)
      await call(who, 'post', '/calendar/' + path)
        .send({
          title: 'capacity fixture',
          schedule: {
            kind: 'TIMED',
            timezone,
            localStart: '2026-11-03T' + start,
            localEnd: '2026-11-03T' + end,
          },
        })
        .expect(201);
    const result = (
      await call(
        b,
        'get',
        '/planning/capacity/schedule?date=2026-11-03',
      ).expect(200)
    ).body;
    expect(result).toMatchObject({
      availableMinutes: 240,
      reservedMinutes: 180,
      remainingMinutes: 60,
    });
    expect(result.days[0].busyMinutes).toBe(180);
  });
  it('measures linked Habit progress without completing Habits when a routine finishes', async () => {
    const habit = (
      await call(a, 'post', '/habits')
        .send({
          title: 'progress habit',
          type: 'CHECKBOX',
          unit: 'COUNT',
          target: '1',
          timezone: 'UTC',
          schedule: {
            version: 1,
            startDate: '2026-11-01',
            rule: { kind: 'DAILY' },
          },
        })
        .expect(201)
    ).body;
    await call(a, 'post', '/habits/' + habit.id + '/entries')
      .send({
        habitRevision: habit.revision,
        localDate: '2026-11-01',
        action: 'LOG',
      })
      .expect(201);
    const routine = (
      await call(a, 'post', '/routines')
        .send({ title: 'progress routine', habitIds: [habit.id] })
        .expect(201)
    ).body;
    const prefs = await db.client.userSettings.findUniqueOrThrow({
      where: { userId: a.id },
    });
    await call(a, 'patch', '/routines/' + routine.id + '/schedule', 1)
      .send({
        schedule: {
          startDate: '2026-11-01',
          kind: 'DAILY',
          startTime: '09:00',
          timezone: prefs.timezone,
        },
      })
      .expect(200);
    const page = (
      await call(
        a,
        'get',
        '/routines/' +
          routine.id +
          '/occurrences?from=2026-11-01&to=2026-11-03',
      ).expect(200)
    ).body;
    expect(page.items[0]).toMatchObject({
      linkedHabitCount: 1,
      completedHabitCount: 1,
      completionPercentage: 100,
    });
    expect(page.items[1].completionPercentage).toBe(0);
    await call(
      a,
      'post',
      '/routines/' + routine.id + '/occurrences/2026-11-02/execute',
      2,
    )
      .send({ action: 'SKIP' })
      .expect(201);
    expect(
      await db.client.habitEntry.count({ where: { spaceId: a.spaceId } }),
    ).toBe(1);
  });
  it('exposes routine DST gaps and the earlier fold, and keeps archived execution history', async () => {
    const prefs = await db.client.userSettings.findUniqueOrThrow({
      where: { userId: a.id },
    });
    await call(a, 'patch', '/me/settings', prefs.revision)
      .send({ timezone: 'America/New_York' })
      .expect(200);
    const routine = (
      await call(a, 'post', '/routines')
        .send({ title: 'DST routine', habitIds: [] })
        .expect(201)
    ).body;
    const schedulePath = '/routines/' + routine.id + '/schedule';
    await call(a, 'patch', schedulePath, 1)
      .send({
        schedule: {
          startDate: '2026-03-08',
          startTime: '02:30',
          kind: 'DAILY',
          timezone: 'America/New_York',
        },
      })
      .expect(200);
    const gap = (
      await call(
        a,
        'get',
        '/routines/' +
          routine.id +
          '/occurrences?from=2026-03-08&to=2026-03-09',
      ).expect(200)
    ).body.items[0];
    expect(gap.state).toBe('DST_GAP');
    expect(gap.scheduledAt).toBeNull();
    await call(
      a,
      'post',
      '/routines/' + routine.id + '/occurrences/2026-03-08/execute',
      2,
    )
      .send({ action: 'START' })
      .expect(409);
    await call(a, 'patch', schedulePath, 2)
      .send({
        schedule: {
          startDate: '2026-11-01',
          startTime: '01:30',
          kind: 'DAILY',
          timezone: 'America/New_York',
        },
      })
      .expect(200);
    const pagePath =
      '/routines/' + routine.id + '/occurrences?from=2026-11-01&to=2026-11-02';
    expect(
      (await call(a, 'get', pagePath).expect(200)).body.items[0].scheduledAt,
    ).toBe('2026-11-01T05:30:00.000Z');
    await call(
      a,
      'post',
      '/routines/' + routine.id + '/occurrences/2026-11-01/execute',
      3,
    )
      .send({ action: 'SKIP' })
      .expect(201);
    await call(a, 'patch', '/routines/' + routine.id, 3)
      .send({ status: 'ARCHIVED' })
      .expect(200);
    expect(
      (await call(a, 'get', pagePath).expect(200)).body.items[0].state,
    ).toBe('SKIPPED');
  });
  it('caps interrupted Focus, replays heartbeat safely and records confirmed work exactly once', async () => {
    clock = at(0);
    const created = await call(a, 'post', '/focus/sessions')
      .send({ title: 'recoverable', recoverable: true })
      .expect(201);
    const id = created.body.id as string,
      path = '/focus/sessions/' + id + '/recovery';
    let row = (
      await call(a, 'post', path, 1).send({ action: 'START' }).expect(200)
    ).body;
    clock = at(30000);
    const key = randomUUID(),
      oldRevision = row.revision as number;
    row = (
      await call(a, 'post', path, oldRevision, key)
        .send({ action: 'HEARTBEAT', eventAt: clock.toISOString() })
        .expect(200)
    ).body;
    expect(row.workMs).toBe(30000);
    expect(
      (
        await call(a, 'post', path, oldRevision, key)
          .send({ action: 'HEARTBEAT', eventAt: clock.toISOString() })
          .expect(200)
      ).body,
    ).toEqual(row);
    clock = at(3600000);
    const recovered = (
      await call(a, 'get', '/focus/sessions/' + id).expect(200)
    ).body;
    expect(recovered.workMs).toBe(30000);
    expect(recovered.recoveryState).toBe('INTERRUPTED');
    await call(a, 'post', path, row.revision as number)
      .send({ action: 'HEARTBEAT' })
      .expect(409);
    await call(b, 'post', path, row.revision as number)
      .send({ action: 'STOP' })
      .expect(404);
    const finishKey = randomUUID();
    await call(a, 'post', path, row.revision as number, finishKey)
      .send({ action: 'FINISH' })
      .expect(200);
    await call(a, 'post', path, row.revision as number, finishKey)
      .send({ action: 'FINISH' })
      .expect(200);
    const entries = await db.client.timeEntry.findMany({
      where: { sessionId: id, current: true },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.endAt.getTime() - entries[0]!.startAt.getTime()).toBe(
      30000,
    );
  });
  it('supports validated timestamps, pause/resume, +5 and discard without accounting duplication', async () => {
    clock = at(0);
    let row = (
      await call(a, 'post', '/focus/sessions')
        .send({
          title: 'phase test',
          mode: 'POMODORO',
          recoverable: true,
          pomodoro: { workMinutes: 1, workIntervals: 2 },
        })
        .expect(201)
    ).body;
    const path = '/focus/sessions/' + row.id + '/recovery';
    const command = async (action: string, body: object = {}) => {
      row = (
        await call(a, 'post', path, row.revision as number)
          .send({ action, ...body })
          .expect(200)
      ).body;
    };
    await command('START');
    clock = at(30000);
    await call(a, 'post', path, row.revision as number)
      .send({ action: 'HEARTBEAT', eventAt: at(30001).toISOString() })
      .expect(400);
    await command('EXTEND', { minutes: 5 });
    expect(row.remainingMs).toBe(12 * 60000 - 30000);
    await command('PAUSE');
    clock = at(300000);
    await command('RESUME');
    clock = at(330000);
    await command('HEARTBEAT');
    expect(row.workMs).toBe(60000);
    await command('FINISH');
    const entries = await db.client.timeEntry.findMany({
      where: { sessionId: row.id as string, current: true },
    });
    expect(
      entries.reduce((n, e) => n + e.endAt.getTime() - e.startAt.getTime(), 0),
    ).toBe(60000);
    row = (
      await call(a, 'post', '/focus/sessions')
        .send({ title: 'discard', recoverable: true })
        .expect(201)
    ).body;
    const discardPath = '/focus/sessions/' + row.id + '/recovery';
    row = (
      await call(a, 'post', discardPath, 1)
        .send({ action: 'START' })
        .expect(200)
    ).body;
    await call(a, 'post', discardPath, row.revision as number)
      .send({ action: 'DISCARD' })
      .expect(200);
    expect(
      await db.client.timeEntry.count({
        where: { sessionId: row.id as string },
      }),
    ).toBe(0);
  });
});
