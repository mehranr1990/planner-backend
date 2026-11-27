import fs from 'node:fs';
import { expect, it } from 'vitest';
import { createOpenApiDocument } from '../../packages/api-contracts/src/openapi.js';
import { InvitationNotificationUnreadCountSchema } from '../../packages/api-contracts/src/client-invitations.js';
import {
  adminIntegrationMarkdown,
  buildAdminIntegrationReference,
} from '../scripts/admin-integration-reference.ts';

it('exports recipient-only unread counts with all six kinds and no pagination or discovery inputs', () => {
  const doc = createOpenApiDocument() as unknown as {
    paths: Record<
      string,
      { get?: { security: unknown; parameters?: { name: string }[] } }
    >;
  };
  const count =
    doc.paths['/api/v1/invitation-notifications/unread-count']!.get!;
  expect(count.security).toEqual([{ sessionCookie: [] }]);
  expect(count.parameters ?? []).toEqual([]);
  const byKind = {
    PROJECT: 0,
    TEAM: 0,
    COMPANY: 0,
    CONVERSATION: 0,
    MEETING: 0,
    SOCIAL_GROUP: 0,
  };
  expect(
    InvitationNotificationUnreadCountSchema.parse({ total: 0, byKind }),
  ).toEqual({ total: 0, byKind });
  expect(
    InvitationNotificationUnreadCountSchema.safeParse({
      total: 0,
      byKind: { TEAM: 0 },
    }).success,
  ).toBe(false);
  expect(
    InvitationNotificationUnreadCountSchema.safeParse({
      total: 0,
      byKind: { ...byKind, PROJECT: -1 },
    }).success,
  ).toBe(false);
});

it('maps every current Admin operation and exact server role capabilities across all 22 modules', async () => {
  const ref = buildAdminIntegrationReference();
  const doc = createOpenApiDocument();
  const adminOperations = Object.entries(doc.paths)
    .filter(([path]) => path.startsWith('/api/v1/admin/'))
    .reduce((sum, [, methods]) => sum + Object.keys(methods).length, 0);
  expect(ref.operations.length).toBe(adminOperations);
  expect(new Set(ref.operations.map((o) => o.operationId)).size).toBe(
    adminOperations,
  );
  expect(ref.modules).toHaveLength(22);
  expect(ref.modules.every((m) => m.operationIds.length > 0)).toBe(true);
  expect(ref.roles.BILLING_MANAGER).toContain('admin.analytics.financial.read');
  expect(ref.roles.BILLING_MANAGER).not.toContain(
    'admin.analytics.product.read',
  );
  expect(ref.roles.SECURITY_REVIEWER).toContain(
    'admin.moderation.content.read',
  );
  expect(ref.roles.SUPPORT).not.toContain('admin.storage.private_files.read');
  expect(
    fs.readFileSync(
      'docs/frontend-handoff/PLATFORM_ADMIN_API_REFERENCE.md',
      'utf8',
    ),
  ).toBe(await adminIntegrationMarkdown());
});
