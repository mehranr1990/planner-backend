import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { MeetingsController } from '../../src/modules/meetings/http/meetings.controller.js';
import { MeetingDocumentsController } from '../../src/modules/meetings/http/meeting-documents.controller.js';
import { AnnouncementsController } from '../../src/modules/meetings/http/announcements.controller.js';
import { MeetingAttachmentsController } from '../../src/modules/meetings/http/meeting-attachments.controller.js';
import { AnnouncementAttachmentsController } from '../../src/modules/meetings/http/announcement-attachments.controller.js';
import { randomUUID } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import {
  meetingOperations,
  meetingPaths,
} from '../../../../packages/api-contracts/src/meetings-openapi.js';
import { communicationLifecycleOperations } from '../../../../packages/api-contracts/src/communication-lifecycle-openapi.js';
describe('P5-05 strict additive REST contracts', () => {
  it('documents all 52 protected operations, binary transfers and explicit concurrency controls', () => {
    expect(meetingOperations).toHaveLength(52);
    const paths = meetingPaths();
    const actual: string[] = [];
    for (const controller of [
      MeetingsController,
      MeetingDocumentsController,
      AnnouncementsController,
      MeetingAttachmentsController,
      AnnouncementAttachmentsController,
    ])
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = Object.getOwnPropertyDescriptor(
          controller.prototype,
          name,
        )?.value as object | undefined;
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          number | undefined;
        if (method === undefined) continue;
        actual.push(
          RequestMethod[method]!.toLowerCase() +
            ' /api/v1/' +
            [
              String(Reflect.getMetadata(PATH_METADATA, controller)),
              String(Reflect.getMetadata(PATH_METADATA, handler)),
            ]
              .filter((v) => v && v !== '/')
              .join('/')
              .replace(/\/+$/, '')
              .replace(/:(\w+)/g, '{$1}'),
        );
      }
    expect(actual.sort()).toEqual(
      [
        ...meetingOperations.filter((op) => !op.path.startsWith('/teams/')),
        ...communicationLifecycleOperations.filter(
          (op) => op.path === '/meetings/{id}/restore-admission',
        ),
      ]
        .map((op) => op.method + ' /api/v1' + op.path)
        .sort(),
    );
    for (const operation of meetingOperations) {
      const json = JSON.stringify(
        paths['/api/v1' + operation.path]![operation.method],
      );
      expect(json).toContain('sessionCookie');
      expect(json).toContain('no-store');
      if (operation.key) expect(json).toContain('Idempotency-Key');
      if (operation.revision) expect(json).toContain('If-Match');
      if (operation.binary || operation.download)
        expect(json).toContain('application/octet-stream');
    }
    expect(
      JSON.stringify(paths['/api/v1/announcements/scopes/{kind}/{scopeId}']),
    ).toContain('COMPANY');
  });
  it('rejects unsafe URLs, account spoofing, recurrence and repeated participants', () => {
    expect(
      c.MeetingPatchSchema.safeParse({
        state: 'CANCELED',
        event: { status: 'ACTIVE' },
      }).success,
    ).toBe(false);
    const actor = randomUUID(),
      input = {
        id: randomUUID(),
        kind: 'INDEPENDENT',
        retentionPolicyVersion: 'v1',
        participants: [actor],
        event: {
          title: 'Meeting',
          schedule: {
            kind: 'ALL_DAY',
            timezone: 'UTC',
            startDate: '2026-12-01',
            endDate: '2026-12-02',
          },
        },
      };
    expect(c.MeetingCreateSchema.safeParse(input).success).toBe(true);
    for (const patch of [
      { externalUrl: 'http://example.test' },
      { externalUrl: 'https://user:pass@example.test' },
      { createdByUserId: actor },
      { participants: [actor, actor] },
      { event: { ...input.event, recurrence: { frequency: 'DAILY' } } },
    ])
      expect(
        c.MeetingCreateSchema.safeParse({ ...input, ...patch }).success,
      ).toBe(false);
  });
  it('requires generation-bound named audiences and rejects implicit acknowledgements', () => {
    const member = { accessId: randomUUID(), generation: 1 };
    expect(
      c.AnnouncementPublishSchema.safeParse({
        audience: 'NAMED',
        members: [member],
      }).success,
    ).toBe(true);
    for (const input of [
      { audience: 'NAMED', members: [member, member] },
      { audience: 'NAMED', members: [{ accessId: member.accessId }] },
      { audience: 'ALL', members: [member] },
      { audience: 'NAMED', members: [] },
    ])
      expect(c.AnnouncementPublishSchema.safeParse(input).success).toBe(false);
    expect(
      c.MeetingEmptySchema.safeParse({
        acknowledged: true,
        userId: randomUUID(),
      }).success,
    ).toBe(false);
  });
  it('bounds immutable minutes links and excludes arbitrary Task destinations', () => {
    const id = randomUUID(),
      draft = {
        id,
        minutes: 'Text',
        decisions: [],
        actions: [],
        attachments: [id],
        contributors: [],
      };
    expect(c.MeetingVersionCreateSchema.safeParse(draft).success).toBe(true);
    expect(
      c.MeetingVersionCreateSchema.safeParse({
        ...draft,
        attachments: [id, id],
      }).success,
    ).toBe(false);
    expect(
      c.MeetingTaskCommandSchema.safeParse({ sourceId: randomUUID() }).success,
    ).toBe(false);
  });
});
