import { z } from 'zod';
import { ProjectPageQuerySchema } from './projects.js';
import {
  TeamChecklistSchema,
  TeamChecklistChangeSchema,
} from './team-files.js';
import { WorkflowVersionInputSchema } from './project-tools.js';
import { InvitationSchema, SharedOfferStateSchema } from './collaboration.js';
import { FileUploadSchema, FileMimeSchema } from './files.js';
import { TaskAssignmentSchema } from './work.js';
export const ProjectChecklistSchema = TeamChecklistSchema;
export const ProjectChecklistChangeSchema = TeamChecklistChangeSchema;
const id = z.uuid(),
  instant = z.iso.datetime(),
  revision = z.number().int().positive();
export const ProjectTaskOrderQuerySchema = ProjectPageQuerySchema.extend({
  sectionId: id.optional(),
});
export const ProjectTaskOrderSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      id,
      sectionId: id.nullable(),
      position: z.number().int().nonnegative(),
      revision,
    }),
  ),
  nextCursor: z.string().nullable(),
});
export const ProjectHealthSchema = z.strictObject({
  state: z.enum(['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'UNKNOWN']),
  advisory: z.literal(true),
  asOf: instant,
  reasons: z.array(
    z.enum([
      'PROJECT_DEADLINE_PASSED',
      'OVERDUE_WORK',
      'BLOCKED_WORK',
      'ALL_ELIGIBLE_WORK_COMPLETED',
      'INSUFFICIENT_BASELINE',
    ]),
  ),
  observed: z.strictObject({
    eligibleTasks: z.number().int().nonnegative(),
    completedTasks: z.number().int().nonnegative(),
    overdueTasks: z.number().int().nonnegative(),
    blockedTasks: z.number().int().nonnegative(),
    progressPercent: z.number().min(0).max(100).nullable(),
    endDate: z.iso.date().nullable(),
  }),
});
export const ProjectStructureProgressSchema = z.strictObject({
  asOf: instant,
  items: z
    .array(
      z.strictObject({
        id,
        kind: z.enum(['PHASE', 'MILESTONE']),
        title: z.string(),
        phaseId: id.nullable(),
        startDate: z.iso.date().nullable(),
        endDate: z.iso.date().nullable(),
        status: z.enum(['OPEN', 'COMPLETED']).nullable(),
        totalTasks: z.number().int().nonnegative(),
        eligibleTasks: z.number().int().nonnegative(),
        openTasks: z.number().int().nonnegative(),
        completedTasks: z.number().int().nonnegative(),
        progressPercent: z.number().min(0).max(100).nullable(),
        revision,
      }),
    )
    .max(10000),
});
const value = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const ProjectDetailedActivityQuerySchema = ProjectPageQuerySchema.extend(
  {
    taskId: id.optional(),
    actorId: id.optional(),
    action: z
      .string()
      .regex(/^[a-z.]{1,80}$/)
      .optional(),
  },
);
export const ProjectDetailedActivitySchema = z.strictObject({
  items: z.array(
    z.strictObject({
      id,
      actorId: id,
      action: z.string(),
      entityType: z.enum([
        'PROJECT',
        'TASK',
        'GOAL',
        'DOCUMENT',
        'PHASE',
        'SECTION',
        'MILESTONE',
        'REGISTER_ITEM',
        'FILE',
        'WORKFLOW',
      ]),
      entityId: id,
      at: instant,
      target: z.strictObject({ id, title: z.string().nullable() }),
      changes: z.array(
        z.strictObject({ field: z.string(), from: value, to: value }),
      ),
      kind: z.enum([
        'TASK_STATUS',
        'TASK_COMPLETED',
        'MILESTONE_REACHED',
        'STATUS_NOTE',
        'SCOPE_CHANGED',
        'CONTENT',
        'OTHER',
      ]),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export const ProjectScopeHistorySchema = ProjectDetailedActivitySchema;
export const ProjectInvitationDeclineSchema = z.strictObject({
  note: z
    .string()
    .trim()
    .max(500)
    .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v))
    .optional(),
});
export const ProjectWorkflowDraftCreateSchema = z.strictObject({
  id,
  workflowId: id.nullable().default(null),
  baseRevision: z.number().int().min(0).default(0),
  definition: WorkflowVersionInputSchema,
});
export const ProjectWorkflowDraftPatchSchema = z.strictObject({
  definition: WorkflowVersionInputSchema,
});
export const ProjectWorkflowDraftSchema =
  ProjectWorkflowDraftCreateSchema.extend({
    state: z.enum(['DRAFT', 'PUBLISHED', 'DISCARDED']),
    revision,
    publishedVersion: revision.nullable(),
    createdByActorId: id,
    createdAt: instant,
    updatedAt: instant,
  });
export const ProjectWorkflowDraftPageSchema = z.strictObject({
  items: z.array(ProjectWorkflowDraftSchema),
  nextCursor: z.string().nullable(),
});
export const ProjectWorkflowDraftPreviewSchema = z.strictObject({
  id,
  revision,
  preservesExistingBindings: z.literal(true),
  removedStates: z
    .array(
      z.strictObject({
        version: revision,
        stateId: id,
        taskCount: z.number().int().nonnegative(),
      }),
    )
    .max(10000),
});
export const ProjectSentInvitationQuerySchema = ProjectPageQuerySchema.extend({
  state: SharedOfferStateSchema.default('PENDING'),
});
export const ProjectSentInvitationSchema = InvitationSchema.extend({
  recipientEmail: z.email().nullable(),
  createdAt: instant,
  sentAt: instant,
  declineNote: z.string().max(500).nullable(),
});
export const ProjectSentInvitationPageSchema = z.strictObject({
  items: z.array(ProjectSentInvitationSchema),
  nextCursor: z.string().nullable(),
});
export const ProjectRiskCloseSchema = z.strictObject({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((v) => !v.includes('\0')),
  note: z
    .string()
    .max(2000)
    .refine((v) => !v.includes('\0'))
    .nullable()
    .optional(),
});
export const ProjectRiskConvertSchema = z.strictObject({
  id,
  targetKind: z.enum(['ISSUE', 'TASK']),
});
export const ProjectAssignmentRevertResultSchema = z.strictObject({
  previous: TaskAssignmentSchema,
  current: TaskAssignmentSchema,
});
export const ProjectInitialTemplatesSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: z.enum(['BLANK', 'KANBAN', 'SCRUM']),
        version: z.literal(1),
        name: z.string(),
        sections: z.array(z.string()),
        workflow: z.enum(['BASE_TASK_STATUSES']).nullable(),
      }),
    )
    .length(3),
});
export const ProjectFileFolderCreateSchema = z.strictObject({
  id,
  parentId: id.nullable().default(null),
  title: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((v) => !v.includes('\0')),
});
export const ProjectFileFolderPatchSchema = z
  .strictObject({
    title: ProjectFileFolderCreateSchema.shape.title.optional(),
    parentId: id.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const ProjectFileFolderSchema = ProjectFileFolderCreateSchema.extend({
  revision,
  createdAt: instant,
  updatedAt: instant,
  archivedAt: instant.nullable(),
});
export const ProjectFileFolderPageSchema = z.strictObject({
  items: z.array(ProjectFileFolderSchema),
  nextCursor: z.string().nullable(),
});
export const ProjectFileVersionCreateSchema = FileUploadSchema.extend({ id });
export const ProjectFileMoveSchema = z.strictObject({
  folderId: id.nullable(),
});
export const ProjectFileConfigSchema = z.strictObject({
  maxBytes: z.number().int().positive(),
  allowedTypes: z.array(FileMimeSchema),
});
export const ProjectFileVersionSchema = z.strictObject({
  id,
  rootFileId: id,
  number: z.number().int().min(1).max(100),
  createdByActorId: id,
  filename: z.string(),
  mimeType: FileMimeSchema,
  status: z.enum(['INITIATED', 'READY', 'REJECTED', 'DELETED']),
  revision,
  size: z.number().int().nullable(),
  createdAt: instant,
});
export const ProjectFileVersionsSchema = z.strictObject({
  items: z.array(ProjectFileVersionSchema).max(100),
  currentVersionId: id.nullable(),
});
export const ProjectFileLibraryEntrySchema = z.strictObject({
  id,
  folderId: id.nullable(),
  revision,
  createdByActorId: id,
  currentVersionId: id.nullable(),
  versionCount: z.number().int().min(1).max(100),
});
export const ProjectFileLibraryPageSchema = z.strictObject({
  items: z.array(ProjectFileLibraryEntrySchema),
  nextCursor: z.string().nullable(),
});
export const ProjectFileLibraryQuerySchema = ProjectPageQuerySchema.extend({
  folderId: id.optional(),
});
const count = z.number().int().nonnegative();
export const ProjectAnalyticsSchema = z.strictObject({
  projectId: id,
  fromAt: instant,
  toAt: instant,
  asOf: instant,
  basis: z.literal(
    'CURRENT_VISIBLE_TASKS_CURRENT_PRIMARY_ASSIGNEES_AND_SHARED_LOGS',
  ),
  cycleBasis: z.literal(
    'FIRST_RECORDED_IN_PROGRESS_TO_CURRENT_DONE_INCLUDES_REOPEN_INTERVALS',
  ),
  recordedWorkBasis: z.literal('UNION_PER_RECORDED_MEMBER'),
  taskCount: count,
  completedTasks: count,
  overdueTasks: count,
  estimatedMinutes: count,
  unknownEstimates: count,
  recordedSeconds: count,
  onTime: z.strictObject({
    completedWithDueDate: count,
    completedOnTime: count,
    percent: z.number().min(0).max(100).nullable(),
  }),
  cycleTime: z.strictObject({
    knownCompletedTasks: count,
    unknownCompletedTasks: count,
    medianSeconds: z.number().nonnegative().nullable(),
  }),
  weeklyThroughput: z
    .array(
      z.strictObject({ fromAt: instant, toAt: instant, completedTasks: count }),
    )
    .max(14),
  assignees: z
    .array(
      z.strictObject({
        accessId: id,
        generation: revision,
        taskCount: count,
        completedTasks: count,
        overdueTasks: count,
        estimatedMinutes: count,
        unknownEstimates: count,
        recordedSeconds: count,
      }),
    )
    .max(10000),
});
