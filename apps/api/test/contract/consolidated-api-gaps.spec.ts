import 'reflect-metadata';
import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RequestMethod } from '@nestjs/common';
import {
  METHOD_METADATA,
  PATH_METADATA,
  GUARDS_METADATA,
} from '@nestjs/common/constants.js';
import * as c from '@mehran/api-contracts';
import { VerifiedSessionGuard } from '../../src/platform/auth/session.guard.js';
import {
  MessagingController,
  ConversationInvitationsController,
} from '../../src/modules/messaging/http/messaging.controller.js';
import { ConversationSummaryController } from '../../src/modules/messaging/http/conversation-summary.controller.js';
import { messagingOperations } from '../../../../packages/api-contracts/src/messaging-openapi.js';

it('maps every conversation foundation operation to exactly one protected HTTP handler', () => {
  const expected = messagingOperations
    .map((op) => op.method + ' /api/v1' + op.path)
    .sort();
  const actual: string[] = [];
  for (const controller of [
    MessagingController,
    ConversationInvitationsController,
    ConversationSummaryController,
  ]) {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(
      VerifiedSessionGuard,
    );
    for (const key of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = Object.getOwnPropertyDescriptor(controller.prototype, key)
        ?.value as object | undefined;
      if (typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as
        number | undefined;
      if (method === undefined) continue;
      const path = [
        Reflect.getMetadata(PATH_METADATA, controller) as string,
        Reflect.getMetadata(PATH_METADATA, handler) as string,
      ]
        .filter((v) => v && v !== '/')
        .join('/')
        .replace(/:(\w+)/g, '{$1}');
      const signature =
        RequestMethod[method]!.toLowerCase() + ' /api/v1/' + path;
      if (expected.includes(signature)) actual.push(signature);
    }
  }
  expect(actual.sort()).toEqual(expected);
});

it('keeps display fields response-only and rejects rename policy overposting', () => {
  const ref = {
    accessId: randomUUID(),
    generation: 1,
    displayName: 'Untrusted',
  };
  expect(c.CompanyStaffMemberSchema.safeParse(ref).success).toBe(false);
  expect(
    c.CompanyExpenseSubmitSchema.safeParse({ reviewer: ref }).success,
  ).toBe(false);
  expect(c.CompanyStaffMemberDisplaySchema.safeParse(ref).success).toBe(true);
  expect(
    c.ConversationRenameSchema.safeParse({
      title: 'Renamed',
      newcomerHistory: 'ALL',
    }).success,
  ).toBe(false);
  expect(
    c.ConversationRenameSchema.safeParse({ title: ' '.repeat(20) }).success,
  ).toBe(false);
});
