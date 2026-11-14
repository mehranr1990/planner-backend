import { z } from 'zod';
import { ProjectSchema, ProjectPageQuerySchema } from './projects.js';
import {
  SharedMembershipSchema,
  OwnerHandoverSchema,
} from './collaboration.js';
import { ProjectReportSchema } from './project-execution.js';

const key = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{1,32}$/)
  .nullable();
const color = z
  .string()
  .regex(/^#[A-Fa-f0-9]{6}$/)
  .nullable();
const summary = ProjectSchema.shape.description;
const plannedDate = z.iso
  .date()
  .refine((value) => value >= '0001-01-01')
  .nullable();
export const ProjectAccessMeSchema = z.strictObject({
  accessId: z.uuid(),
  actorId: z.uuid(),
  role: SharedMembershipSchema.shape.role,
  state: z.literal('ACTIVE'),
  generation: SharedMembershipSchema.shape.generation,
  scope: z.enum(['FULL', 'PROJECT']),
  projectState: ProjectSchema.shape.state,
  capabilities: z.array(z.string().min(1)),
});
export const ProjectMetadataPatchSchema = z
  .strictObject({
    key: key.optional(),
    color: color.optional(),
    summary: summary.optional(),
    startDate: plannedDate.optional(),
    endDate: plannedDate.optional(),
    statusNote: z.string().max(2000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0)
  .refine(
    (value) =>
      !value.startDate || !value.endDate || value.startDate <= value.endDate,
  );
export const ProjectMetadataSchema = z.strictObject({
  id: z.uuid(),
  title: ProjectSchema.shape.title,
  key,
  color,
  summary,
  startDate: plannedDate,
  endDate: plannedDate,
  statusNote: z.string().max(2000).nullable(),
  status: ProjectSchema.shape.state,
  revision: ProjectSchema.shape.revision,
});
export const ProjectMemberDisplaySchema = SharedMembershipSchema.extend({
  displayName: z.string().nullable(),
});
export const ProjectMemberDisplayPageSchema = z.strictObject({
  items: z.array(ProjectMemberDisplaySchema).max(100),
  nextCursor: ProjectPageQuerySchema.shape.after.unwrap().nullable(),
});
export const ProjectHandoverPageSchema = z.strictObject({
  items: z.array(OwnerHandoverSchema).max(100),
  nextCursor: ProjectPageQuerySchema.shape.after.unwrap().nullable(),
});
export const ProjectDashboardSchema = z.strictObject({
  report: ProjectReportSchema,
  progress: z.strictObject({
    basis: z.literal('DONE_OVER_NON_CANCELED_VISIBLE_TASKS'),
    completedTasks: z.number().int().nonnegative(),
    eligibleTasks: z.number().int().nonnegative(),
    percent: z.number().min(0).max(100).nullable(),
  }),
  health: z.strictObject({
    basis: z.literal('CURRENT_AUTHORIZED_PROJECT_DATA'),
    overdueTaskCount: z.number().int().nonnegative(),
    openRiskCount: z.number().int().nonnegative(),
    openIssueCount: z.number().int().nonnegative(),
  }),
});
