import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
export type TaskToolContext = {
  spaceId: string;
  scopeId: string;
  actor: RequestActor;
  lockedUsers: string[];
  begin?: () => Promise<void>;
};
export abstract class ProjectTaskTools {
  abstract replayedTransition(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    key: string,
    fingerprint: string,
  ): Promise<z.infer<typeof c.WorkflowTransitionResultSchema>>;
  abstract transitionHint(
    db: Prisma.TransactionClient,
    spaceId: string,
    taskId: string,
    edgeId: string,
    approvalId?: string,
  ): Promise<'task.update' | 'task.complete'>;
  abstract workflowHint(
    db: Prisma.TransactionClient,
    spaceId: string,
    taskId: string,
  ): Promise<boolean>;
  abstract peopleHint(
    db: Prisma.TransactionClient,
    spaceId: string,
    scopeId: string,
    fieldId: string,
    version: number,
  ): Promise<string[]>;
  abstract approvalHint(
    db: Prisma.TransactionClient,
    spaceId: string,
    scopeId: string,
    id: string,
  ): Promise<string | null>;
  abstract workflows(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    after: string | undefined,
    limit: number,
  ): Promise<z.infer<typeof c.WorkflowSchema>[]>;
  abstract workflow(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    id: string,
    version: number,
  ): Promise<z.infer<typeof c.WorkflowVersionSchema>>;
  abstract publishWorkflow(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    id: string,
    expected: number,
    input: z.infer<typeof c.WorkflowVersionInputSchema>,
    key: string,
    fingerprint: string,
  ): Promise<z.infer<typeof c.WorkflowVersionSchema>>;
  abstract binding(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
  ): Promise<z.infer<typeof c.WorkflowBindingViewSchema>>;
  abstract bind(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    revision: number,
    input: z.infer<typeof c.WorkflowBindSchema>,
  ): Promise<z.infer<typeof c.WorkflowBindingViewSchema>>;
  abstract transition(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    revision: number,
    edgeId: string,
    key: string,
    fingerprint: string,
    now: Date,
  ): Promise<z.infer<typeof c.WorkflowTransitionResultSchema>>;
  abstract approvals(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    after: string | undefined,
    limit: number,
  ): Promise<z.infer<typeof c.WorkflowApprovalSchema>[]>;
  abstract decide(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    id: string,
    revision: number,
    approve: boolean,
    now: Date,
  ): Promise<z.infer<typeof c.WorkflowTransitionResultSchema>>;
  abstract fields(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    after: string | undefined,
    limit: number,
  ): Promise<z.infer<typeof c.CustomFieldSchema>[]>;
  abstract field(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    id: string,
    version: number,
  ): Promise<z.infer<typeof c.CustomFieldVersionSchema>>;
  abstract publishField(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    id: string,
    expected: number,
    input: z.infer<typeof c.CustomFieldVersionInputSchema>,
    key: string,
    fingerprint: string,
  ): Promise<z.infer<typeof c.CustomFieldVersionSchema>>;
  abstract deprecateField(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    id: string,
    revision: number,
    now: Date,
  ): Promise<z.infer<typeof c.CustomFieldSchema>>;
  abstract values(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
  ): Promise<z.infer<typeof c.CustomFieldValuesSchema>>;
  abstract setValue(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    fieldId: string,
    revision: number,
    input: z.infer<typeof c.CustomFieldSetSchema>,
  ): Promise<z.infer<typeof c.CustomFieldValuesSchema>>;
  abstract search(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    input: z.infer<typeof c.CustomFieldSearchSchema>,
    after: string | undefined,
    limit: number,
  ): Promise<z.infer<typeof c.SharedTaskSchema>[]>;
  abstract graph(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
  ): Promise<z.infer<typeof c.DependencyGraphSchema>>;
  abstract dependency(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    input: z.infer<typeof c.DependencyInputSchema>,
    revision?: number,
  ): Promise<z.infer<typeof c.DependencySchema>>;
  abstract retireDependency(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    id: string,
    revision: number,
    now: Date,
  ): Promise<z.infer<typeof c.DependencySchema>>;
  abstract preview(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    input: z.infer<typeof c.ReschedulePreviewInputSchema>,
    key: string,
    fingerprint: string,
    now: Date,
  ): Promise<z.infer<typeof c.ReschedulePreviewSchema>>;
  abstract plan(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    id: string,
  ): Promise<z.infer<typeof c.ReschedulePreviewSchema>>;
  abstract apply(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    id: string,
    revision: number,
    manifestHash: string,
    now: Date,
  ): Promise<z.infer<typeof c.ReschedulePreviewSchema>>;
  abstract history(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    after: string | undefined,
    limit: number,
  ): Promise<z.infer<typeof c.TaskMetadataEventSchema>[]>;
}
