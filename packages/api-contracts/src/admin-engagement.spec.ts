import { it, expect } from 'vitest';
import {
  adminEngagementRoutes,
  ordinaryEngagementRoutes,
  P4CommunicationInput,
  P4Attachment,
} from './admin-engagement.js';
it('rejects caller-supplied staff authority, internal notes and reported item selectors', () => {
  expect(
    ordinaryEngagementRoutes[
      'POST support/tickets/:id/replies'
    ].schema.safeParse({ revision: 1, body: 'Reply', internal: true }).success,
  ).toBe(false);
  expect(
    adminEngagementRoutes['GET moderation/cases/:id/content'].schema.safeParse({
      reason: 'Case',
      itemId: 'a',
    }).success,
  ).toBe(false);
  expect(
    ordinaryEngagementRoutes['POST moderation/reports'].schema.safeParse({
      kind: 'TASK',
      targetId: '00000000-0000-4000-8000-000000000001',
      description: 'Report',
      category: 'ABUSE',
      actorUserId: 'forged',
    }).success,
  ).toBe(false);
});
it('requires explicit communication audience and limits channel/body inputs', () => {
  expect(P4CommunicationInput.safeParse({}).success).toBe(false);
  expect(
    P4Attachment.safeParse({
      filename: 'x',
      mediaType: 'text/html',
      base64: 'YWJj',
    }).success,
  ).toBe(false);
});
it('keeps essential security delivery out of optional per-type preferences', () => {
  expect(
    ordinaryEngagementRoutes[
      'PATCH communications/preferences'
    ].schema.safeParse({
      kind: 'SECURITY',
      inApp: false,
      email: false,
      webPush: false,
      revision: 1,
    }).success,
  ).toBe(false);
});
