import { z } from 'zod';
import { adminCommerceRoutes } from './admin-commerce.js';

export const AnalyticsCatalog = {
  'task.created': {
    version: 1,
    category: 'PRODUCT',
    meaningful: true,
    feature: 'tasks',
  },
  'task.completed': {
    version: 1,
    category: 'PRODUCT',
    meaningful: true,
    feature: 'tasks',
  },
  'habit.entry_recorded': {
    version: 1,
    category: 'PRODUCT',
    meaningful: true,
    feature: 'habits',
  },
  'goal.progress_changed': {
    version: 1,
    category: 'PRODUCT',
    meaningful: true,
    feature: 'goals',
  },
  'capture.triaged': {
    version: 1,
    category: 'PRODUCT',
    meaningful: true,
    feature: 'capture',
  },
  'time_block.changed': {
    version: 1,
    category: 'PRODUCT',
    meaningful: true,
    feature: 'calendar',
  },
  'finance.transaction_posted': {
    version: 1,
    category: 'PRODUCT',
    meaningful: true,
    feature: 'finance',
  },
  'navigation.viewed': {
    version: 1,
    category: 'NAVIGATION',
    meaningful: false,
    feature: 'navigation',
  },
} as const;
export const AnalyticsEventNameSchema = z.enum(
  Object.keys(AnalyticsCatalog) as [
    keyof typeof AnalyticsCatalog,
    ...(keyof typeof AnalyticsCatalog)[],
  ],
);
export const AnalyticsPolicySchema = z.strictObject({
  revision: z.number().int().positive(),
  product: z.boolean(),
  navigation: z.boolean(),
  rawDays: z.number().int().min(30).max(365),
  aggregateDays: z.number().int().min(30).max(3650),
  minimumCohort: z.number().int().min(5).max(100),
});
export const AnalyticsFilterSchema = z
  .strictObject({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    workspaceType: z.enum(['PERSONAL', 'TEAM', 'COMPANY', 'OTHER']).optional(),
    feature: z
      .enum([
        'tasks',
        'habits',
        'goals',
        'capture',
        'calendar',
        'finance',
        'navigation',
      ])
      .optional(),
    planId: z.uuid().optional(),
    registeredFrom: z.iso.datetime().optional(),
    registeredTo: z.iso.datetime().optional(),
    firstFeature: z
      .enum(['tasks', 'habits', 'goals', 'capture', 'calendar', 'finance'])
      .optional(),
    flagId: z.uuid().optional(),
    flagValue: z.boolean().optional(),
  })
  .refine(
    (v) =>
      Date.parse(v.to) > Date.parse(v.from) &&
      Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000,
    'Invalid bounded UTC range',
  );
export type AnalyticsFilter = z.infer<typeof AnalyticsFilterSchema>;
export const AnalyticsDefinitionInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['FUNNEL', 'KPI', 'COHORT']),
  events: z.array(AnalyticsEventNameSchema).min(1).max(8),
  formula: z.enum(['COUNT', 'UNIQUE_USERS', 'RATIO', 'PER_ACTIVE_USER']),
  windowDays: z.number().int().min(1).max(90),
});
export const AnalyticsReportInputSchema = z.strictObject({
  type: z.enum(['PRODUCT', 'FINANCIAL']).default('PRODUCT'),
  filter: AnalyticsFilterSchema,
  format: z.enum(['CSV', 'JSON']),
  intervalHours: z.number().int().min(1).max(8760).nullable(),
});
const metric = z.strictObject({
  key: z.string(),
  value: z.number().finite().nullable(),
  denominator: z.number().int().nonnegative().nullable(),
  suppressed: z.boolean(),
});
export const AnalyticsResultSchema = z.strictObject({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  refreshedAt: z.iso.datetime(),
  lastAggregatedAt: z.iso.datetime().nullable(),
  coverageFrom: z.iso.datetime().nullable(),
  minimumCohort: z.number().int(),
  warnings: z.array(
    z.enum([
      'RAW_COVERAGE_PARTIAL',
      'CURRENT_FLAG_MEMBERSHIP',
      'CURRENT_PLAN_MEMBERSHIP',
    ]),
  ),
  metrics: z.array(metric),
  trends: z.array(
    z.strictObject({
      date: z.string(),
      activeUsers: z.number().int().nullable(),
      events: z.number().int().nullable(),
      suppressed: z.boolean(),
    }),
  ),
  features: z.array(
    z.strictObject({
      feature: z.string(),
      users: z.number().int().nullable(),
      events: z.number().int().nullable(),
      suppressed: z.boolean(),
    }),
  ),
  definitions: z.array(
    z.strictObject({ id: z.uuid(), kind: z.string(), values: z.array(metric) }),
  ),
});
export const AnalyticsDefinitionViewSchema =
  AnalyticsDefinitionInputSchema.extend({
    id: z.uuid(),
    revision: z.number().int(),
  });
export const AnalyticsReportViewSchema = z.strictObject({
  type: z.enum(['PRODUCT', 'FINANCIAL']),
  id: z.uuid(),
  state: z.enum(['PENDING', 'READY', 'DENIED']),
  nextAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime(),
  format: z.enum(['CSV', 'JSON']),
  intervalHours: z.number().int().nullable(),
});
const reason = z.string().trim().min(3).max(500);
const empty = z.strictObject({});
export const AnalyticsPolicyPreviewSchema = z.strictObject({
  previewId: z.uuid(),
  policy: AnalyticsPolicySchema,
  rawEligible: z.number().int(),
  aggregateEligible: z.number().int(),
  reportsInvalidated: z.number().int(),
  expiresAt: z.iso.datetime(),
});
export const adminAnalyticsRoutes = {
  'POST analytics/financial': {
    permission: 'admin.analytics.financial.read',
    schema: z.strictObject({ from: z.iso.datetime(), to: z.iso.datetime() }),
    response: z.strictObject({
      suppressed: z.boolean(),
      report: adminCommerceRoutes['GET commerce/reports'].response.nullable(),
      prices: z.array(
        z.strictObject({
          priceId: z.uuid(),
          productId: z.uuid(),
          kind: z.enum(['PLAN', 'ADDON']),
          currency: z.string().length(3),
          collected: z.string().regex(/^\d+$/),
          payingCustomers: z.number().int().nonnegative(),
        }),
      ),
      economics: z.array(
        z.strictObject({
          currency: z.string(),
          paidAtStart: z.number().int().nullable(),
          churned: z.number().int().nullable(),
          churnRate: z.number().nullable(),
          freeToPaid: z.number().int().nullable(),
          conversionDenominator: z.number().int().nullable(),
          suppressed: z.boolean(),
        }),
      ),
    }),
  },
  'GET analytics/catalog': {
    permission: 'admin.analytics.product.read',
    schema: empty,
    response: z.strictObject({
      events: z.array(
        z.strictObject({
          name: AnalyticsEventNameSchema,
          version: z.literal(1),
          category: z.enum(['PRODUCT', 'NAVIGATION']),
          meaningful: z.boolean(),
          feature: z.string(),
        }),
      ),
    }),
  },
  'GET analytics/policy': {
    permission: 'admin.analytics.sensitive.read',
    schema: empty,
    response: AnalyticsPolicySchema,
  },
  'POST analytics/policy': {
    permission: 'admin.analytics.configure',
    schema: AnalyticsPolicySchema.extend({
      reason,
      previewId: z.uuid().optional(),
    }),
    response: AnalyticsPolicySchema,
  },
  'POST analytics/policy/preview': {
    permission: 'admin.analytics.configure',
    schema: AnalyticsPolicySchema.extend({ reason }),
    response: AnalyticsPolicyPreviewSchema,
  },
  'POST analytics/query': {
    permission: 'admin.analytics.product.read',
    schema: z.strictObject({ filter: AnalyticsFilterSchema }),
    response: AnalyticsResultSchema,
  },
  'POST analytics/compare': {
    permission: 'admin.analytics.product.read',
    schema: z.strictObject({
      current: AnalyticsFilterSchema,
      previous: AnalyticsFilterSchema,
    }),
    response: z.strictObject({
      current: AnalyticsResultSchema,
      previous: AnalyticsResultSchema,
    }),
  },
  'GET analytics/definitions': {
    permission: 'admin.analytics.product.read',
    schema: empty,
    response: z.strictObject({ items: z.array(AnalyticsDefinitionViewSchema) }),
  },
  'POST analytics/definitions': {
    permission: 'admin.analytics.configure',
    schema: AnalyticsDefinitionInputSchema.extend({ reason }),
    response: AnalyticsDefinitionViewSchema,
  },
  'POST analytics/reports': {
    permission: 'admin.analytics.export',
    schema: AnalyticsReportInputSchema.extend({ reason }),
    response: AnalyticsReportViewSchema,
  },
  'GET analytics/reports': {
    permission: 'admin.analytics.export',
    schema: empty,
    response: z.strictObject({ items: z.array(AnalyticsReportViewSchema) }),
  },
  'GET analytics/reports/:id': {
    permission: 'admin.analytics.export',
    schema: empty,
    response: AnalyticsReportViewSchema.extend({
      content: z.string().max(2000000).nullable(),
    }),
  },
  'POST analytics/reports/:id/cancel': {
    permission: 'admin.analytics.export',
    schema: z.strictObject({ reason }),
    response: AnalyticsReportViewSchema,
  },
} as const;
export const AnalyticsNavigationSchema = z.strictObject({
  eventId: z.uuid(),
  page: z.enum([
    'overview',
    'tasks',
    'calendar',
    'habits',
    'goals',
    'finance',
    'capture',
  ]),
  workspaceId: z.uuid().optional(),
});
