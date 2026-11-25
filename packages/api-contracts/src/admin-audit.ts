import { z } from 'zod';
const category = z.enum(['SECURITY', 'CONTROL', 'PRIVACY']);
export const AdminAuditQuerySchema = z.strictObject({
  category,
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(1024).optional(),
  from: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
  action: z
    .string()
    .regex(/^[A-Za-z0-9_ /:.-]{1,100}$/)
    .optional(),
  actorId: z.uuid().optional(),
  targetId: z.uuid().optional(),
  requestId: z.uuid().optional(),
  outcome: z.enum(['SUCCEEDED', 'DENIED', 'FAILED']).optional(),
});
export const AdminAuditEntrySchema = z.strictObject({
  id: z.uuid(),
  source: z.enum(['ADMIN', 'USER_SECURITY']),
  eventId: z.uuid(),
  category,
  action: z.string().max(100),
  outcome: z.enum(['SUCCEEDED', 'DENIED', 'FAILED']),
  actorId: z.uuid().nullable(),
  targetAdminId: z.uuid().nullable(),
  targetFileId: z.uuid().nullable(),
  beforeRevision: z.number().int().nonnegative().nullable(),
  afterRevision: z.number().int().nonnegative().nullable(),
  targetUserId: z.uuid().nullable(),
  targetSpaceId: z.uuid().nullable(),
  requestId: z.uuid(),
  createdAt: z.iso.datetime(),
  reason: z.string().max(500).nullable(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export const adminAuditRoutes = {
  'GET audit': {
    permission: 'admin.audit.read',
    schema: AdminAuditQuerySchema,
    response: z.strictObject({
      items: z.array(AdminAuditEntrySchema).max(100),
      nextCursor: z.string().nullable(),
    }),
  },
  'GET audit/export': {
    permission: 'admin.audit.export',
    schema: AdminAuditQuerySchema,
    response: z.string().max(1048576),
  },
} as const;
