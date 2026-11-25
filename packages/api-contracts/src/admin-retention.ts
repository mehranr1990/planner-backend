import { z } from 'zod';
const category = z.enum(['SECURITY', 'CONTROL', 'PRIVACY']);
const auditDays = { category, days: z.number().int().min(730).max(3650) };
const backupDays = {
  category: z.literal('BACKUP'),
  days: z.number().int().min(1).max(30),
};
const fields = {
  revision: z.number().int().positive(),
};
const policy = z.union([
  z.strictObject({ ...fields, ...auditDays }),
  z.strictObject({ ...fields, ...backupDays }),
]);
const previewFields = { ...fields, reason: z.string().trim().min(5).max(500) };
const changeFields = {
  id: z.uuid(),
  expectedRevision: z.number().int().positive(),
  eligibleRecords: z.number().int().nonnegative(),
  state: z.enum(['PREVIEW', 'APPROVED', 'APPLIED', 'EXPIRED']),
  requesterAdminId: z.uuid(),
  approverAdminId: z.uuid().nullable(),
  reason: z.string().max(500),
  expiresAt: z.iso.datetime(),
};
const change = z.union([
  z.strictObject({ ...changeFields, ...auditDays }),
  z.strictObject({ ...changeFields, ...backupDays }),
]);
const empty = z.strictObject({});
export const adminRetentionRoutes = {
  'GET privacy/retention': {
    permission: 'admin.privacy.retention.read',
    schema: empty,
    response: z.strictObject({ items: z.array(policy).length(4) }),
  },
  'POST privacy/retention/preview': {
    permission: 'admin.privacy.retention.preview',
    schema: z.union([
      z.strictObject({ ...previewFields, ...auditDays }),
      z.strictObject({ ...previewFields, ...backupDays }),
    ]),
    response: change,
  },
  'GET privacy/retention/changes/:id': {
    permission: 'admin.privacy.retention.read',
    schema: empty,
    response: change,
  },
  'POST privacy/retention/changes/:id/approve': {
    permission: 'admin.privacy.retention.approve',
    schema: z.strictObject({
      reason: z.string().trim().min(5).max(500),
      eligibleRecords: z.number().int().nonnegative(),
    }),
    response: change,
  },
  'POST privacy/retention/changes/:id/apply': {
    permission: 'admin.privacy.retention.publish',
    schema: empty,
    response: change,
  },
  'POST privacy/retention/expire': {
    permission: 'admin.privacy.retention.expire',
    schema: z.strictObject({
      category,
      limit: z.number().int().min(1).max(100),
      reason: z.string().trim().min(5).max(500),
    }),
    response: z.strictObject({
      deleted: z.number().int().nonnegative().max(100),
    }),
  },
} as const;
