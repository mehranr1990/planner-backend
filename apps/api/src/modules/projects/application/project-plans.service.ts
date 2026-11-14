import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import type { SharedRequest } from '../../spaces/public/index.js';
import {
  SharedTasks,
  SharedTaskWork,
  ProjectTaskTools,
} from '../../tasks/public/index.js';
import {
  ProjectExecutionContext,
  projectWhere,
  executionHash,
  executionKey,
  matchRevision,
} from './project-execution-context.js';
import type { ExecutionContext } from './project-execution-context.js';
import { appendProjectActivity } from './project-activity.js';
import { validateTemplate, validateOperations } from '../domain/work-plans.js';
import { csvRows, formulaCell, CsvImportError } from '../domain/csv-import.js';
type Operation = z.infer<typeof c.ProjectChangeOperationSchema>;
const registryView = (r: { deprecatedAt: Date | null }) =>
  c.ProjectTemplateSchema.strip().parse({
    ...r,
    deprecatedAt: r.deprecatedAt?.toISOString() ?? null,
  });
function rule<T>(fn: () => T) {
  try {
    return fn();
  } catch (e) {
    throw new BadRequestException({
      code: e instanceof Error ? e.message : 'INVALID_PLAN',
    });
  }
}
@Injectable()
export class ProjectPlansService {
  constructor(
    @Inject(ProjectExecutionContext)
    private readonly op: ProjectExecutionContext,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedTasks) private readonly tasks: SharedTasks,
    @Inject(SharedTaskWork) private readonly work: SharedTaskWork,
    @Inject(ProjectTaskTools) private readonly tools: ProjectTaskTools,
  ) {}
  templates(
    actor: RequestActor,
    pid: string,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.op.read(actor, pid, [], undefined, (s) =>
      this.op.page(s, 'project-templates', q, async (after) =>
        (
          await s.tx.projectTemplate.findMany({
            where: {
              ...projectWhere(s),
              ...(after ? { id: { gt: after } } : {}),
            },
            orderBy: { id: 'asc' },
            take: q.limit + 1,
          })
        ).map(registryView),
      ),
    );
  }
  private async version(s: ExecutionContext, id: string, version: number) {
    const r = await s.tx.projectTemplateVersion.findFirst({
      where: { ...projectWhere(s), templateId: id, version },
    });
    if (!r) throw new NotFoundException();
    return c.ProjectTemplateVersionSchema.parse({
      templateId: id,
      version,
      name: r.name,
      definition: r.definition,
      publishedByActorId: r.publishedByActorId,
      createdAt: r.createdAt.toISOString(),
    });
  }
  template(actor: RequestActor, pid: string, id: string, version: number) {
    return this.op.read(actor, pid, [], undefined, (s) =>
      this.version(s, id, version),
    );
  }
  publish(
    actor: RequestActor,
    pid: string,
    id: string,
    expected: number,
    input: z.infer<typeof c.ProjectTemplateVersionInputSchema>,
    raw: string | undefined,
  ) {
    const creationKey = executionKey(raw),
      fingerprint = executionHash({ expected, input });
    return this.op.write(
      actor,
      pid,
      ['work.manage'],
      undefined,
      'project.template.publish',
      id,
      [],
      async (s) => {
        rule(() => validateTemplate(input.definition));
        const previous = await s.tx.projectTemplateVersion.findFirst({
          where: { ...projectWhere(s), templateId: id, creationKey },
        });
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            throw new ConflictException();
          return this.version(s, id, previous.version);
        }
        const registry = await s.tx.projectTemplate.findFirst({
          where: { ...projectWhere(s), id },
        });
        if (expected === 0) {
          if (registry) throw new ConflictException();
        } else {
          if (!registry) throw new NotFoundException();
          matchRevision(registry.revision, expected);
          if (registry.deprecatedAt) throw new ConflictException();
        }
        await s.grow('project.template-version');
        await s.begin();
        const version = (registry?.currentVersion ?? 0) + 1,
          actorId = s.a.require(s.tx, pid, 'work.manage').actorId;
        if (!registry)
          await s.tx.projectTemplate.create({
            data: {
              ...projectWhere(s),
              id,
              name: input.name,
              createdByActorId: actorId,
              creationKey,
              fingerprint,
            },
          });
        else
          await s.tx.projectTemplate.update({
            where: { id },
            data: {
              name: input.name,
              currentVersion: version,
              revision: { increment: 1 },
            },
          });
        await s.tx.projectTemplateVersion.create({
          data: {
            ...projectWhere(s),
            templateId: id,
            version,
            name: input.name,
            definition: input.definition,
            publishedByActorId: actorId,
            creationKey,
            fingerprint,
          },
        });
        return this.version(s, id, version);
      },
    );
  }
  deprecate(actor: RequestActor, pid: string, id: string, expected: number) {
    return this.op.write(
      actor,
      pid,
      ['work.manage'],
      undefined,
      'project.template.deprecate',
      id,
      [],
      async (s) => {
        const r = await s.tx.projectTemplate.findFirst({
          where: { ...projectWhere(s), id },
        });
        if (!r) throw new NotFoundException();
        if (r.deprecatedAt) return registryView(r);
        matchRevision(r.revision, expected);
        await s.begin();
        return registryView(
          await s.tx.projectTemplate.update({
            where: { id },
            data: { deprecatedAt: s.now, revision: { increment: 1 } },
          }),
        );
      },
    );
  }
  private async caps(pid: string, operations: Operation[]) {
    const caps: SharedRequest['capability'][] = ['work.manage'];
    for (const o of operations) {
      if (o.kind === 'CREATE_TASK') {
        caps.push('task.create');
        if (o.estimatedMinutes !== undefined || o.schedule)
          caps.push('task.update');
      }
      if (o.kind === 'UPDATE_TASK') {
        if (
          o.estimatedMinutes !== undefined ||
          o.schedule ||
          o.patch?.title !== undefined ||
          o.patch?.description !== undefined ||
          o.patch?.priority !== undefined
        )
          caps.push('task.update');
        if (o.patch?.status) {
          caps.push(
            o.patch.status === 'DONE' || o.patch.status === 'OPEN'
              ? 'task.complete'
              : 'task.update',
          );
          if (await this.tools.workflowHint(this.db.client, pid, o.taskId))
            caps.push('workflow.transition');
        }
      }
    }
    return [...new Set(caps)];
  }
  private async validate(s: ExecutionContext, operations: Operation[]) {
    rule(() => validateOperations(operations));
    const phases = new Set(
        operations
          .filter((o) => o.kind === 'CREATE_PHASE')
          .map(
            (o) =>
              (o as z.infer<typeof c.ProjectComponentOperationSchema>).component
                .id,
          ),
      ),
      sections = new Set(
        operations
          .filter((o) => o.kind === 'CREATE_SECTION')
          .map(
            (o) =>
              (o as z.infer<typeof c.ProjectComponentOperationSchema>).component
                .id,
          ),
      ),
      milestones = new Set(
        operations
          .filter((o) => o.kind === 'CREATE_MILESTONE')
          .map(
            (o) =>
              (o as z.infer<typeof c.ProjectComponentOperationSchema>).component
                .id,
          ),
      );
    for (const o of operations) {
      if (o.kind === 'UPDATE_TASK') await this.op.linked(s, o.taskId);
      if (o.kind === 'CREATE_TASK') {
        if (
          o.task.sectionId &&
          !sections.has(o.task.sectionId) &&
          !(await s.tx.projectSection.findFirst({
            where: { ...projectWhere(s), id: o.task.sectionId },
          }))
        )
          throw new NotFoundException();
        if (
          o.task.milestoneId &&
          !milestones.has(o.task.milestoneId) &&
          !(await s.tx.projectMilestone.findFirst({
            where: { ...projectWhere(s), id: o.task.milestoneId },
          }))
        )
          throw new NotFoundException();
      }
      if (o.kind === 'CREATE_SECTION' || o.kind === 'CREATE_MILESTONE') {
        if (
          o.component.phaseId &&
          !phases.has(o.component.phaseId) &&
          !(await s.tx.projectPhase.findFirst({
            where: { ...projectWhere(s), id: o.component.phaseId },
          }))
        )
          throw new NotFoundException();
      }
    }
    await this.work.validate(s.tx, s.a, s, operations);
  }
  private async plan(s: ExecutionContext, id: string) {
    const r = await s.tx.projectChangePlan.findFirst({
        where: { ...projectWhere(s), id },
      }),
      access = s.a.require(s.tx, s.pid, 'work.manage');
    if (
      !r ||
      r.creatorAccessId !== access.accessId ||
      r.creatorGeneration !== access.generation
    )
      throw new NotFoundException();
    const sources = await s.tx.projectChangeSource.findMany({
      where: { ...projectWhere(s), planId: id },
      orderBy: { taskId: 'asc' },
    });
    for (const source of sources)
      await this.tasks.read(s.tx, s.a, s.pid, source.taskId);
    return c.ProjectChangePlanSchema.parse({
      id,
      projectId: s.pid,
      kind: r.kind,
      state: r.state,
      revision: r.revision,
      manifestHash: r.manifestHash,
      expiresAt: r.expiresAt.toISOString(),
      appliedAt: r.appliedAt?.toISOString() ?? null,
      operations: r.operations,
      sources: sources.map(({ taskId, sourceRevision, kind }) => ({
        taskId,
        sourceRevision,
        kind,
      })),
    });
  }
  getPlan(actor: RequestActor, pid: string, id: string) {
    return this.op.read(actor, pid, ['work.manage'], undefined, (s) =>
      this.plan(s, id),
    );
  }
  private async preview(
    s: ExecutionContext,
    id: string,
    kind: 'BULK' | 'CSV' | 'TEMPLATE',
    operations: () => Operation[],
    creationKey: string,
    fingerprint: string,
    template?: { id: string; version: number },
  ) {
    const access = s.a.require(s.tx, s.pid, 'work.manage'),
      old = await s.tx.projectChangePlan.findFirst({
        where: {
          ...projectWhere(s),
          creatorAccessId: access.accessId,
          creatorGeneration: access.generation,
          creationKey,
        },
      });
    if (old) {
      if (old.id !== id || old.fingerprint !== fingerprint)
        throw new ConflictException();
      return this.plan(s, id);
    }
    const values = operations();
    await this.validate(s, values);
    const sources = values
        .filter((o) => o.kind === 'UPDATE_TASK')
        .map((o) => ({
          taskId: o.taskId,
          sourceRevision: o.sourceRevision,
          kind: 'EXISTING' as const,
        })),
      authorizationVersion = access.authorizationVersion + 1n,
      manifestHash = executionHash({
        pid: s.pid,
        operations: values,
        sources,
        authorizationVersion: String(authorizationVersion),
        template: template ?? null,
      });
    await s.grow('project.change-plan');
    await s.begin();
    await s.tx.projectChangePlan.create({
      data: {
        ...projectWhere(s),
        id,
        kind,
        operations: values as Prisma.InputJsonValue,
        templateId: template?.id ?? null,
        templateVersion: template?.version ?? null,
        creatorAccessId: access.accessId,
        creatorGeneration: access.generation,
        createdByActorId: access.actorId,
        authorizationVersion,
        manifestHash,
        creationKey,
        fingerprint,
        createdAt: s.now,
        expiresAt: new Date(s.now.getTime() + 1800000),
      },
    });
    if (sources.length)
      await s.tx.projectChangeSource.createMany({
        data: sources.map((v) => ({ ...projectWhere(s), planId: id, ...v })),
      });
    return this.plan(s, id);
  }
  async bulk(
    actor: RequestActor,
    pid: string,
    input: z.infer<typeof c.ProjectBulkPreviewSchema>,
    raw: string | undefined,
  ) {
    const caps = await this.caps(pid, input.operations),
      key = executionKey(raw),
      fingerprint = executionHash(input);
    return this.op.write(
      actor,
      pid,
      caps,
      undefined,
      'project.plan.preview',
      input.id,
      [],
      (s) =>
        this.preview(
          s,
          input.id,
          'BULK',
          () => input.operations,
          key,
          fingerprint,
        ),
    );
  }
  inspectCsv(
    actor: RequestActor,
    pid: string,
    input: z.infer<typeof c.ProjectCsvInspectionInputSchema>,
  ) {
    return this.op.read(actor, pid, ['work.manage'], undefined, async () => {
      try {
        const rows = csvRows(input.csv),
          columns = rows[0] ?? [],
          sampleRows = rows.slice(1, 6);
        return c.ProjectCsvInspectionSchema.parse({
          columns: columns.map((cell) => cell.slice(0, 2000)),
          sampleRows: sampleRows.map((row) =>
            row.map((cell) => cell.slice(0, 2000)),
          ),
          rowCount: Math.max(0, rows.length - 1),
          samplesTruncated: [columns, ...sampleRows].some((row) =>
            row.some((cell) => cell.length > 2000),
          ),
          errors: [],
        });
      } catch (error) {
        if (!(error instanceof CsvImportError)) throw error;
        return c.ProjectCsvInspectionSchema.parse({
          columns: [],
          sampleRows: [],
          rowCount: 0,
          samplesTruncated: false,
          errors: [{ row: 0, column: '', code: error.code }],
        });
      }
    });
  }
  csv(
    actor: RequestActor,
    pid: string,
    input: z.infer<typeof c.ProjectCsvPreviewSchema>,
    raw: string | undefined,
  ) {
    const key = executionKey(raw),
      fingerprint = executionHash(input);
    return this.op.write(
      actor,
      pid,
      ['work.manage', 'task.create', 'task.update'],
      undefined,
      'project.plan.csv.preview',
      input.id,
      [],
      async (s) => {
        let rows: string[][];
        try {
          rows = csvRows(input.csv);
        } catch (e) {
          if (!(e instanceof CsvImportError)) throw e;
          return {
            valid: false,
            errors: [{ row: 0, column: '', code: e.code }],
            plan: null,
          };
        }
        const headers = rows[0] ?? [],
          allowed = [
            'title',
            'description',
            'priority',
            'estimatedMinutes',
            'plannedStartAt',
            'dueAt',
            'scheduledDate',
          ],
          errors: z.infer<typeof c.ProjectCsvErrorSchema>[] = [],
          operations: Operation[] = [];
        if (
          !headers.includes('title') ||
          new Set(headers).size !== headers.length ||
          headers.some((h) => !allowed.includes(h))
        )
          return {
            valid: false,
            errors: [{ row: 1, column: '', code: 'HEADERS' as const }],
            plan: null,
          };
        for (let i = 1; i < rows.length && errors.length < 100; i++) {
          const row = rows[i]!,
            record = Object.fromEntries(
              headers.map((h, n) => [h, row[n] ?? '']),
            );
          if (row.length !== headers.length) {
            errors.push({ row: i + 1, column: '', code: 'VALUE' });
            continue;
          }
          const unsafe = headers.find((h) => formulaCell(record[h]!));
          if (unsafe) {
            errors.push({ row: i + 1, column: unsafe, code: 'FORMULA' });
            continue;
          }
          const hasSchedule = Boolean(
              record.plannedStartAt || record.dueAt || record.scheduledDate,
            ),
            value = c.ProjectCreateTaskOperationSchema.safeParse({
              kind: 'CREATE_TASK',
              task: {
                id: randomUUID(),
                title: record.title,
                description: record.description || null,
                priority: record.priority || 'NONE',
              },
              ...(record.estimatedMinutes
                ? {
                    estimatedMinutes: /^\d+$/.test(record.estimatedMinutes)
                      ? Number(record.estimatedMinutes)
                      : 'invalid',
                  }
                : {}),
              ...(hasSchedule
                ? {
                    schedule: {
                      plannedStartAt: record.plannedStartAt || null,
                      dueAt: record.dueAt || null,
                      scheduledDate: record.scheduledDate || null,
                    },
                  }
                : {}),
            });
          if (!value.success)
            errors.push({
              row: i + 1,
              column: String(value.error.issues[0]?.path.at(-1) ?? ''),
              code: record.title ? 'VALUE' : 'REQUIRED',
            });
          else operations.push(value.data);
        }
        if (!operations.length && !errors.length)
          errors.push({ row: 2, column: 'title', code: 'REQUIRED' });
        if (errors.length) return { valid: false, errors, plan: null };
        return {
          valid: true,
          errors: [],
          plan: await this.preview(
            s,
            input.id,
            'CSV',
            () => operations,
            key,
            fingerprint,
          ),
        };
      },
    );
  }
  templatePreview(
    actor: RequestActor,
    pid: string,
    id: string,
    input: z.infer<typeof c.ProjectTemplatePreviewSchema>,
    raw: string | undefined,
  ) {
    const key = executionKey(raw),
      fingerprint = executionHash({ templateId: id, input });
    return this.op.write(
      actor,
      pid,
      ['work.manage', 'task.create', 'task.update'],
      undefined,
      'project.plan.template.preview',
      input.id,
      [],
      async (s) => {
        const registry = await s.tx.projectTemplate.findFirst({
          where: { ...projectWhere(s), id },
        });
        if (!registry) throw new NotFoundException();
        if (registry.deprecatedAt) throw new ConflictException();
        const version = await this.version(s, id, input.version);
        return this.preview(
          s,
          input.id,
          'TEMPLATE',
          () => {
            const d = version.definition;
            rule(() => validateTemplate(d));
            const keys = new Map(
                [...d.phases, ...d.sections, ...d.milestones, ...d.tasks].map(
                  (r) => [r.key, randomUUID()],
                ),
              ),
              operations: Operation[] = [];
            for (const p of d.phases)
              operations.push({
                kind: 'CREATE_PHASE',
                component: {
                  id: keys.get(p.key)!,
                  title: p.title,
                  position: p.position,
                },
              });
            for (const section of d.sections)
              operations.push({
                kind: 'CREATE_SECTION',
                component: {
                  id: keys.get(section.key)!,
                  title: section.title,
                  position: section.position,
                  phaseId: section.phaseKey
                    ? keys.get(section.phaseKey)!
                    : null,
                },
              });
            for (const m of d.milestones)
              operations.push({
                kind: 'CREATE_MILESTONE',
                component: {
                  id: keys.get(m.key)!,
                  title: m.title,
                  position: m.position,
                  phaseId: m.phaseKey ? keys.get(m.phaseKey)! : null,
                  targetDate: m.targetDate,
                },
              });
            for (const t of d.tasks)
              operations.push({
                kind: 'CREATE_TASK',
                task: {
                  id: keys.get(t.key)!,
                  title: t.title,
                  description: t.description,
                  priority: t.priority,
                  sectionId: t.sectionKey ? keys.get(t.sectionKey)! : null,
                  milestoneId: t.milestoneKey
                    ? keys.get(t.milestoneKey)!
                    : null,
                },
                estimatedMinutes: t.estimatedMinutes,
              });
            for (const e of d.dependencies)
              operations.push({
                kind: 'CREATE_DEPENDENCY',
                id: randomUUID(),
                predecessorId: keys.get(e.predecessorKey)!,
                successorId: keys.get(e.successorKey)!,
                dependencyKind: e.kind,
                lagMinutes: e.lagMinutes,
              });
            return operations;
          },
          key,
          fingerprint,
          { id, version: input.version },
        );
      },
    );
  }
  async apply(
    actor: RequestActor,
    pid: string,
    id: string,
    expected: number,
    manifestHash: string,
  ) {
    this.op.kernel.assertEnabled();
    const hint = await this.db.client.projectChangePlan.findFirst({
      where: { id, projectId: pid, spaceId: pid, scopeId: pid },
    });
    const operations = hint ? zArray(hint.operations) : [],
      caps = await this.caps(pid, operations);
    return this.op.write(
      actor,
      pid,
      caps,
      undefined,
      'project.plan.apply',
      id,
      [],
      async (s) => {
        const plan = await this.plan(s, id),
          row = await s.tx.projectChangePlan.findUniqueOrThrow({
            where: { id },
          });
        if (plan.manifestHash !== manifestHash) throw new ConflictException();
        if (plan.state === 'APPLIED') return plan;
        matchRevision(plan.revision, expected);
        if (
          row.expiresAt <= s.now ||
          row.authorizationVersion !==
            s.a.require(s.tx, pid, 'work.manage').authorizationVersion
        )
          throw new ConflictException({ code: 'PROJECT_PLAN_STALE' });
        await this.validate(s, plan.operations);
        const created = plan.operations.filter((o) => o.kind === 'CREATE_TASK'),
          dependencies = plan.operations.filter(
            (o) => o.kind === 'CREATE_DEPENDENCY',
          );
        if (created.length) await s.grow('task.shared', created.length);
        if (dependencies.length)
          await s.grow('task.dependency', dependencies.length);
        await s.begin();
        for (const o of plan.operations) {
          if (o.kind === 'CREATE_PHASE') {
            await s.tx.projectPhase.create({
              data: {
                ...projectWhere(s),
                id: o.component.id,
                title: o.component.title,
                position: o.component.position,
              },
            });
            continue;
          }
          if (o.kind === 'CREATE_SECTION') {
            await s.tx.projectSection.create({
              data: {
                ...projectWhere(s),
                id: o.component.id,
                title: o.component.title,
                position: o.component.position,
                phaseId: o.component.phaseId ?? null,
              },
            });
            continue;
          }
          if (o.kind === 'CREATE_MILESTONE') {
            await s.tx.projectMilestone.create({
              data: {
                ...projectWhere(s),
                id: o.component.id,
                title: o.component.title,
                position: o.component.position,
                phaseId: o.component.phaseId ?? null,
                targetDate: o.component.targetDate
                  ? new Date(o.component.targetDate)
                  : null,
              },
            });
            continue;
          }
          if (o.kind === 'CREATE_DEPENDENCY') {
            await this.tools.dependency(s.tx, s.a, s, {
              id: o.id,
              predecessorId: o.predecessorId,
              successorId: o.successorId,
              kind: o.dependencyKind,
              lagMinutes: o.lagMinutes,
            });
            continue;
          }
          if (o.kind !== 'CREATE_TASK' && o.kind !== 'UPDATE_TASK')
            throw new BadRequestException();
          let taskId: string, revision: number;
          if (o.kind === 'CREATE_TASK') {
            const task = await this.tasks.create(s.tx, s.a, pid, o.task);
            taskId = task.id;
            revision = task.revision;
            await s.tx.projectTask.create({
              data: {
                ...projectWhere(s),
                taskId,
                sectionId: o.task.sectionId ?? null,
                milestoneId: o.task.milestoneId ?? null,
              },
            });
          } else {
            taskId = o.taskId;
            revision = o.sourceRevision;
            if (o.patch)
              revision = (
                await this.tasks.update(
                  s.tx,
                  s.a,
                  pid,
                  taskId,
                  revision,
                  o.patch,
                )
              ).revision;
          }
          await appendProjectActivity(
            s.tx,
            pid,
            s.a.require(s.tx, pid, 'work.manage').actorId,
            'task.plan.applied',
            taskId,
            { kind: 'TASK', id: taskId },
          );
          if (o.estimatedMinutes !== undefined) {
            revision = (
              await this.work.estimate(s.tx, s.a, s, taskId, {
                revision,
                estimatedMinutes: o.estimatedMinutes,
              })
            ).sourceRevision;
          }
          if (o.schedule)
            await this.tasks.schedule(s.tx, s.a, pid, taskId, {
              revision,
              value: o.schedule,
            });
        }
        await s.tx.projectChangePlan.update({
          where: { id },
          data: {
            state: 'APPLIED',
            appliedAt: s.now,
            revision: { increment: 1 },
          },
        });
        if (created.length) {
          const metrics = await this.work.metrics(
            s.tx,
            s.a,
            pid,
            created.map((o) => o.task.id),
          );
          await s.tx.projectChangeSource.createMany({
            data: metrics.map((t) => ({
              ...projectWhere(s),
              planId: id,
              taskId: t.taskId,
              sourceRevision: t.sourceRevision,
              kind: 'CREATED',
            })),
          });
        }
        return this.plan(s, id);
      },
    );
  }
}
function zArray(value: unknown) {
  return c.ProjectChangePlanSchema.shape.operations.parse(value);
}
