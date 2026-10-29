import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { IncomingHttpHeaders } from 'node:http';
import type { Readable } from 'node:stream';
export abstract class PersonalLifecycle {
  abstract requestExport(
    scope: AuthorizedSpace,
    key: string | undefined,
    input: z.infer<typeof c.ExportRequestSchema>,
  ): Promise<z.infer<typeof c.ExportJobSchema>>;
  abstract exportStatus(
    scope: AuthorizedSpace,
    id: string,
  ): Promise<z.infer<typeof c.ExportJobSchema>>;
  abstract download(
    scope: AuthorizedSpace,
    id: string,
    proof: string | undefined,
    fileId?: string,
  ): Promise<{ stream: Readable; mimeType: string }>;
  abstract requestDeletion(
    scope: AuthorizedSpace,
    key: string | undefined,
    input: z.infer<typeof c.DeletionRequestSchema>,
  ): Promise<z.infer<typeof c.DeletionChallengeSchema>>;
  abstract confirm(
    input: z.infer<typeof c.DeletionConfirmSchema>,
    proof: string | undefined,
    headers: IncomingHttpHeaders,
  ): Promise<z.infer<typeof c.DeletionJobSchema>>;
  abstract deletionStatus(
    id: string,
    recovery: string | undefined,
  ): Promise<z.infer<typeof c.DeletionJobSchema>>;
  abstract cancel(
    input: z.infer<typeof c.DeletionCancelSchema>,
    recovery: string | undefined,
  ): Promise<z.infer<typeof c.DeletionJobSchema>>;
  abstract consume(): Promise<boolean>;
  abstract verifyControl(): Promise<boolean>;
  abstract restoreReplay(): Promise<boolean>;
}
