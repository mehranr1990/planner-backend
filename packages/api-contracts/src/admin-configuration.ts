import { z } from 'zod';
const uuid = z.uuid(),
  instant = z.iso.datetime();
export const ConfigurationReason = z.string().trim().min(5).max(500);
export const ConfigurationModuleSchema = z.enum([
  'tasks',
  'planning',
  'calendar',
  'habits',
  'goals',
  'focus',
  'notes',
  'journal',
  'finance',
  'capture',
  'notifications',
  'insights',
  'rewards',
  'files',
  'sync',
  'projects',
  'teams',
  'companies',
  'social',
  'messaging',
  'meetings',
  'commerce',
  'account',
  'spaces',
]);
export const ConfigurationOperationSchema = z.enum([
  'read',
  'write',
  'upload',
  'export',
  'delete',
]);
export const ConfigurationBindingSchema = z.strictObject({
  module: ConfigurationModuleSchema,
  operation: ConfigurationOperationSchema,
});
export const ConfigurationTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('GLOBAL') }),
  z.strictObject({
    kind: z.literal('SCOPE_TYPE'),
    scopeType: z.enum(['PERSONAL', 'TEAM', 'COMPANY']),
  }),
  z.strictObject({ kind: z.literal('WORKSPACE'), workspaceId: uuid }),
  z.strictObject({ kind: z.literal('USER'), userId: uuid }),
  z.strictObject({ kind: z.literal('GROUP'), groupId: uuid }),
]);
export const MaintenanceValueSchema = z
  .strictObject({
    mode: z.enum(['SCHEDULED_NOTICE', 'READ_ONLY', 'FULL']),
    bindings: z.array(ConfigurationBindingSchema).max(100),
    messages: z
      .record(
        z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/),
        z.string().trim().min(1).max(500),
      )
      .refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 20),
    defaultLocale: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/),
    estimatedEndAt: instant.nullable(),
    progress: z.number().int().min(0).max(100),
    status: z.string().trim().min(1).max(160),
  })
  .refine((v) => Object.hasOwn(v.messages, v.defaultLocale), {
    message: 'Default locale message required',
  });
export const ConfigurationValueSchema = z.union([
  z.boolean(),
  z.number().int().safe(),
  z.string().max(500),
  MaintenanceValueSchema,
]);
export const ConfigurationRuleSchema = z.strictObject({
  target: ConfigurationTargetSchema,
  value: ConfigurationValueSchema,
  priority: z.number().int().min(0).max(1000).default(0),
  basisPoints: z.number().int().min(0).max(10000).default(10000),
  steps: z
    .array(
      z.strictObject({
        at: instant,
        basisPoints: z.number().int().min(0).max(10000),
      }),
    )
    .max(30)
    .default([]),
});
export const ConfigurationPayloadSchema = z
  .strictObject({
    value: ConfigurationValueSchema,
    rules: z.array(ConfigurationRuleSchema).max(100).default([]),
    startsAt: instant.nullable().default(null),
    expiresAt: instant.nullable().default(null),
    minClientVersion: z.number().int().min(1).max(1).default(1),
  })
  .refine((v) => !v.expiresAt || !v.startsAt || v.expiresAt > v.startsAt, {
    message: 'Expiration must follow activation',
  });
export const ConfigurationCatalog = {
  'uploads.maxBytes': {
    category: 'PRODUCT',
    type: 'integer',
    defaultValue: 10485760,
    min: 1,
    max: 104857600,
    sensitive: false,
  },
  'tasks.defaultPriority': {
    category: 'PRODUCT',
    type: 'priority',
    defaultValue: 'NONE',
    sensitive: false,
  },
  'modules.tasks.enabled': {
    category: 'PRODUCT',
    type: 'boolean',
    defaultValue: true,
    sensitive: false,
  },
  'modules.files.enabled': {
    category: 'PRODUCT',
    type: 'boolean',
    defaultValue: true,
    sensitive: false,
  },
  'platform.locale': {
    category: 'SETTING',
    type: 'locale',
    defaultValue: 'en',
    sensitive: false,
  },
  'platform.notifications.enabled': {
    category: 'SETTING',
    type: 'boolean',
    defaultValue: true,
    sensitive: true,
  },
  'platform.maintenance': {
    category: 'SETTING',
    type: 'maintenance',
    defaultValue: false,
    sensitive: true,
  },
} as const;
export const ConfigurationDefinitionInputSchema = z.strictObject({
  key: z.string().regex(/^[a-z][A-Za-z0-9_.-]{2,99}$/),
  category: z.enum(['FLAG', 'PRODUCT', 'SETTING']),
  binding: ConfigurationBindingSchema.nullable().default(null),
  reason: ConfigurationReason,
});
export const ConfigurationDefinitionViewSchema = z.strictObject({
  id: uuid,
  key: z.string(),
  category: z.enum(['FLAG', 'PRODUCT', 'SETTING']),
  binding: ConfigurationBindingSchema.nullable(),
  revision: z.number().int().positive(),
  killed: z.boolean(),
  createdAt: instant,
});
export const ConfigurationDraftViewSchema = z.strictObject({
  id: uuid,
  definitionId: uuid,
  expectedRevision: z.number().int().positive(),
  payload: ConfigurationPayloadSchema,
  state: z.enum(['DRAFT', 'PREVIEW', 'PUBLISHED']),
  fingerprint: z.string().nullable(),
  previewExpiresAt: instant.nullable(),
  requesterAdminId: uuid,
  createdAt: instant,
});
export const ConfigurationImpactSchema = z.strictObject({
  users: z.number().int().nonnegative(),
  workspaces: z.number().int().nonnegative(),
  groups: z.number().int().nonnegative(),
  existingOversizeFiles: z.number().int().nonnegative(),
  effect: z.string(),
  fingerprint: z.string(),
  sensitive: z.boolean(),
});
export const ConfigurationVersionViewSchema = z.strictObject({
  id: uuid,
  definitionId: uuid,
  version: z.number().int().positive(),
  payload: ConfigurationPayloadSchema,
  actorAdminId: uuid,
  reason: ConfigurationReason,
  sourceVersionId: uuid.nullable(),
  createdAt: instant,
});
export const ConfigurationContextSchema = z.strictObject({
  userId: uuid.optional(),
  workspaceId: uuid.optional(),
  clientVersion: z.coerce.number().int().min(1).max(1).default(1),
});
export const ConfigurationEvaluationSchema = z.strictObject({
  definitionId: uuid,
  key: z.string(),
  value: ConfigurationValueSchema,
  source: z.enum([
    'KILL',
    'USER',
    'WORKSPACE',
    'GROUP',
    'SCOPE_TYPE',
    'GLOBAL',
    'DEFAULT',
  ]),
  rulePosition: z.number().int().nonnegative().nullable(),
  versionId: uuid.nullable(),
  version: z.number().int().positive().nullable(),
  generation: z.string(),
  evaluatedAt: instant,
  nextChangeAt: instant.nullable(),
  bucket: z.number().int().min(0).max(9999).nullable(),
  restrictedOnly: z.literal(true),
});
const page = z.strictObject({
    after: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
  empty = z.strictObject({});
const mutation = z.strictObject({
  revision: z.number().int().positive(),
  reason: ConfigurationReason,
});
export const adminConfigurationRoutes = {
  'GET configuration/catalog': {
    permission: 'admin.configuration.read',
    schema: empty,
    response: z.strictObject({
      items: z
        .array(
          z.strictObject({
            key: z.string(),
            category: z.string(),
            type: z.string(),
            defaultValue: ConfigurationValueSchema,
            sensitive: z.boolean(),
          }),
        )
        .max(100),
    }),
  },
  'GET configuration/definitions': {
    permission: 'admin.configuration.read',
    schema: page,
    response: z.strictObject({
      items: z.array(ConfigurationDefinitionViewSchema).max(100),
      nextCursor: uuid.nullable(),
    }),
  },
  'POST configuration/definitions': {
    permission: 'admin.configuration.draft',
    schema: ConfigurationDefinitionInputSchema,
    response: ConfigurationDefinitionViewSchema,
  },
  'POST configuration/definitions/:id/drafts': {
    permission: 'admin.configuration.draft',
    schema: mutation.extend({ payload: ConfigurationPayloadSchema }),
    response: ConfigurationDraftViewSchema,
  },
  'GET configuration/drafts/:id': {
    permission: 'admin.configuration.read',
    schema: empty,
    response: ConfigurationDraftViewSchema,
  },
  'POST configuration/drafts/:id/preview': {
    permission: 'admin.configuration.preview',
    schema: z.strictObject({ reason: ConfigurationReason }),
    response: z.strictObject({
      draft: ConfigurationDraftViewSchema,
      impact: ConfigurationImpactSchema,
      diff: z
        .array(
          z.strictObject({
            path: z.string(),
            before: z.json(),
            after: z.json(),
          }),
        )
        .max(300),
    }),
  },
  'POST configuration/drafts/:id/publish': {
    permission: 'admin.configuration.publish',
    schema: z.strictObject({
      reason: ConfigurationReason,
      approvalId: uuid.optional(),
    }),
    response: ConfigurationVersionViewSchema,
  },
  'GET configuration/definitions/:id/history': {
    permission: 'admin.configuration.read',
    schema: page,
    response: z.strictObject({
      items: z.array(ConfigurationVersionViewSchema).max(100),
      nextCursor: uuid.nullable(),
    }),
  },
  'GET configuration/definitions/:id/effective': {
    permission: 'admin.configuration.inspect',
    schema: ConfigurationContextSchema,
    response: ConfigurationEvaluationSchema,
  },
  'POST configuration/definitions/:id/rollback': {
    permission: 'admin.configuration.draft',
    schema: mutation.extend({ versionId: uuid }),
    response: ConfigurationDraftViewSchema,
  },
  'POST configuration/definitions/:id/kill': {
    permission: 'admin.configuration.kill',
    schema: mutation.extend({
      active: z.boolean(),
      approvalId: uuid.optional(),
    }),
    response: ConfigurationDefinitionViewSchema,
  },
  'POST configuration/versions/:id/reopen': {
    permission: 'admin.maintenance.reopen',
    schema: z.strictObject({ reason: ConfigurationReason, approvalId: uuid }),
    response: z.strictObject({
      versionId: uuid,
      reopened: z.literal(true),
      checkedAt: instant,
    }),
  },
  'GET configuration/versions/:id/readiness': {
    permission: 'admin.maintenance.reopen',
    schema: z.strictObject({ notBefore: instant.optional() }),
    response: z.strictObject({
      versionId: uuid,
      revision: z.number().int().positive(),
      fingerprint: z.string(),
      ready: z.boolean(),
      observedAt: instant,
    }),
  },
  'GET configuration/definitions/:id/kill-release-preview': {
    permission: 'admin.configuration.kill',
    schema: empty,
    response: z.strictObject({
      definitionId: uuid,
      revision: z.number().int().positive(),
      fingerprint: z.string(),
    }),
  },
  'POST configuration/versions/:id/schedule-reopen': {
    permission: 'admin.maintenance.reopen',
    schema: z.strictObject({
      reason: ConfigurationReason,
      approvalId: uuid,
      notBefore: instant,
    }),
    response: z.strictObject({
      id: uuid,
      versionId: uuid,
      state: z.enum(['PENDING', 'WAITING', 'RELEASED', 'REVIEW', 'CANCELED']),
      notBefore: instant,
      nextAttemptAt: instant,
      failureCode: z.string().nullable(),
    }),
  },
  'GET configuration/versions/:id/reopen-schedule': {
    permission: 'admin.maintenance.reopen',
    schema: empty,
    response: z.strictObject({
      id: uuid,
      versionId: uuid,
      state: z.enum(['PENDING', 'WAITING', 'RELEASED', 'REVIEW', 'CANCELED']),
      notBefore: instant,
      nextAttemptAt: instant,
      failureCode: z.string().nullable(),
    }),
  },
  'GET configuration/definitions/:id/events': {
    permission: 'admin.configuration.read',
    schema: page,
    response: z.strictObject({
      items: z
        .array(
          z.strictObject({
            id: uuid,
            definitionId: uuid,
            versionId: uuid.nullable(),
            kind: z.string(),
            actorAdminId: uuid.nullable(),
            reason: z.string(),
            metadata: z.json(),
            createdAt: instant,
          }),
        )
        .max(100),
      nextCursor: uuid.nullable(),
    }),
  },
} as const;
export const ConfigurationMaintenanceStatusSchema = z.strictObject({
  available: z.boolean(),
  source: z.enum(['DATABASE', 'INDEPENDENT', 'UNAVAILABLE']),
  generation: z.string(),
  observedAt: instant,
  items: z
    .array(
      z.strictObject({
        versionId: uuid.nullable(),
        active: z.boolean(),
        startsAt: instant,
        countdownToStartSeconds: z.number().int().nonnegative(),
        mode: z.enum(['SCHEDULED_NOTICE', 'READ_ONLY', 'FULL']),
        bindings: z.array(ConfigurationBindingSchema),
        messages: z.record(z.string(), z.string()),
        defaultLocale: z.string(),
        estimatedEndAt: instant.nullable(),
        countdownSeconds: z.number().int().nonnegative().nullable(),
        overrunning: z.boolean(),
        progress: z.number().int().min(0).max(100),
        status: z.string(),
        lastUpdatedAt: instant,
      }),
    )
    .max(100),
});
export const publicConfigurationRoutes = {
  'GET platform/maintenance': {
    schema: empty,
    response: ConfigurationMaintenanceStatusSchema,
  },
} as const;
export const ordinaryConfigurationRoutes = {
  'GET platform/configuration': {
    schema: z.strictObject({
      workspaceId: uuid.optional(),
      clientVersion: z.coerce.number().int().min(1).max(1).default(1),
    }),
    response: z.strictObject({
      items: z.array(ConfigurationEvaluationSchema).max(500),
    }),
  },
} as const;
export type ConfigurationPayload = z.infer<typeof ConfigurationPayloadSchema>;
export type ConfigurationContext = z.infer<typeof ConfigurationContextSchema>;
