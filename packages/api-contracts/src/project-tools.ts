import { z } from 'zod';
import { ProjectPageQuerySchema, SharedTaskSchema } from './projects.js';
import { FinanceCurrencySchema } from './finance.js';
import { SharedTaskScheduleInputSchema } from './work.js';
const id = z.uuid(),
  rev = z.number().int().positive().max(2147483646),
  name = z.string().trim().min(1).max(100);
export const WorkflowStateInputSchema = z.strictObject({
  id,
  label: name,
  status: SharedTaskSchema.shape.status,
});
export const WorkflowApproverInputSchema = z.strictObject({
  accessId: id,
  generation: rev,
});
export const WorkflowEdgeInputSchema = z
  .strictObject({
    id,
    fromStateId: id,
    toStateId: id,
    requiresApproval: z.boolean(),
    approvers: z.array(WorkflowApproverInputSchema).max(20),
  })
  .refine((v) => v.requiresApproval === Boolean(v.approvers.length));
export const WorkflowVersionInputSchema = z.strictObject({
  name,
  states: z.array(WorkflowStateInputSchema).min(1).max(32),
  edges: z.array(WorkflowEdgeInputSchema).max(128),
});
export const WorkflowCreateSchema = WorkflowVersionInputSchema.extend({ id });
export const WorkflowSchema = z.strictObject({
  id,
  spaceId: id,
  scopeId: id,
  name,
  currentVersion: rev,
  revision: rev,
});
export const WorkflowVersionSchema = WorkflowVersionInputSchema.extend({
  workflowId: id,
  version: rev,
  publishedByActorId: id,
  createdAt: z.iso.datetime(),
});
export const WorkflowBindSchema = z.strictObject({
  workflowId: id,
  version: rev,
  stateId: id,
});
export const WorkflowBindingSchema = WorkflowBindSchema.extend({
  taskId: id,
  revision: rev,
  sourceRevision: rev,
});
export const WorkflowBindingViewSchema = z.strictObject({
  taskId: id,
  sourceRevision: rev,
  binding: WorkflowBindingSchema.nullable(),
});
export const WorkflowTransitionSchema = z.strictObject({ edgeId: id });
export const WorkflowApprovalSchema = z.strictObject({
  id,
  spaceId: id,
  scopeId: id,
  taskId: id,
  workflowId: id,
  version: rev,
  edgeId: id,
  requesterAccessId: id,
  requesterGeneration: rev,
  requestedByActorId: id,
  sourceRevision: rev,
  state: z.enum(['REQUESTED', 'APPROVED', 'REJECTED', 'EXPIRED']),
  revision: rev,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  decidedByActorId: id.nullable(),
});
export const WorkflowTransitionResultSchema = z.strictObject({
  task: SharedTaskSchema,
  binding: WorkflowBindingSchema,
  approval: WorkflowApprovalSchema.nullable(),
});
export const CustomFieldKindSchema = z.enum([
  'TEXT',
  'NUMBER',
  'DATE',
  'BOOLEAN',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'PERSON',
  'CURRENCY',
]);
const decimal = z.string().regex(/^-?(?:0|[1-9]\d{0,23})(?:\.\d{1,6})?$/);
export const CustomFieldValueSchema = z.union([
  z.string().max(2000),
  z.boolean(),
  z.array(id).max(20),
  z.strictObject({ accessId: id, generation: rev }),
  z.strictObject({ currency: FinanceCurrencySchema, amount: decimal }),
  z.null(),
]);
export const CustomFieldVersionInputSchema = z.strictObject({
  name,
  kind: CustomFieldKindSchema,
  limits: z
    .strictObject({
      maxLength: z.number().int().min(1).max(2000).optional(),
      minimum: decimal.optional(),
      maximum: decimal.optional(),
    })
    .default({}),
  options: z
    .array(z.strictObject({ id, label: name }))
    .max(100)
    .optional(),
  defaultValue: CustomFieldValueSchema.optional(),
});
export const CustomFieldCreateSchema = CustomFieldVersionInputSchema.extend({
  id,
});
export const CustomFieldSchema = z.strictObject({
  id,
  spaceId: id,
  scopeId: id,
  name,
  kind: CustomFieldKindSchema,
  currentVersion: rev,
  revision: rev,
  deprecatedAt: z.iso.datetime().nullable(),
});
export const CustomFieldVersionSchema = CustomFieldVersionInputSchema.extend({
  fieldId: id,
  version: rev,
  publishedByActorId: id,
  createdAt: z.iso.datetime(),
});
export const CustomFieldSetSchema = z
  .strictObject({
    version: rev,
    value: CustomFieldValueSchema.optional(),
    useDefault: z.literal(true).optional(),
  })
  .refine((v) => (v.value !== undefined) !== (v.useDefault === true));
export const CustomFieldEntrySchema = z.strictObject({
  fieldId: id,
  version: rev,
  kind: CustomFieldKindSchema,
  value: CustomFieldValueSchema,
  revision: rev,
});
export const CustomFieldValuesSchema = z.strictObject({
  taskId: id,
  sourceRevision: rev,
  items: z.array(CustomFieldEntrySchema).max(100),
});
export const CustomFieldSearchSchema = ProjectPageQuerySchema.extend({
  fieldId: id,
  version: rev,
  operator: z.enum(['EQ', 'GT', 'GTE', 'LT', 'LTE', 'HAS']),
  value: CustomFieldValueSchema,
});
export const DependencyInputSchema = z
  .strictObject({
    id,
    predecessorId: id,
    successorId: id,
    kind: z.enum(['FS', 'SS', 'FF', 'SF']),
    lagMinutes: z.number().int().min(-525600).max(525600),
  })
  .refine((v) => v.predecessorId !== v.successorId);
export const DependencyPatchSchema = z.strictObject({
  lagMinutes: DependencyInputSchema.shape.lagMinutes,
});
export const DependencySchema = DependencyInputSchema.extend({
  spaceId: id,
  scopeId: id,
  revision: rev,
  retiredAt: z.iso.datetime().nullable(),
});
export const DependencyGraphSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  edges: z.array(DependencySchema).max(5000),
});
export const ReschedulePreviewInputSchema = z.strictObject({
  id,
  taskId: id,
  sourceRevision: rev,
  schedule: SharedTaskScheduleInputSchema,
});
export const RescheduleApplySchema = z.strictObject({
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const RescheduleItemSchema = z.strictObject({
  taskId: id,
  sourceRevision: rev,
  changed: z.boolean(),
  plannedStartAt: z.iso.datetime().nullable(),
  dueAt: z.iso.datetime().nullable(),
  scheduledDate: z.iso.date().nullable(),
});
export const ReschedulePreviewSchema = z.strictObject({
  id,
  spaceId: id,
  scopeId: id,
  state: z.enum(['PREVIEWED', 'APPLIED']),
  revision: rev,
  graphRevision: z.number().int().nonnegative(),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime(),
  appliedAt: z.iso.datetime().nullable(),
  items: z.array(RescheduleItemSchema).max(1000),
});
export const TaskMetadataEventSchema = z.strictObject({
  id,
  taskId: id,
  actorId: id,
  action: z.string().max(40),
  sourceRevision: rev,
  beforeValue: z.unknown().nullable(),
  afterValue: z.unknown().nullable(),
  createdAt: z.iso.datetime(),
});
const cursor = ProjectPageQuerySchema.shape.after.unwrap().nullable();
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item).max(100), nextCursor: cursor });
export const WorkflowPageSchema = page(WorkflowSchema),
  WorkflowApprovalPageSchema = page(WorkflowApprovalSchema),
  CustomFieldPageSchema = page(CustomFieldSchema),
  TaskMetadataEventPageSchema = page(TaskMetadataEventSchema),
  ToolTaskPageSchema = page(SharedTaskSchema);
export const ToolResultSchema = z.strictObject({ id, revision: rev });
export const ToolVersionQuerySchema = z.strictObject({
  version: z.coerce.number().int().positive().max(2147483646),
});
