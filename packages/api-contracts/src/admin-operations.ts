import { z } from 'zod';

const Id = z.uuid(),
  Time = z.iso.datetime(),
  Reason = z.string().trim().min(1).max(500);
const Count = z.number().int().nonnegative(),
  Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const OperationsPageSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  after: Id.optional(),
});
const Empty = z.strictObject({});
export const OperationalQueueSchema = z.enum([
  'planner.sweep',
  'planner.outbox',
  'planner.delivery',
  'planner.dead',
]);
export const OperationalJobStateSchema = z.enum([
  'created',
  'retry',
  'active',
  'completed',
  'cancelled',
  'failed',
]);
export const OperationalRuleSchema = z.enum([
  'DATABASE',
  'QUEUE',
  'STORAGE',
  'WORKER',
  'DELIVERY',
  'BACKUP_AGE',
  'API_ERRORS',
]);
export const HealthAlertRuleSchema = z.strictObject({
  rule: OperationalRuleSchema,
  enabled: z.boolean(),
  severity: z.enum(['WARNING', 'CRITICAL']),
  threshold: z.number().int().min(1).max(1000000),
  repeatMinutes: z.number().int().min(5).max(10080),
  channels: z
    .array(z.enum(['IN_APP', 'EMAIL']))
    .min(1)
    .max(2)
    .refine((v) => new Set(v).size === v.length),
  silencedUntil: Time.nullable(),
});
export const HealthPolicySchema = z.strictObject({
  rules: z
    .array(HealthAlertRuleSchema)
    .max(7)
    .refine((v) => new Set(v.map((r) => r.rule)).size === v.length),
});
const JobRetention = z.strictObject({
  completedDays: z.number().int().min(7).max(90),
  failedDays: z.number().int().min(7).max(90),
});
export const JobPolicySchema = z.strictObject({
  sweepMinutes: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(10),
    z.literal(12),
    z.literal(15),
  ]),
  sweep: JobRetention,
  outbox: JobRetention,
  delivery: JobRetention,
  dead: JobRetention,
});
export const StoragePolicySchema = z.strictObject({
  mode: z.enum(['WARN', 'GRACE', 'BLOCK']),
  minimumFreeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  graceMinutes: z.number().int().min(1).max(1440),
  cleanupAgeHours: z.number().int().min(24).max(720),
});
export const BackupPolicySchema = z.strictObject({
  enabled: z.boolean(),
  intervalHours: z.number().int().min(1).max(168),
  drillIntervalDays: z.number().int().min(1).max(90),
});
export const OperationsPolicyInputSchema = z.discriminatedUnion('section', [
  z.strictObject({
    section: z.literal('HEALTH'),
    revision: Count.min(1),
    value: HealthPolicySchema,
    reason: Reason,
  }),
  z.strictObject({
    section: z.literal('JOBS'),
    revision: Count.min(1),
    value: JobPolicySchema,
    reason: Reason,
  }),
  z.strictObject({
    section: z.literal('STORAGE'),
    revision: Count.min(1),
    value: StoragePolicySchema,
    reason: Reason,
  }),
  z.strictObject({
    section: z.literal('BACKUP'),
    revision: Count.min(1),
    value: BackupPolicySchema,
    reason: Reason,
  }),
]);
export const OperationsPolicyValueSchema = z.union([
  HealthPolicySchema,
  JobPolicySchema,
  StoragePolicySchema,
  BackupPolicySchema,
]);
const Policy = z.strictObject({
  section: z.enum(['HEALTH', 'JOBS', 'STORAGE', 'BACKUP']),
  revision: Count.min(1),
  value: OperationsPolicyValueSchema,
});
const Draft = z.strictObject({
  id: Id,
  section: Policy.shape.section,
  expectedRevision: Count.min(1),
  value: OperationsPolicyValueSchema,
  impact: z.string().max(500),
  state: z.enum(['PREVIEW', 'PUBLISHED', 'EXPIRED']),
  expiresAt: Time,
});
const Check = z.strictObject({
  name: z.string().max(30),
  status: z.enum(['UP', 'DOWN', 'UNAVAILABLE']),
  latencyMs: Count,
  code: z.string().max(60).nullable(),
});
export const OperationsHealthSchema = z.strictObject({
  status: z.enum(['READY', 'DEGRADED']),
  observedAt: Time,
  checks: z.array(Check).max(10),
  api: z.strictObject({
    instanceId: Id,
    since: Time,
    requests: Count,
    errors: Count,
    inFlight: Count,
    meanLatencyMs: Count,
    requestsPerMinute: z.number().nonnegative(),
  }),
  workerLastSeenAt: Time.nullable(),
  storage: z
    .strictObject({
      totalBytes: z.string().regex(/^\d+$/),
      freeBytes: z.string().regex(/^\d+$/),
    })
    .nullable(),
});
const Incident = z.strictObject({
  id: Id,
  rule: OperationalRuleSchema,
  severity: HealthAlertRuleSchema.shape.severity,
  state: z.enum(['OPEN', 'RECOVERED']),
  cause: z.string().max(120),
  startedAt: Time,
  recoveredAt: Time.nullable(),
  lastNotifiedAt: Time.nullable(),
});
const IncidentNote = z.strictObject({
  id: Id,
  incidentId: Id,
  actorAdminId: Id,
  note: Reason,
  createdAt: Time,
});
const Job = z.strictObject({
  id: Id,
  queue: OperationalQueueSchema,
  state: OperationalJobStateSchema,
  attempts: Count,
  retryLimit: Count,
  scheduledAt: Time,
  createdAt: Time,
  startedAt: Time.nullable(),
  completedAt: Time.nullable(),
  errorCode: z.literal('JOB_FAILED').nullable(),
});
const Operation = z.strictObject({
  id: Id,
  kind: z.enum(['RUN', 'RETRY', 'CANCEL', 'CHECK']),
  state: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']),
  queue: OperationalQueueSchema.nullable(),
  jobId: Id.nullable(),
  attempts: Count,
  failureCode: z.string().max(60).nullable(),
  createdAt: Time,
  completedAt: Time.nullable(),
});
const Usage = z.strictObject({
  key: z.string().max(100),
  files: Count,
  bytes: z.string().regex(/^\d+$/),
});
const Cleanup = z.strictObject({
  id: Id,
  fingerprint: Hash,
  candidates: Count.max(100),
  bytes: z.string().regex(/^\d+$/),
  expiresAt: Time,
  state: z.enum(['PREVIEW', 'APPLIED', 'EXPIRED']),
  removed: Count,
});
export const OperationsBackupSchema = z.strictObject({
  id: Id,
  state: z.enum(['QUEUED', 'RUNNING', 'VERIFIED', 'FAILED', 'EXPIRED']),
  origin: z.enum(['MANUAL', 'SCHEDULE']),
  retentionDays: Count.min(1).max(30),
  policyRevision: Count.min(1),
  createdAt: Time,
  capturedAt: Time.nullable(),
  completedAt: Time.nullable(),
  expiresAt: Time.nullable(),
  failureCode: z.string().max(60).nullable(),
  encrypted: z.boolean(),
  offHostVerified: z.boolean(),
  manifestDigest: Hash.nullable(),
});
export const OperationsRestoreSchema = z.strictObject({
  id: Id,
  backupId: Id,
  mode: z.enum(['DRILL', 'RESTORE']),
  targetReference: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
  state: z.enum([
    'REQUESTED',
    'APPROVED',
    'RUNNING',
    'VERIFIED',
    'FAILED',
    'EXPIRED',
  ]),
  requesterAdminId: Id,
  approverAdminId: Id.nullable(),
  expiresAt: Time,
  createdAt: Time,
  completedAt: Time.nullable(),
  failureCode: z.string().max(60).nullable(),
  replayVerified: z.boolean(),
  readinessVerified: z.boolean(),
});
export const PrivateFileQuerySchema = z.strictObject({
  spaceId: Id,
  scopeId: Id.optional(),
  disposition: z.enum(['attachment', 'inline']).default('attachment'),
  reason: Reason.optional(),
});
const route = <T extends z.ZodType, R extends z.ZodType>(
  permission: string,
  schema: T,
  response: R,
) => ({ permission, schema, response });
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item).max(100), nextAfter: Id.nullable() });
export const adminOperationsRoutes = {
  'GET operations/health': route(
    'admin.health.read',
    Empty,
    OperationsHealthSchema,
  ),
  'POST operations/health/check': route(
    'admin.health.check',
    z.strictObject({ reason: Reason }),
    OperationsHealthSchema,
  ),
  'POST operations/health/repair': route(
    'admin.health.repair',
    z.strictObject({
      action: z.enum(['DISPATCH_SWEEP', 'RECHECK_DEPENDENCIES']),
      reason: Reason,
    }),
    Operation,
  ),
  'GET operations/incidents': route(
    'admin.health.read',
    OperationsPageSchema.extend({
      state: z.enum(['OPEN', 'RECOVERED']).optional(),
    }),
    page(Incident),
  ),
  'GET operations/incidents/:id/notes': route(
    'admin.health.notes',
    OperationsPageSchema,
    page(IncidentNote),
  ),
  'POST operations/incidents/:id/notes': route(
    'admin.health.notes',
    z.strictObject({ note: Reason, reason: Reason }),
    IncidentNote,
  ),
  'GET operations/policies': route(
    'admin.operations.policy.read',
    Empty,
    z.strictObject({ items: z.array(Policy).length(4) }),
  ),
  'POST operations/policies/preview': route(
    'admin.operations.policy.publish',
    OperationsPolicyInputSchema,
    Draft,
  ),
  'POST operations/policies/:id/publish': route(
    'admin.operations.policy.publish',
    z.strictObject({ reason: Reason }),
    Draft,
  ),
  'GET operations/jobs': route(
    'admin.jobs.read',
    OperationsPageSchema.extend({
      queue: OperationalQueueSchema.optional(),
      state: OperationalJobStateSchema.optional(),
    }),
    page(Job),
  ),
  'GET operations/job-controls/:id': route('admin.jobs.read', Empty, Operation),
  'POST operations/jobs/run': route(
    'admin.jobs.run',
    z.strictObject({
      queue: z.enum(['planner.sweep', 'planner.outbox']),
      reason: Reason,
    }),
    Operation,
  ),
  'POST operations/jobs/:id/retry': route(
    'admin.jobs.retry',
    z.strictObject({
      queue: z.enum(['planner.sweep', 'planner.outbox']),
      reason: Reason,
    }),
    Operation,
  ),
  'POST operations/jobs/:id/cancel': route(
    'admin.jobs.cancel',
    z.strictObject({
      queue: z.enum(['planner.sweep', 'planner.outbox']),
      reason: Reason,
    }),
    Operation,
  ),
  'GET operations/storage/usage': route(
    'admin.storage.read',
    z.strictObject({
      limit: z.coerce.number().int().min(1).max(100).default(25),
      groupBy: z.enum(['SPACE', 'TYPE', 'DAY']).default('SPACE'),
      spaceId: Id.optional(),
      from: Time.optional(),
      until: Time.optional(),
    }),
    z.strictObject({
      total: Usage,
      items: z.array(Usage).max(100),
      truncated: z.boolean(),
    }),
  ),
  'POST operations/storage/cleanup/preview': route(
    'admin.storage.cleanup',
    z.strictObject({ reason: Reason }),
    Cleanup,
  ),
  'POST operations/storage/cleanup/:id/apply': route(
    'admin.storage.cleanup',
    z.strictObject({ fingerprint: Hash, reason: Reason }),
    Cleanup,
  ),
  'GET operations/storage/files/:id/content': route(
    'admin.storage.private_files.read',
    PrivateFileQuerySchema,
    z.string(),
  ),
  'GET operations/backups': route(
    'admin.backups.read',
    OperationsPageSchema,
    page(OperationsBackupSchema),
  ),
  'GET operations/backups/:id': route(
    'admin.backups.read',
    Empty,
    OperationsBackupSchema,
  ),
  'POST operations/backups': route(
    'admin.backups.request',
    z.strictObject({ reason: Reason }),
    OperationsBackupSchema,
  ),
  'GET operations/restores': route(
    'admin.restores.read',
    OperationsPageSchema,
    page(OperationsRestoreSchema),
  ),
  'POST operations/restores': route(
    'admin.restores.request',
    z.strictObject({
      backupId: Id,
      mode: z.enum(['DRILL', 'RESTORE']),
      targetReference: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
      reason: Reason,
    }),
    OperationsRestoreSchema,
  ),
  'POST operations/restores/:id/approve': route(
    'admin.restores.approve',
    z.strictObject({
      backupId: Id,
      targetReference: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
      reason: Reason,
    }),
    OperationsRestoreSchema,
  ),
} as const;
