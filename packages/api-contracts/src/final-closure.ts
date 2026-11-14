import { z } from 'zod';
const id = z.uuid(),
  revision = z.number().int().positive().max(2147483646),
  datetime = z.iso.datetime(),
  text = (max: number) =>
    z
      .string()
      .trim()
      .min(1)
      .max(max)
      .refine((v) => !v.includes('\0'));

// Final Phase 1–5 closure (2026-11-14) ---------------------------------------

/**
 * Personal Task category for estimate accuracy: explicit and user-set only,
 * never inferred from labels or text. Ids match the Insights screen.
 */
export const TaskCategorySchema = z.enum([
  'design',
  'admin',
  'writing',
  'errands',
]);
export const TaskCategoryPutSchema = z.strictObject({
  category: TaskCategorySchema.nullable(),
});
export const TaskCategoryViewSchema = z.strictObject({
  taskId: id,
  revision,
  category: TaskCategorySchema.nullable(),
});

/**
 * OD-5 context move. Only a unit moves between departments: a context's level
 * (DEPARTMENT / UNIT) is its immutable identity, so a department never becomes
 * a unit and a unit never becomes a department.
 */
export const ContextMoveQuerySchema = z.strictObject({
  scopeId: id,
  /** Destination department; omit for the Company root (always refused as a level change). */
  parentId: id.optional(),
});
export const ContextMoveRefusalSchema = z.enum([
  'MOVE_SELF_PARENT',
  'MOVE_CYCLE',
  'MOVE_LEVEL_CHANGE',
  'MOVE_SAME_PARENT',
  'MOVE_POLICY_CONFLICT',
]);
export const ContextMovePreviewSchema = z.strictObject({
  scopeId: id,
  kind: z.enum(['DEPARTMENT', 'UNIT']),
  fromParentId: id.nullable(),
  parentId: id.nullable(),
  /** Active seats in the moved context; they stay valid (root-bound) and move with it. */
  people: z.number().int().nonnegative(),
  /** Active Project/Team domain scopes held under the moved context; they move with it. */
  teams: z.number().int().nonnegative(),
  /** Unarchived budgets on the moved context, per currency (decimal strings; never summed across currencies). */
  budgets: z
    .array(
      z.strictObject({ currency: z.string().length(3), limit: z.string() }),
    )
    .max(50),
  /** Seats whose effective structure/directory access changes under the destination policy chain. */
  accessChanges: z.number().int().nonnegative(),
  revision,
  allowed: z.boolean(),
  refusal: ContextMoveRefusalSchema.nullable(),
});
export const ContextMoveCreateSchema = z.strictObject({
  id,
  scopeId: id,
  parentId: id,
});
export const ContextMoveSchema = z.strictObject({
  id,
  scopeId: id,
  fromParentId: id,
  parentId: id,
  /** The moved unit's new revision (send it as If-Match on later edits). */
  revision,
  accessChanges: z.number().int().nonnegative(),
  createdAt: datetime,
});
/**
 * Optional room booking title, set by the booker only. Private by default:
 * others see the booking as busy (title null) unless `shared` is true.
 * Revision is 1 while unset; the first stored write returns 2.
 */
export const RoomBookingTitlePutSchema = z.strictObject({
  title: text(120).nullable(),
  shared: z.boolean(),
});
export const RoomBookingTitleSchema = z.strictObject({
  allocationId: id,
  title: z.string().nullable(),
  shared: z.boolean(),
  revision,
});
export type TaskCategory = z.infer<typeof TaskCategorySchema>;
export type TaskCategoryView = z.infer<typeof TaskCategoryViewSchema>;
