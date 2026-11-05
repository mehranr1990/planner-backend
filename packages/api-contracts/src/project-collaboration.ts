import { z } from 'zod';
export const ProjectFileReconcileSchema = z.strictObject({
  cleaned: z.number().int().min(0).max(25),
});
import {
  ProjectPageQuerySchema,
  SharedTaskSchema,
  ResourceTargetSchema,
  GrantOfferCreateSchema,
} from './projects.js';
import { SharedGoalSchema } from './projects.js';
import { FileUploadSchema } from './files.js';
import { SharedTaskScheduleSchema } from './work.js';
import { CalendarZoneSchema } from './calendar.js';
import {
  WorkflowBindingViewSchema,
  CustomFieldValuesSchema,
  DependencySchema,
} from './project-tools.js';
const id = z.uuid(),
  revision = z.number().int().positive().max(2147483646);
const plain = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => !v.includes('\0'));
export const ProjectContentTargetSchema = z.strictObject({
  kind: z.enum(['PROJECT', 'TASK', 'GOAL', 'DOCUMENT']),
  id,
});
export const ProjectContentQuerySchema = ProjectPageQuerySchema.extend({
  targetKind: ProjectContentTargetSchema.shape.kind,
  targetId: id,
});
export const ProjectDocumentInputSchema = z.strictObject({
  title: plain(300).trim().min(1),
  body: plain(100000),
});
export const ProjectDocumentCreateSchema = ProjectDocumentInputSchema.extend({
  id,
});
export const ProjectDocumentSchema = ProjectDocumentCreateSchema.extend({
  projectId: id,
  revision,
  createdByActorId: id,
  createdAt: z.iso.datetime(),
  retiredAt: z.iso.datetime().nullable(),
});
export const ProjectDocumentVersionSchema = ProjectDocumentInputSchema.extend({
  documentId: id,
  version: revision,
  actorId: id,
  createdAt: z.iso.datetime(),
});
export const ProjectCommentInputSchema = z.strictObject({
  body: plain(10000).trim().min(1),
});
export const ProjectCommentCreateSchema = ProjectCommentInputSchema.extend({
  id,
  target: ProjectContentTargetSchema,
});
export const ProjectCommentSchema = ProjectCommentCreateSchema.extend({
  body: plain(10000),
  projectId: id,
  revision,
  createdByActorId: id,
  createdAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});
export const ProjectCommentVersionSchema = z.strictObject({
  commentId: id,
  revision,
  body: plain(10000).nullable(),
  actorId: id,
  createdAt: z.iso.datetime(),
});
export const ProjectActivitySchema = z.strictObject({
  id,
  projectId: id,
  target: ProjectContentTargetSchema,
  actorId: id,
  action: z.string().regex(/^[a-z.]{1,80}$/),
  resourceId: id,
  createdAt: z.iso.datetime(),
});
export const ProjectFileCreateSchema = FileUploadSchema.extend({
  id,
  target: ProjectContentTargetSchema,
});
export const ProjectFileSchema = z.strictObject({
  id,
  projectId: id,
  target: ProjectContentTargetSchema,
  filename: FileUploadSchema.shape.filename,
  mimeType: FileUploadSchema.shape.mimeType,
  expectedSize: z.number().int().positive(),
  actualSize: z.number().int().positive().nullable(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  status: z.enum(['INITIATED', 'READY', 'REJECTED', 'DELETED']),
  revision,
  createdAt: z.iso.datetime(),
  uploadExpiresAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export const ProjectViewQuerySchema = ProjectPageQuerySchema.extend({
  kind: z.enum([
    'LIST',
    'KANBAN',
    'CALENDAR',
    'TIMELINE',
    'GANTT',
    'DASHBOARD',
  ]),
  taskId: id.optional(),
  status: SharedTaskSchema.shape.status.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  timezone: CalendarZoneSchema.optional(),
}).refine((v) => {
  const count = [v.from, v.to, v.timezone].filter(Boolean).length;
  return (
    (count === 0 && ['LIST', 'KANBAN', 'DASHBOARD'].includes(v.kind)) ||
    (count === 3 &&
      Date.parse(v.to!) > Date.parse(v.from!) &&
      Date.parse(v.to!) - Date.parse(v.from!) <= 93 * 86400000)
  );
});
export const ProjectViewEntrySchema = z.strictObject({
  id,
  task: SharedTaskSchema,
  schedule: SharedTaskScheduleSchema,
  estimatedMinutes: z.number().int().min(0).max(10080).nullable(),
  workflow: WorkflowBindingViewSchema,
  fields: CustomFieldValuesSchema,
});
const cursor = ProjectPageQuerySchema.shape.after.unwrap().nullable();
const page = (item: z.ZodType) =>
  z.strictObject({ items: z.array(item), nextCursor: cursor });
export const ProjectDocumentPageSchema = page(ProjectDocumentSchema);
export const ProjectDocumentVersionPageSchema = page(
  ProjectDocumentVersionSchema,
);
export const ProjectCommentPageSchema = page(ProjectCommentSchema);
export const ProjectCommentVersionPageSchema = page(
  ProjectCommentVersionSchema,
);
export const ProjectFilePageSchema = page(ProjectFileSchema);
export const ProjectActivityPageSchema = page(ProjectActivitySchema);
export const ProjectViewSchema = z.strictObject({
  kind: ProjectViewQuerySchema.shape.kind,
  items: z.array(ProjectViewEntrySchema),
  nextCursor: cursor,
  dependencies: z.array(DependencySchema),
  totals: z
    .strictObject({
      visibleTasks: z.number().int().nonnegative(),
      byStatus: z.record(
        SharedTaskSchema.shape.status,
        z.number().int().nonnegative(),
      ),
    })
    .nullable(),
});
export const ProjectContentGrantCreateSchema = z
  .strictObject({
    id,
    recipientUserId: id,
    target: ResourceTargetSchema,
    capabilities: z
      .array(z.enum(['read', 'comment', 'update', 'complete', 'file.read']))
      .min(1)
      .max(5),
    grantExpiresAt: GrantOfferCreateSchema.shape.grantExpiresAt,
  })
  .refine(
    (v) =>
      new Set(v.capabilities).size === v.capabilities.length &&
      v.capabilities.includes('read') &&
      (v.target.kind === 'TASK' || !v.capabilities.includes('complete')) &&
      (v.target.kind !== 'PROJECT' ||
        v.capabilities.every((c) =>
          ['read', 'comment', 'file.read'].includes(c),
        )),
  );
export const ProjectExportInputSchema = z.strictObject({
  format: z.enum(['JSON', 'CSV']),
});
export const ProjectExportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: id,
  generatedAt: z.iso.datetime(),
  tasks: z.array(
    z.strictObject({
      task: SharedTaskSchema,
      schedule: SharedTaskScheduleSchema,
    }),
  ),
  goals: z.array(SharedGoalSchema),
  documents: z.array(ProjectDocumentSchema),
  comments: z.array(ProjectCommentSchema),
  files: z.array(ProjectFileSchema),
});
