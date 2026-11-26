import { z } from 'zod';
const Id = z.uuid(),
  Time = z.iso.datetime(),
  Text = (max: number) =>
    z
      .string()
      .trim()
      .min(1)
      .max(max)
      .refine((v) => !v.includes('\0'));
const Empty = z.strictObject({}),
  Reason = Text(500),
  Rev = z.number().int().positive();
export const P4Page = z.strictObject({
  after: Id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const P4TicketState = z.enum([
  'NEW',
  'OPEN',
  'WAITING_FOR_USER',
  'WAITING_FOR_SUPPORT',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
]);
export const P4CaseState = z.enum([
  'NEW',
  'TRIAGED',
  'INVESTIGATING',
  'ACTION_TAKEN',
  'DISMISSED',
  'APPEALED',
  'CLOSED',
]);
const Priority = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
export const P4Attachment = z.strictObject({
  filename: Text(200),
  mediaType: z.enum([
    'text/plain',
    'image/png',
    'image/jpeg',
    'application/pdf',
  ]),
  base64: z
    .string()
    .min(4)
    .max(6990508)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
const Evidence = z.object({
  id: Id,
  filename: z.string(),
  mediaType: z.string(),
  size: z.number().int(),
  createdAt: Time,
});
const Reply = z.object({
  id: Id,
  body: z.string(),
  internal: z.boolean(),
  source: z.string(),
  authorUserId: Id.nullable(),
  authorAdminId: Id.nullable(),
  createdAt: Time,
});
const Event = z.object({
  id: Id,
  kind: z.string(),
  public: z.boolean(),
  text: z.string().nullable(),
  createdAt: Time,
});
const Ticket = z.object({
  id: Id,
  ownerUserId: Id,
  spaceId: Id.nullable(),
  scopeId: Id.nullable(),
  queueId: Id,
  assigneeAdminId: Id.nullable(),
  subject: z.string(),
  category: z.string(),
  priority: Priority,
  state: P4TicketState,
  revision: Rev,
  slaDueAt: Time,
  resolvedAt: Time.nullable(),
  archivedAt: Time.nullable(),
  feedback: z.number().nullable(),
  createdAt: Time,
  updatedAt: Time,
});
const TicketDetail = Ticket.extend({
  replies: z.array(Reply).max(100),
  evidence: z.array(Evidence).max(100),
  history: z.array(Event).max(100),
  truncated: z.boolean(),
});
const Case = z.object({
  id: Id,
  sourceKind: z.enum([
    'ACCOUNT',
    'WORKSPACE',
    'BEHAVIOR',
    'TASK',
    'NOTE',
    'MESSAGE',
  ]),
  category: z.string(),
  description: z.string(),
  priority: Priority,
  state: P4CaseState,
  revision: Rev,
  publicOutcome: z.string().nullable(),
  decidedAt: Time.nullable(),
  appealedAt: Time.nullable(),
  createdAt: Time,
  updatedAt: Time,
});
const CaseDetail = Case.extend({
  evidence: z.array(Evidence).max(100),
  history: z.array(Event).max(100),
  truncated: z.boolean(),
});
const Queue = z.object({
  id: Id,
  name: z.string(),
  active: z.boolean(),
  slaMinutes: z.number().int(),
  revision: Rev,
});
const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item).max(100), nextCursor: Id.nullable() });
export const P4TemplateInput = z.strictObject({
  name: Text(100),
  version: Rev,
  fallbackLocale: Text(30),
  translations: z
    .array(
      z.strictObject({
        locale: Text(30),
        subject: Text(200),
        body: Text(10000),
      }),
    )
    .min(1)
    .max(20),
  reason: Reason,
});
const Template = z.object({
  id: Id,
  name: z.string(),
  version: Rev,
  fallbackLocale: z.string(),
  translations: P4TemplateInput.shape.translations,
  state: z.enum(['DRAFT', 'APPROVED', 'ARCHIVED']),
  createdByAdminId: Id,
  approvedByAdminId: Id.nullable(),
  createdAt: Time,
});
export const P4Audience = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('USERS'),
    userIds: z.array(Id).min(1).max(1000),
  }),
  z.strictObject({
    kind: z.literal('FILTER'),
    verified: z.boolean().optional(),
    createdFrom: Time.optional(),
    createdUntil: Time.optional(),
  }),
  z.strictObject({ kind: z.literal('WORKSPACE'), scopeId: Id }),
  z.strictObject({ kind: z.literal('GLOBAL') }),
]);
export const P4CommunicationInput = z.strictObject({
  templateId: Id,
  kind: z.enum(['SYSTEM', 'DIRECT', 'GROUP', 'GLOBAL', 'SECURITY']),
  audience: P4Audience,
  variables: z.strictObject({
    workspaceName: Text(500).optional(),
    publicReason: Text(500).optional(),
  }),
  channels: z
    .array(z.enum(['IN_APP', 'EMAIL', 'WEB_PUSH']))
    .min(1)
    .max(3),
  scheduledAt: Time.optional(),
  reason: Reason,
});
const Campaign = z.object({
  id: Id,
  templateId: Id,
  kind: P4CommunicationInput.shape.kind,
  audience: P4Audience,
  channels: P4CommunicationInput.shape.channels,
  state: z.enum(['PREVIEW', 'SCHEDULED', 'CANCELED', 'COMPLETE']),
  revision: Rev,
  expiresAt: Time,
  scheduledAt: Time,
  testedAt: Time.nullable(),
  approvedByAdminId: Id.nullable(),
  createdAt: Time,
});
const Delivery = z.object({
  id: Id,
  userId: Id,
  channel: z.string(),
  state: z.string(),
  attempts: z.number().int(),
  lastCode: z.string().nullable(),
  readAt: Time.nullable(),
  locale: z.string().nullable(),
  subject: z.string().nullable(),
  body: z.string().nullable(),
  createdAt: Time,
});
const mutation = z.strictObject({ revision: Rev, reason: Reason });
const route = <P extends string, S extends z.ZodType, R extends z.ZodType>(
  permission: P,
  schema: S,
  response: R,
) => ({ permission, schema, response });
export const P4PolicyPreview = z.object({
  id: Id,
  kind: z.literal('P4_POLICY_PREVIEW'),
  section: z.enum(['SUPPORT', 'MODERATION', 'COMMUNICATIONS']),
  revision: Rev,
  value: z.record(z.string(), z.number().int()),
  expiresAt: Time,
  impact: z.object({
    archiveTickets: z.number().int().nonnegative(),
    deleteRecords: z.number().int().nonnegative(),
    evidenceFiles: z.number().int().nonnegative(),
    publicAndInternalReplies: z.number().int().nonnegative(),
    deliveryRecords: z.number().int().nonnegative(),
    idempotencyReceipts: z.number().int().nonnegative(),
    existingModerationDeadlinesUnchanged: z.literal(true),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});
export const adminEngagementRoutes = {
  'GET moderation/escalations': route(
    'admin.security.read',
    P4Page,
    page(
      z.object({
        id: Id,
        kind: z.string(),
        ticketId: Id.nullable(),
        caseId: Id.nullable(),
        readAt: Time.nullable(),
        createdAt: Time,
      }),
    ),
  ),
  'POST moderation/escalations/:id/read': route(
    'admin.security.read',
    Empty,
    z.object({ id: Id, readAt: Time }),
  ),
  'GET communications/:id/targets': route(
    'admin.communications.read',
    P4Page,
    z.object({
      items: z
        .array(
          z.object({
            userId: Id,
            pushState: z.enum([
              'NOT_REQUESTED',
              'AVAILABLE',
              'NO_VALID_DEVICE',
            ]),
          }),
        )
        .max(100),
      nextCursor: Id.nullable(),
    }),
  ),
  'GET support/notices': route(
    'admin.support.read',
    P4Page,
    page(
      z.object({
        id: Id,
        kind: z.string(),
        ticketId: Id.nullable(),
        caseId: Id.nullable(),
        readAt: Time.nullable(),
        createdAt: Time,
      }),
    ),
  ),
  'POST support/notices/:id/read': route(
    'admin.support.read',
    Empty,
    z.object({ id: Id, readAt: Time }),
  ),

  'GET communications/templates': route(
    'admin.communications.read',
    P4Page,
    page(Template),
  ),
  'POST communications/templates': route(
    'admin.communications.templates',
    P4TemplateInput,
    Template,
  ),
  'POST communications/templates/:id/approve': route(
    'admin.communications.approve',
    z.strictObject({ reason: Reason }),
    Template,
  ),
  'POST communications/templates/:id/archive': route(
    'admin.communications.templates',
    z.strictObject({ reason: Reason }),
    Template,
  ),
  'POST communications/preview': route(
    'admin.communications.send',
    P4CommunicationInput,
    Campaign.extend({
      recipients: z.number().int(),
      targetUserIds: z.array(Id).max(1000),
    }),
  ),
  'GET communications': route(
    'admin.communications.read',
    P4Page,
    page(Campaign),
  ),
  'GET communications/:id': route(
    'admin.communications.read',
    P4Page,
    Campaign.extend({
      deliveries: z.array(Delivery).max(100),
      nextCursor: Id.nullable(),
      counts: z.array(z.object({ state: z.string(), count: z.number().int() })),
    }),
  ),
  'POST communications/:id/test': route(
    'admin.communications.send',
    mutation,
    z.object({
      tested: z.literal(true),
      locale: z.string(),
      subject: z.string(),
      body: z.string(),
    }),
  ),
  'POST communications/:id/approve': route(
    'admin.communications.approve',
    mutation,
    Campaign,
  ),
  'POST communications/:id/send': route(
    'admin.communications.send',
    mutation,
    Campaign,
  ),
  'POST communications/:id/cancel': route(
    'admin.communications.send',
    mutation,
    Campaign,
  ),
  'GET support/queues': route(
    'admin.support.read',
    Empty,
    z.object({ items: z.array(Queue).max(100) }),
  ),
  'POST support/queues': route(
    'admin.support.configure',
    z.strictObject({
      name: Text(100),
      slaMinutes: z.number().int().min(15).max(43200),
      reason: Reason,
    }),
    Queue,
  ),
  'PATCH support/queues/:id': route(
    'admin.support.configure',
    z.strictObject({
      revision: Rev,
      name: Text(100),
      active: z.boolean(),
      slaMinutes: z.number().int().min(15).max(43200),
      reason: Reason,
    }),
    Queue,
  ),
  'GET support/tickets': route(
    'admin.support.read',
    P4Page.extend({
      state: P4TicketState.optional(),
      assigneeAdminId: Id.optional(),
      queueId: Id.optional(),
    }),
    page(Ticket),
  ),
  'GET support/tickets/:id': route(
    'admin.support.read',
    Empty,
    TicketDetail.extend({
      account: z.object({
        id: Id,
        name: z.string(),
        email: z.string(),
        emailVerified: z.boolean(),
      }),
    }),
  ),
  'POST support/tickets/:id/replies': route(
    'admin.support.reply',
    z.strictObject({
      revision: Rev,
      body: Text(20000),
      internal: z.boolean().default(false),
      reason: Reason,
    }),
    Ticket,
  ),
  'POST support/tickets/:id/assign': route(
    'admin.support.assign',
    z.strictObject({
      revision: Rev,
      assigneeAdminId: Id.nullable(),
      queueId: Id,
      priority: Priority,
      category: Text(80),
      reason: Reason,
    }),
    Ticket,
  ),
  'POST support/tickets/:id/state': route(
    'admin.support.reply',
    z.strictObject({ revision: Rev, state: P4TicketState, reason: Reason }),
    Ticket,
  ),
  'POST support/tickets/:id/archive': route(
    'admin.support.configure',
    mutation,
    Ticket,
  ),
  'GET support/tickets/:id/evidence': route(
    'admin.support.read',
    z.strictObject({ evidenceId: Id }),
    z.string(),
  ),
  'GET moderation/cases': route(
    'admin.moderation.read',
    P4Page.extend({ state: P4CaseState.optional() }),
    page(Case),
  ),
  'GET moderation/cases/:id': route(
    'admin.moderation.read',
    Empty,
    CaseDetail.extend({
      internalOutcome: z.string().nullable(),
      targetUserId: Id.nullable(),
      targetSpaceId: Id.nullable(),
      decisionAdminId: Id.nullable(),
      appealReviewerAdminId: Id.nullable(),
    }),
  ),
  'POST moderation/reports': route(
    'admin.moderation.report',
    z.strictObject({
      targetUserId: Id.optional(),
      targetSpaceId: Id.optional(),
      category: Text(80),
      description: Text(20000),
      reason: Reason,
    }),
    Case,
  ),
  'POST moderation/cases/:id/state': route(
    'admin.moderation.manage',
    z.strictObject({
      revision: Rev,
      state: P4CaseState,
      publicOutcome: Text(2000).optional(),
      internalOutcome: Text(10000).optional(),
      priority: Priority.optional(),
      reason: Reason,
    }),
    Case,
  ),
  'GET moderation/cases/:id/content': route(
    'admin.moderation.content.read',
    z.strictObject({ reason: Reason }),
    z.object({
      kind: z.string(),
      itemId: Id,
      content: z.union([
        z.object({
          id: Id,
          title: z.string(),
          descriptionContent: z.string().nullable(),
          status: z.string(),
          deletedAt: Time.nullable(),
        }),
        z.object({
          id: Id,
          title: z.string(),
          content: z.string(),
          contentFormat: z.string(),
          revision: Rev,
        }),
        z.object({ id: Id, text: z.string() }),
      ]),
    }),
  ),
  'GET moderation/cases/:id/evidence': route(
    'admin.moderation.content.read',
    z.strictObject({ evidenceId: Id, reason: Reason }),
    z.string(),
  ),
  'POST moderation/cases/:id/penalty': route(
    'admin.moderation.penalty',
    z.strictObject({
      revision: Rev,
      action: z.enum([
        'WARNING',
        'RESTRICT_REPORTING',
        'RESTRICT_SUPPORT',
        'SUSPEND_ACCOUNT',
        'SUSPEND_WORKSPACE',
        'ESCALATE_SECURITY',
      ]),
      until: Time.optional(),
      publicReason: Text(500),
      reason: Reason,
    }),
    Case,
  ),
  'GET engagement/policies': route(
    'admin.engagement.configure',
    Empty,
    z.object({
      items: z
        .array(
          z.object({
            section: z.string(),
            revision: Rev,
            value: z.record(z.string(), z.number().int()),
          }),
        )
        .max(3),
    }),
  ),
  'POST engagement/policies/:id/preview': route(
    'admin.engagement.configure',
    z.strictObject({
      revision: Rev,
      value: z.record(z.string(), z.number().int().min(1).max(3650)),
      reason: Reason,
    }),
    P4PolicyPreview,
  ),
  'PATCH engagement/policies/:id': route(
    'admin.engagement.configure',
    z.strictObject({
      revision: Rev,
      value: z.record(z.string(), z.number().int().min(1).max(3650)),
      previewId: Id,
      impactFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      impactAcknowledged: z.literal(true),
      reason: Reason,
    }),
    z.object({
      section: z.string(),
      revision: Rev,
      value: z.record(z.string(), z.number().int()),
    }),
  ),
} as const;
export const ordinaryEngagementRoutes = {
  'GET communications/preferences': {
    schema: Empty,
    response: z.object({
      items: z
        .array(
          z.object({
            kind: z.enum(['SYSTEM', 'DIRECT', 'GROUP', 'GLOBAL']),
            inApp: z.boolean(),
            email: z.boolean(),
            webPush: z.boolean(),
            revision: Rev,
          }),
        )
        .max(4),
    }),
  },
  'PATCH communications/preferences': {
    schema: z.strictObject({
      kind: z.enum(['SYSTEM', 'DIRECT', 'GROUP', 'GLOBAL']),
      inApp: z.boolean(),
      email: z.boolean(),
      webPush: z.boolean(),
      revision: Rev,
    }),
    response: z.object({
      kind: z.string(),
      inApp: z.boolean(),
      email: z.boolean(),
      webPush: z.boolean(),
      revision: Rev,
    }),
  },

  'GET support/queues': {
    schema: Empty,
    response: z.object({ items: z.array(Queue).max(100) }),
  },
  'POST support/tickets': {
    schema: z.strictObject({
      queueId: Id,
      subject: Text(200),
      category: Text(80),
      body: Text(20000),
      scopeId: Id.optional(),
    }),
    response: Ticket,
  },
  'GET support/tickets': { schema: P4Page, response: page(Ticket) },
  'GET support/tickets/:id': { schema: Empty, response: TicketDetail },
  'POST support/tickets/:id/replies': {
    schema: z.strictObject({ revision: Rev, body: Text(20000) }),
    response: Ticket,
  },
  'POST support/tickets/:id/reopen': {
    schema: z.strictObject({ revision: Rev }),
    response: Ticket,
  },
  'POST support/tickets/:id/feedback': {
    schema: z.strictObject({
      revision: Rev,
      rating: z.number().int().min(1).max(5),
      text: Text(2000).optional(),
    }),
    response: Ticket,
  },
  'POST support/tickets/:id/email-token': {
    schema: z.strictObject({ revision: Rev }),
    response: z.object({
      token: z.string(),
      expiresAt: Time,
      activation: z.literal('DISABLED'),
    }),
  },
  'POST support/tickets/:id/evidence': {
    schema: P4Attachment,
    response: Evidence,
  },
  'GET support/tickets/:id/evidence': {
    schema: z.strictObject({ evidenceId: Id }),
    response: z.string(),
  },
  'POST moderation/reports': {
    schema: z.strictObject({
      kind: z.enum([
        'ACCOUNT',
        'WORKSPACE',
        'BEHAVIOR',
        'TASK',
        'NOTE',
        'MESSAGE',
      ]),
      targetId: Id,
      spaceId: Id.optional(),
      category: Text(80),
      description: Text(20000),
    }),
    response: Case,
  },
  'GET moderation/reports': { schema: P4Page, response: page(Case) },
  'GET moderation/reports/:id': { schema: Empty, response: CaseDetail },
  'POST moderation/reports/:id/appeal': {
    schema: z.strictObject({ revision: Rev, text: Text(10000) }),
    response: Case,
  },
  'POST moderation/reports/:id/evidence': {
    schema: P4Attachment,
    response: Evidence,
  },
  'GET moderation/reports/:id/evidence': {
    schema: z.strictObject({ evidenceId: Id }),
    response: z.string(),
  },
  'GET communications/inbox': { schema: P4Page, response: page(Delivery) },
  'POST communications/inbox/:id/read': {
    schema: Empty,
    response: z.object({ id: Id, readAt: Time }),
  },
  'GET support/notices': {
    schema: P4Page,
    response: page(
      z.object({
        id: Id,
        kind: z.string(),
        ticketId: Id.nullable(),
        caseId: Id.nullable(),
        readAt: Time.nullable(),
        createdAt: Time,
      }),
    ),
  },
  'POST support/notices/:id/read': {
    schema: Empty,
    response: z.object({ id: Id, readAt: Time }),
  },
} as const;
