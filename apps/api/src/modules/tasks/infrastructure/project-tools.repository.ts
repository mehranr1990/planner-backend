import { Inject, Injectable } from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
import { ProjectTaskTools } from '../public/project-tools.js';
import type { TaskToolContext } from '../public/project-tools.js';
import { WorkflowTools } from './workflow-tools.repository.js';
import { FieldTools } from './field-tools.repository.js';
import { DependencyTools } from './dependency-tools.repository.js';
import { scope, source } from './project-tool-common.js';
@Injectable()
export class ProjectTaskToolsRepository extends ProjectTaskTools {
  replayedTransition(...args: Parameters<WorkflowTools['replayedTransition']>) {
    return this.w.replayedTransition(...args);
  }
  transitionHint(...args: Parameters<WorkflowTools['transitionHint']>) {
    return this.w.transitionHint(...args);
  }
  constructor(
    @Inject(WorkflowTools) private readonly w: WorkflowTools,
    @Inject(FieldTools) private readonly f: FieldTools,
    @Inject(DependencyTools) private readonly d: DependencyTools,
  ) {
    super();
  }
  workflowHint(...args: Parameters<WorkflowTools['workflowHint']>) {
    return this.w.workflowHint(...args);
  }
  approvalHint(...args: Parameters<WorkflowTools['approvalHint']>) {
    return this.w.approvalHint(...args);
  }
  workflows(...args: Parameters<WorkflowTools['workflows']>) {
    return this.w.workflows(...args);
  }
  workflow(...args: Parameters<WorkflowTools['workflow']>) {
    return this.w.workflow(...args);
  }
  publishWorkflow(...args: Parameters<WorkflowTools['publishWorkflow']>) {
    return this.w.publishWorkflow(...args);
  }
  binding(...args: Parameters<WorkflowTools['binding']>) {
    return this.w.binding(...args);
  }
  bind(...args: Parameters<WorkflowTools['bind']>) {
    return this.w.bind(...args);
  }
  transition(...args: Parameters<WorkflowTools['transition']>) {
    return this.w.transition(...args);
  }
  approvals(...args: Parameters<WorkflowTools['approvals']>) {
    return this.w.approvals(...args);
  }
  decide(...args: Parameters<WorkflowTools['decide']>) {
    return this.w.decide(...args);
  }
  peopleHint(...args: Parameters<FieldTools['peopleHint']>) {
    return this.f.peopleHint(...args);
  }
  fields(...args: Parameters<FieldTools['fields']>) {
    return this.f.fields(...args);
  }
  field(...args: Parameters<FieldTools['field']>) {
    return this.f.field(...args);
  }
  publishField(...args: Parameters<FieldTools['publishField']>) {
    return this.f.publishField(...args);
  }
  deprecateField(...args: Parameters<FieldTools['deprecateField']>) {
    return this.f.deprecateField(...args);
  }
  values(...args: Parameters<FieldTools['values']>) {
    return this.f.values(...args);
  }
  setValue(...args: Parameters<FieldTools['setValue']>) {
    return this.f.setValue(...args);
  }
  search(...args: Parameters<FieldTools['search']>) {
    return this.f.search(...args);
  }
  graph(...args: Parameters<DependencyTools['graph']>) {
    return this.d.graph(...args);
  }
  dependency(...args: Parameters<DependencyTools['dependency']>) {
    return this.d.dependency(...args);
  }
  retireDependency(...args: Parameters<DependencyTools['retireDependency']>) {
    return this.d.retireDependency(...args);
  }
  preview(...args: Parameters<DependencyTools['preview']>) {
    return this.d.preview(...args);
  }
  plan(...args: Parameters<DependencyTools['plan']>) {
    return this.d.plan(...args);
  }
  apply(...args: Parameters<DependencyTools['apply']>) {
    return this.d.apply(...args);
  }
  async history(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    after: string | undefined,
    limit: number,
  ) {
    await source(tx, a, ctx, taskId);
    return (
      await tx.taskMetadataEvent.findMany({
        where: {
          ...scope(ctx),
          taskId,
          ...(after ? { id: { gt: after } } : {}),
        },
        orderBy: { id: 'asc' },
        take: limit,
      })
    ).map((r) =>
      c.TaskMetadataEventSchema.strip().parse({
        ...r,
        createdAt: r.createdAt.toISOString(),
      }),
    );
  }
}
