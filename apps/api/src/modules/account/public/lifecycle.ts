import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { IncomingHttpHeaders } from 'node:http';
import type { Readable } from 'node:stream';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AdminCommand } from '../../../platform/admin/admin-command.js';
export type AdminAccountDeletionPreview = {
  id: string;
  revision: number;
  fingerprint: string;
  eligible: boolean;
  policyVersion: string | null;
  dependencies: { id: string; kind: string }[];
};
export abstract class PersonalLifecycle {
  abstract deletionNotice(
    jobId: string,
    userId: string,
  ): Promise<{ recovery: string; deadline: string } | null>;
  abstract adminDeletionStatus(id: string): Promise<{
    state: string;
    attempts: number;
    recoveryDeadline: string | null;
    failureCode: string | null;
  } | null>;
  abstract adminDeletionPreview(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<AdminAccountDeletionPreview>;
  abstract adminDeleteInside(
    tx: Prisma.TransactionClient,
    command: AdminCommand,
    id: string,
    input: {
      revision: number;
      fingerprint: string;
      policyVersion: string;
      retentionAcknowledged: boolean;
      recoveryDays: number;
      requestId: string;
      reason: string;
    },
  ): Promise<{ jobId: string; eraseAfter: string }>;
  abstract adminRecoverInside(
    tx: Prisma.TransactionClient,
    command: AdminCommand,
    jobId: string,
  ): Promise<void>;
  abstract archive(
    scope: AuthorizedSpace,
    id: string,
    proof: string | undefined,
    projectId?: string,
  ): Promise<Readable>;
  abstract deletionPolicy(
    scope: AuthorizedSpace,
  ): Promise<z.infer<typeof c.DeletionPolicySchema>>;
  abstract currentDeletion(
    scope: AuthorizedSpace,
  ): Promise<z.infer<typeof c.DeletionJobSchema> | null>;
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
