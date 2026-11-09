import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import {
  METHOD_METADATA,
  PATH_METADATA,
  GUARDS_METADATA,
} from '@nestjs/common/constants.js';
import { VerifiedSessionGuard } from '../../src/platform/auth/session.guard.js';
import { DmContactsController } from '../../src/modules/messaging/http/dm-contacts.controller.js';
import { ConversationLifecycleController } from '../../src/modules/messaging/http/messaging-lifecycle.controller.js';
import { MeetingLifecycleController } from '../../src/modules/meetings/http/meetings-lifecycle.controller.js';
import { MessagingController } from '../../src/modules/messaging/http/messaging.controller.js';
import { MessageMediaController } from '../../src/modules/messaging/http/message-media.controller.js';
import { MeetingsController } from '../../src/modules/meetings/http/meetings.controller.js';
import {
  communicationLifecycleOperations,
  communicationLifecyclePaths,
} from '../../../../packages/api-contracts/src/communication-lifecycle-openapi.js';
const controllers = [
  DmContactsController,
  ConversationLifecycleController,
  MeetingLifecycleController,
  MessagingController,
  MessageMediaController,
  MeetingsController,
];
describe('P5-06 additive HTTP/OpenAPI parity', () => {
  it('maps every one of the thirteen additive operations to its actual protected controller route', () => {
    const expected = communicationLifecycleOperations
        .map((op) => op.method + ' /api/v1' + op.path)
        .sort(),
      wanted = new Set(expected),
      actual: string[] = [];
    for (const controller of controllers) {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[],
      ).toContain(VerifiedSessionGuard);
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = Object.getOwnPropertyDescriptor(
          controller.prototype,
          name,
        )?.value as object | undefined;
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          number | undefined;
        if (method === undefined) continue;
        const path = [
          String(Reflect.getMetadata(PATH_METADATA, controller)),
          String(Reflect.getMetadata(PATH_METADATA, handler)),
        ]
          .filter((v) => v && v !== '/')
          .join('/')
          .replace(/\/+$/, '')
          .replace(/:(\w+)/g, '{$1}');
        const key = RequestMethod[method]!.toLowerCase() + ' /api/v1/' + path;
        if (wanted.has(key)) actual.push(key);
      }
    }
    expect(expected).toHaveLength(13);
    expect(actual.sort()).toEqual(expected);
    expect(new Set(actual).size).toBe(13);
  });
  it('documents no-store, current-session and bounded retry/concurrency requirements for each additive operation', () => {
    const paths = communicationLifecyclePaths();
    for (const op of communicationLifecycleOperations) {
      const doc = paths['/api/v1' + op.path]![op.method] as {
        parameters: { name: string; required: boolean }[];
        responses: Record<string, unknown>;
        security: unknown;
      };
      expect(doc.security).toEqual([{ sessionCookie: [] }]);
      const encoded = JSON.stringify(doc);
      expect(encoded).toContain('no-store');
      expect(JSON.stringify(doc.responses['429'])).toContain('Retry-After');
      const headers = doc.parameters
        .filter((p) => p.required)
        .map((p) => p.name);
      if (op.key) expect(headers).toContain('Idempotency-Key');
      if (op.revision) expect(headers).toContain('If-Match');
      if (op.recovery) expect(headers).toContain('X-Deletion-Recovery');
      if (op.method === 'post') expect(headers).toContain('Origin');
    }
  });
});
