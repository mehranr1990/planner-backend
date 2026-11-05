import { z } from 'zod';
import {
  ProjectPageQuerySchema,
  ProjectTaskCreateSchema,
  ProjectTaskPatchSchema,
  ProjectComponentCreateSchema,
  SharedTaskSchema,
} from './projects.js';
import { SharedTaskScheduleInputSchema } from './work.js';
import { CalendarZoneSchema } from './calendar.js';
const id = z.uuid(),
  revision = z.number().int().positive().max(2147483646),
  text = z
    .string()
    .trim()
    .min(1)
    .max(300)
    .refine((v) => !v.includes('\0')),
  body = z
    .string()
    .max(10000)
    .refine((v) => !v.includes('\0')),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
const member = z.strictObject({ accessId: id, generation: revision });
export const ProjectRegisterInputSchema = z
  .strictObject({
    kind: z.enum(['RISK', 'ISSUE']),
    title: text,
    description: body,
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    probability: z.number().int().min(0).max(100).nullable(),
    owner: member.nullable(),
    mitigation: body,
    status: z.enum(['OPEN', 'MITIGATING', 'RESOLVED', 'CLOSED']),
  })
  .refine((v) =>
    v.kind === 'RISK' ? v.probability !== null : v.probability === null,
  );
export const ProjectRegisterCreateSchema =
  ProjectRegisterInputSchema.safeExtend({ id });
export const ProjectRegisterSchema = ProjectRegisterCreateSchema.safeExtend({
  projectId: id,
  revision,
  createdByActorId: id,
  createdAt: z.iso.datetime(),
  retiredAt: z.iso.datetime().nullable(),
});
export const ProjectRegisterQuerySchema = ProjectPageQuerySchema.safeExtend({
  kind: z.enum(['RISK', 'ISSUE']).optional(),
  status: ProjectRegisterInputSchema.shape.status.optional(),
});
export const ProjectRegisterEventSchema = z.strictObject({
  id,
  itemId: id,
  actorId: id,
  revision,
  before: z.unknown().nullable(),
  after: z.unknown(),
  createdAt: z.iso.datetime(),
});
export const SharedEstimateSchema = z.strictObject({
  taskId: id,
  sourceRevision: revision,
  estimatedMinutes: z.number().int().min(0).max(10080).nullable(),
});
export const SharedEstimateInputSchema = SharedEstimateSchema.pick({
  estimatedMinutes: true,
});
const instant = z.iso
  .datetime()
  .refine((v) => new Date(v).getUTCMilliseconds() === 0);
export const SharedWorkLogInputSchema = z
  .strictObject({ startedAt: instant, endedAt: instant })
  .refine(
    (v) =>
      Date.parse(v.endedAt) > Date.parse(v.startedAt) &&
      Date.parse(v.endedAt) - Date.parse(v.startedAt) <= 86400000,
  );
export const SharedWorkLogCreateSchema = SharedWorkLogInputSchema.safeExtend({
  id,
});
export const SharedWorkLogSchema = SharedWorkLogCreateSchema.safeExtend({
  taskId: id,
  actorId: id,
  accessId: id,
  generation: revision,
  revision,
  createdAt: z.iso.datetime(),
  voidedAt: z.iso.datetime().nullable(),
});
export const ProjectTaskMetricSchema = SharedEstimateSchema.safeExtend({
  status: SharedTaskSchema.shape.status,
  plannedStartAt: z.iso.datetime().nullable(),
  dueAt: z.iso.datetime().nullable(),
  scheduledDate: z.iso.date().nullable(),
  completedAt: z.iso.datetime().nullable(),
});
const optionalEstimate =
  SharedEstimateInputSchema.shape.estimatedMinutes.optional();
export const ProjectCreateTaskOperationSchema = z.strictObject({
  kind: z.literal('CREATE_TASK'),
  task: ProjectTaskCreateSchema,
  estimatedMinutes: optionalEstimate,
  schedule: SharedTaskScheduleInputSchema.optional(),
});
export const ProjectUpdateTaskOperationSchema = z
  .strictObject({
    kind: z.literal('UPDATE_TASK'),
    taskId: id,
    sourceRevision: revision,
    patch: ProjectTaskPatchSchema.optional(),
    estimatedMinutes: optionalEstimate,
    schedule: SharedTaskScheduleInputSchema.optional(),
  })
  .refine(
    (v) =>
      v.patch !== undefined ||
      v.estimatedMinutes !== undefined ||
      v.schedule !== undefined,
  );
export const ProjectComponentOperationSchema = z.strictObject({
  kind: z.enum(['CREATE_PHASE', 'CREATE_SECTION', 'CREATE_MILESTONE']),
  component: ProjectComponentCreateSchema,
});
export const ProjectDependencyOperationSchema = z.strictObject({
  kind: z.literal('CREATE_DEPENDENCY'),
  id,
  predecessorId: id,
  successorId: id,
  dependencyKind: z.enum(['FS', 'SS', 'FF', 'SF']),
  lagMinutes: z.number().int().min(-525600).max(525600),
});
export const ProjectChangeOperationSchema = z.discriminatedUnion('kind', [
  ProjectCreateTaskOperationSchema,
  ProjectUpdateTaskOperationSchema,
  ProjectComponentOperationSchema,
  ProjectDependencyOperationSchema,
]);
export const ProjectBulkPreviewSchema = z.strictObject({
  id,
  operations: z
    .array(
      z.discriminatedUnion('kind', [
        ProjectCreateTaskOperationSchema,
        ProjectUpdateTaskOperationSchema,
      ]),
    )
    .min(1)
    .max(100),
});
export const ProjectChangePlanSchema = z.strictObject({
  id,
  projectId: id,
  kind: z.enum(['BULK', 'CSV', 'TEMPLATE']),
  state: z.enum(['PREVIEWED', 'APPLIED']),
  revision,
  manifestHash: hash,
  expiresAt: z.iso.datetime(),
  appliedAt: z.iso.datetime().nullable(),
  operations: z.array(ProjectChangeOperationSchema).max(200),
  sources: z
    .array(
      z.strictObject({
        taskId: id,
        sourceRevision: revision,
        kind: z.enum(['EXISTING', 'CREATED']),
      }),
    )
    .max(100),
});
export const ProjectChangeApplySchema = z.strictObject({ manifestHash: hash });
export const ProjectCsvPreviewSchema = z.strictObject({
  id,
  csv: z.string().min(1).max(262144),
});
export const ProjectCsvErrorSchema = z.strictObject({
  row: z.number().int().nonnegative(),
  column: z.string().max(40),
  code: z.enum([
    'SIZE',
    'ROWS',
    'CSV_SYNTAX',
    'HEADERS',
    'REQUIRED',
    'VALUE',
    'FORMULA',
  ]),
});
export const ProjectCsvResultSchema = z.strictObject({
  valid: z.boolean(),
  errors: z.array(ProjectCsvErrorSchema).max(100),
  plan: ProjectChangePlanSchema.nullable(),
});
const templateTask = z.strictObject({
  key: id,
  title: text,
  description: body.nullable(),
  priority: ProjectTaskCreateSchema.shape.priority,
  estimatedMinutes: SharedEstimateInputSchema.shape.estimatedMinutes,
  sectionKey: id.nullable(),
  milestoneKey: id.nullable(),
});
const component = z.strictObject({
    key: id,
    title: text,
    position: z.number().int().min(0).max(1000000),
  }),
  childComponent = component.safeExtend({ phaseKey: id.nullable() });
export const ProjectTemplateDefinitionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    phases: z.array(component).max(20),
    sections: z.array(childComponent).max(30),
    milestones: z
      .array(childComponent.safeExtend({ targetDate: z.iso.date().nullable() }))
      .max(20),
    tasks: z.array(templateTask).min(1).max(100),
    dependencies: z
      .array(
        z.strictObject({
          predecessorKey: id,
          successorKey: id,
          kind: z.enum(['FS', 'SS', 'FF', 'SF']),
          lagMinutes: z.number().int().min(-525600).max(525600),
        }),
      )
      .max(30),
  })
  .refine(
    (v) =>
      v.phases.length +
        v.sections.length +
        v.milestones.length +
        v.tasks.length +
        v.dependencies.length <=
      200,
  );
export const ProjectTemplateVersionInputSchema = z.strictObject({
  name: text,
  definition: ProjectTemplateDefinitionSchema,
});
export const ProjectTemplateCreateSchema =
  ProjectTemplateVersionInputSchema.safeExtend({ id });
export const ProjectTemplateSchema = z.strictObject({
  id,
  projectId: id,
  name: text,
  currentVersion: revision,
  revision,
  deprecatedAt: z.iso.datetime().nullable(),
});
export const ProjectTemplateVersionSchema =
  ProjectTemplateVersionInputSchema.safeExtend({
    templateId: id,
    version: revision,
    publishedByActorId: id,
    createdAt: z.iso.datetime(),
  });
export const ProjectTemplatePreviewSchema = z.strictObject({
  id,
  version: revision,
});
const date = z.iso.date();
export const ProjectCapacityInputSchema = z.strictObject({
  member,
  date,
  timezone: CalendarZoneSchema,
  availableMinutes: z.number().int().min(0).max(1440).nullable(),
});
export const ProjectCapacityCreateSchema =
  ProjectCapacityInputSchema.safeExtend({ id });
export const ProjectCapacitySchema = ProjectCapacityCreateSchema.safeExtend({
  projectId: id,
  revision,
});
export const ProjectAllocationInputSchema = z.strictObject({
  assignmentId: id,
  date,
  timezone: CalendarZoneSchema,
  plannedMinutes: z.number().int().min(0).max(1440),
});
export const ProjectAllocationCreateSchema =
  ProjectAllocationInputSchema.safeExtend({ id });
export const ProjectAllocationSchema = ProjectAllocationCreateSchema.safeExtend(
  { projectId: id, taskId: id, member, revision },
);
export const ProjectWorkloadQuerySchema = z
  .strictObject({ fromDate: date, toDate: date, timezone: CalendarZoneSchema })
  .refine(
    (v) =>
      Date.parse(v.toDate) > Date.parse(v.fromDate) &&
      Date.parse(v.toDate) - Date.parse(v.fromDate) <= 93 * 86400000,
  );
export const ProjectWorkloadRowSchema = z.strictObject({
  member,
  date,
  capacityMinutes: z.number().int().nonnegative().nullable(),
  allocatedMinutes: z.number().int().nonnegative(),
  overbookedMinutes: z.number().int().nonnegative().nullable(),
  taskCount: z.number().int().nonnegative(),
  estimatedMinutes: z.number().int().nonnegative(),
  unknownEstimates: z.number().int().nonnegative(),
});
export const ProjectWorkloadSchema = z.strictObject({
  projectId: id,
  fromDate: date,
  toDate: date,
  timezone: CalendarZoneSchema,
  basis: z.literal('EXPLICIT_ACCEPTED_ASSIGNMENT_ALLOCATIONS'),
  rows: z.array(ProjectWorkloadRowSchema).max(10000),
});
export const ProjectWorkRecordsQuerySchema =
  ProjectWorkloadQuerySchema.safeExtend(ProjectPageQuerySchema.shape);
export const ProjectReportWindowSchema = z
  .strictObject({ fromAt: z.iso.datetime(), toAt: z.iso.datetime() })
  .refine(
    (v) =>
      Date.parse(v.toAt) > Date.parse(v.fromAt) &&
      Date.parse(v.toAt) - Date.parse(v.fromAt) <= 93 * 86400000,
  );
export const ProjectReportCreateSchema = ProjectReportWindowSchema.safeExtend({
  id,
});
export const ProjectReportSchema = ProjectReportWindowSchema.safeExtend({
  projectId: id,
  asOf: z.iso.datetime(),
  basis: z.literal('CURRENT_VISIBLE_TASKS_AND_EXPLICIT_SHARED_WORK'),
  taskCount: z.number().int().nonnegative(),
  statusCounts: z.strictObject({
    OPEN: z.number().int().nonnegative(),
    IN_PROGRESS: z.number().int().nonnegative(),
    DONE: z.number().int().nonnegative(),
    CANCELED: z.number().int().nonnegative(),
  }),
  completedInWindow: z.number().int().nonnegative(),
  overdueTaskCount: z.number().int().nonnegative(),
  estimatedMinutes: z.number().int().nonnegative(),
  unknownEstimates: z.number().int().nonnegative(),
  recordedSeconds: z.number().int().nonnegative(),
  workLogCount: z.number().int().nonnegative(),
  openRiskCount: z.number().int().nonnegative(),
  openIssueCount: z.number().int().nonnegative(),
});
export const ProjectReportSnapshotSchema = z.strictObject({
  id,
  projectId: id,
  createdByActorId: id,
  createdAt: z.iso.datetime(),
  report: ProjectReportSchema,
});
const cursor = ProjectPageQuerySchema.shape.after.unwrap().nullable();
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item).max(100), nextCursor: cursor });
export const ProjectRegisterPageSchema = page(ProjectRegisterSchema),
  ProjectRegisterEventPageSchema = page(ProjectRegisterEventSchema),
  ProjectTemplatePageSchema = page(ProjectTemplateSchema),
  SharedWorkLogPageSchema = page(SharedWorkLogSchema);
export const ProjectCapacityPageSchema = page(ProjectCapacitySchema),
  ProjectAllocationPageSchema = page(ProjectAllocationSchema);
