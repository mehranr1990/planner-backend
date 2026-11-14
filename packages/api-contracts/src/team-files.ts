import { z } from 'zod';
import { TeamMemberReferenceSchema } from './team-interactions.js';
import { FileMimeSchema, FileNameSchema, FileUploadSchema } from './files.js';
const id = z.uuid(),
  revision = z.number().int().positive().max(2147483646),
  datetime = z.iso.datetime(),
  text = (max: number) =>
    z
      .string()
      .trim()
      .min(1)
      .max(max)
      .refine((v) => !v.includes('\0')),
  page = <T extends z.ZodType>(item: T) =>
    z.strictObject({
      items: z.array(item).max(100),
      nextCursor: z.string().nullable(),
    });
/** TM-11: private Team folders. Members create; the creator or a work manager renames or removes an empty folder. */
export const TeamFileFolderSchema = z.strictObject({
  id,
  parentId: id.nullable(),
  title: z.string(),
  revision,
  createdAt: datetime,
  updatedAt: datetime,
  can: z.strictObject({ rename: z.boolean(), remove: z.boolean() }),
});
export const TeamFileFolderPageSchema = page(TeamFileFolderSchema);
export const TeamFileFolderCreateSchema = z.strictObject({
  id,
  parentId: id.nullable().default(null),
  title: text(200),
});
export const TeamFileFolderPatchSchema = z.strictObject({ title: text(200) });
export const TeamFileRemovedSchema = z.strictObject({
  id,
  removed: z.literal(true),
});
/** One immutable upload; bytes are served only through the authorized download. */
export const TeamFileVersionSchema = z.strictObject({
  id,
  fileId: id,
  number: z.number().int().min(1).max(100),
  filename: FileNameSchema,
  mimeType: FileMimeSchema,
  expectedSize: z.number().int().positive(),
  size: z.number().int().nonnegative().nullable(),
  sha256: z.string().nullable(),
  status: z.enum(['INITIATED', 'READY', 'REJECTED', 'DELETED']),
  uploader: TeamMemberReferenceSchema,
  /** Private StoredFile revision; send it as If-Match when uploading content. */
  revision,
  createdAt: datetime,
});
export const TeamFileVersionPageSchema = page(TeamFileVersionSchema);
export const TeamFileSchema = z.strictObject({
  id,
  folderId: id.nullable(),
  title: z.string(),
  owner: TeamMemberReferenceSchema,
  /** Newest READY version (what downloads serve by default); null until one completes. */
  current: TeamFileVersionSchema.nullable(),
  /** Newest version in any state, e.g. an upload still in progress. */
  latest: TeamFileVersionSchema.nullable(),
  versionCount: z.number().int().nonnegative(),
  removed: z.boolean(),
  revision,
  createdAt: datetime,
  updatedAt: datetime,
  can: z.strictObject({
    upload: z.boolean(),
    edit: z.boolean(),
    remove: z.boolean(),
  }),
});
export const TeamFilePageSchema = page(TeamFileSchema);
export const TeamFileQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  after: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  /** Omit for every file; `root` for files outside folders. */
  folderId: z.union([id, z.literal('root')]).optional(),
});
export const TeamFileCreateSchema = z.strictObject({
  id,
  versionId: id,
  folderId: id.nullable().default(null),
  title: text(300),
  upload: FileUploadSchema,
});
export const TeamFilePatchSchema = z
  .strictObject({
    title: text(300).optional(),
    folderId: id.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const TeamFileVersionCreateSchema = z.strictObject({
  id,
  upload: FileUploadSchema,
});

// Team task checklists, dependencies, readiness and export (owner-approved gap closure)
export const TeamChecklistSchema = z.strictObject({
  taskId: id,
  /** Shared Task revision; send it as If-Match for the next change. */
  revision,
  items: z
    .array(
      z.strictObject({
        id,
        title: z.string(),
        completed: z.boolean(),
        position: z.number().int().nonnegative(),
      }),
    )
    .max(200),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export const TeamChecklistChangeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ADD'), id, title: text(300) }),
  z
    .strictObject({
      kind: z.literal('UPDATE'),
      id,
      title: text(300).optional(),
      completed: z.boolean().optional(),
    })
    .refine((v) => v.title !== undefined || v.completed !== undefined),
  z.strictObject({ kind: z.literal('DELETE'), id }),
  z.strictObject({
    kind: z.literal('REORDER'),
    ids: z.array(id).min(1).max(100),
  }),
]);
export const TeamTaskReadinessSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        taskId: id,
        status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELED']),
        /** Active predecessors that are still OPEN or IN_PROGRESS. */
        blockedBy: z.array(id),
        ready: z.boolean(),
      }),
    )
    .max(2000),
});
/** TM-12 export snapshot: Team-visible planning/work data only (no files, feedback, private thanks or proofs). */
export const TeamExportSchema = z.strictObject({
  teamId: id,
  title: z.string(),
  generatedAt: datetime,
  members: z.array(
    z.strictObject({
      member: TeamMemberReferenceSchema,
      role: z.string().nullable(),
      jobTitle: z.string().nullable(),
    }),
  ),
  tasks: z.array(
    z.strictObject({
      id,
      title: z.string(),
      status: z.string(),
      estimatedMinutes: z.number().int().nullable(),
      points: z.number().int().nullable(),
      dueAt: datetime.nullable(),
      completedAt: datetime.nullable(),
      checklist: z.strictObject({
        done: z.number().int(),
        total: z.number().int(),
      }),
      assignees: z.array(TeamMemberReferenceSchema),
      blockedBy: z.array(id),
    }),
  ),
  plans: z.array(
    z.strictObject({
      id,
      kind: z.string(),
      title: z.string(),
      state: z.string(),
      startDate: z.string(),
      endDate: z.string(),
    }),
  ),
  goals: z.array(
    z.strictObject({
      id,
      title: z.string(),
      status: z.string(),
      keyResults: z.number().int().nonnegative(),
    }),
  ),
});
