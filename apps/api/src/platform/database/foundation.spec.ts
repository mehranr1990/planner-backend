import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { ApiExceptionFilter } from '../../bootstrap/api-exception.filter.js';
import type { ContextRequest } from '../../bootstrap/request-context.js';
import { randomUUID } from 'node:crypto';
import { AuthorizedSpace } from '../authorization/authorized-space.js';
import { scopedWhere } from './scoped-where.js';
import {
  cursorPage,
  cursorPosition,
  cursorQuery,
  afterCursor,
} from './cursor-pagination.js';
import {
  expectedRevision,
  requireOneRevision,
  revisionTag,
} from '../../bootstrap/concurrency.js';
import { EventSchema } from '../outbox/outbox.js';
import { Prisma } from '../../generated/prisma/client.js';
import { persistenceStatus } from './persistence-error.js';
import {
  assertAdditiveMigration,
  reviewMigrations,
} from '../../../../../tooling/testing/migration-safety.js';

const actor = Object.freeze({
  userId: randomUUID(),
  requestId: randomUUID(),
  correlationId: randomUUID(),
});
const scope = AuthorizedSpace.personal(actor, {
  id: randomUUID(),
  kind: 'PERSONAL',
  ownerUserId: actor.userId,
});
describe('scoped persistence and API conventions', () => {
  it('denies foreign/missing personal scopes and prevents query override', () => {
    expect(() => AuthorizedSpace.personal(actor, null)).toThrow();
    expect(() =>
      AuthorizedSpace.personal(actor, {
        id: randomUUID(),
        kind: 'PERSONAL',
        ownerUserId: randomUUID(),
      }),
    ).toThrow();
    expect(() =>
      scope.assertActor({ ...actor, userId: randomUUID() }),
    ).toThrow();
    const query = { spaceId: randomUUID(), OR: [{ id: randomUUID() }] };
    expect(scopedWhere(scope, query)).toEqual({
      AND: [query, { spaceId: scope.spaceId }],
    });
    expect(Object.isFrozen(scope)).toBe(true);
  });
  it('bounds strict cursor queries and rejects malformed positions and cross-scope/filter reuse', () => {
    expect(cursorQuery({})).toEqual({ limit: 25, cursor: undefined });
    for (const value of [
      '0',
      '-1',
      '101',
      '1.2',
      '01',
      '999999999999',
      ['2'],
      null,
    ])
      expect(() => cursorQuery({ limit: value })).toThrow();
    expect(() => cursorQuery({ ownerId: actor.userId })).toThrow();
    const rows = [
      { id: randomUUID(), createdAt: new Date() },
      { id: randomUUID(), createdAt: new Date() },
    ];
    const page = cursorPage(scope, 'all', 1, rows);
    expect(page.items).toEqual(rows.slice(0, 1));
    expect(cursorPosition(scope, 'all', page.nextCursor!)).toEqual(rows[0]);
    expect(afterCursor(rows[0])).toHaveProperty('OR');
    expect(cursorPage(scope, 'all', 2, rows).nextCursor).toBeNull();
    expect(() => cursorPosition(scope, 'other', page.nextCursor!)).toThrow();
    const other = AuthorizedSpace.personal(actor, {
      id: randomUUID(),
      kind: 'PERSONAL',
      ownerUserId: actor.userId,
    });
    expect(() => cursorPosition(other, 'all', page.nextCursor!)).toThrow();
    for (const cursor of [
      '!',
      'a'.repeat(1025),
      Buffer.from('{"private":"secret"}').toString('base64url'),
    ])
      expect(() => cursorPosition(scope, 'all', cursor)).toThrow('Bad Request');
  });
  it('uses strong integer revisions with safe conflicts', () => {
    expect(expectedRevision(undefined)).toBeUndefined();
    expect(expectedRevision('"7"')).toBe(7);
    expect(revisionTag(7)).toBe('"7"');
    for (const header of ['W/"2"', '*', '"1", "2"', '"0"', '"2147483647"', '2'])
      expect(() => expectedRevision(header)).toThrow();
    expect(() => requireOneRevision(0)).toThrow('Conflict');
    expect(() => requireOneRevision(1)).not.toThrow();
  });
  it('maps only real ORM errors and never their private message/metadata', () => {
    for (const [code, status] of [
      ['P2002', 409],
      ['P2003', 400],
      ['P2025', 404],
      ['P2034', 409],
      ['P2024', 503],
      ['P1001', 503],
    ] as const) {
      expect(
        persistenceStatus(
          new Prisma.PrismaClientKnownRequestError('private password SQL', {
            code,
            clientVersion: 'test',
            meta: { target: 'private email' },
          }),
        ),
      ).toBe(status);
    }
    expect(persistenceStatus({ code: 'P2002' })).toBeUndefined();
    expect(persistenceStatus(new Error('P2002'))).toBeUndefined();
  });
  it('rejects undeclared/sensitive event payload and schema versions', () => {
    const event = {
      type: 'account.timezone_changed',
      version: 1,
      aggregateId: actor.userId,
      payload: {},
    };
    expect(EventSchema.parse(event)).toEqual(event);
    expect(() =>
      EventSchema.parse({
        ...event,
        payload: { timezone: 'Asia/Tehran', token: 'secret' },
      }),
    ).toThrow();
    expect(() => EventSchema.parse({ ...event, version: 2 })).toThrow();
  });
  it('returns a safe standard envelope for an ORM constraint failure', () => {
    const json = vi.fn();
    const response = {
      status: vi.fn().mockReturnThis(),
      json,
    } as unknown as Response;
    const exception = new Prisma.PrismaClientKnownRequestError(
      'private-email SQL password',
      {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: 'private-email' },
      },
    );
    new ApiExceptionFilter().reply(
      exception,
      { id: actor.requestId } as ContextRequest,
      response,
    );
    expect(response.status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'CONFLICT',
        message: 'Resource conflict',
        requestId: actor.requestId,
      },
    });
    expect(JSON.stringify(json.mock.calls)).not.toMatch(/private|password|SQL/);
  });
  it('blocks destructive or procedural migration forms without rejecting FK actions', () => {
    expect(reviewMigrations()).toEqual([
      '202610270001_p0_02_identity_ownership',
      '202610270002_p0_03_data_api_events',
      '202610270003_p0_04_private_files',
      '202610280001_p1_01_tasks',
      '202610280002_p1_02_task_recurrence_tools',
    ]);
    for (const sql of [
      '',
      '-- comment',
      'DROP TABLE "User";',
      'ALTER TABLE "User" DROP CONSTRAINT x;',
      'TRUNCATE "User";',
      'UPDATE "User" SET name=\'x\';',
      'ALTER TABLE "User" ALTER COLUMN id TYPE TEXT;',
      'DO $$ BEGIN END $$;',
    ])
      expect(() => assertAdditiveMigration(sql)).toThrow();
    expect(() =>
      assertAdditiveMigration(
        '/* review */ CREATE TABLE "x" (id uuid REFERENCES "User" (id) ON DELETE CASCADE ON UPDATE CASCADE);',
      ),
    ).not.toThrow();
  });
});
