import {
  Inject,
  Injectable,
  PayloadTooLargeException,
  ConflictException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedTasks } from '../../tasks/public/index.js';
import { SharedGoals } from '../../goals/public/index.js';
import {
  ProjectExecutionContext,
  projectWhere,
} from './project-execution-context.js';
import { ProjectContentService } from './project-content.service.js';
import { ProjectFilesService } from './project-files.service.js';
import { formulaCell } from '../domain/csv-import.js';
const cell = (v: string) =>
  '"' + (formulaCell(v) ? "'" + v : v).replaceAll('"', '""') + '"';
type ExportData = z.infer<typeof c.ProjectExportSchema>;
type Bucket = 'tasks' | 'goals' | 'documents' | 'comments' | 'files';
type Item = ExportData[Bucket][number];
function csvRecord(kind: Bucket, value: Item) {
  if (kind === 'tasks') {
    const { task: t } = value as ExportData['tasks'][number];
    return ['TASK', t.id, t.spaceId, t.title, t.description ?? '', t.status];
  }
  if (kind === 'goals') {
    const g = value as ExportData['goals'][number];
    return ['GOAL', g.id, g.spaceId, g.title, g.description ?? '', g.status];
  }
  if (kind === 'documents') {
    const d = value as ExportData['documents'][number];
    return ['DOCUMENT', d.id, d.projectId, d.title, d.body, 'ACTIVE'];
  }
  if (kind === 'comments') {
    const x = value as ExportData['comments'][number];
    return ['COMMENT', x.id, x.target.id, '', x.body, 'ACTIVE'];
  }
  const f = value as ExportData['files'][number];
  return ['FILE', f.id, f.target.id, f.filename, '', f.status];
}
@Injectable()
export class ProjectExportService {
  constructor(
    @Inject(ProjectExecutionContext)
    private readonly op: ProjectExecutionContext,
    @Inject(SharedTasks) private readonly tasks: SharedTasks,
    @Inject(SharedGoals) private readonly goals: SharedGoals,
    @Inject(ProjectContentService)
    private readonly content: ProjectContentService,
    @Inject(ProjectFilesService) private readonly files: ProjectFilesService,
  ) {}
  async build(
    actor: RequestActor,
    pid: string,
    input: z.infer<typeof c.ProjectExportInputSchema>,
  ) {
    const built = await this.op.read(
      actor,
      pid,
      ['export.visible', 'file.read'],
      undefined,
      async (s) => {
        const bounds = await this.op.kernel.exportBounds(s.tx, s.a, pid),
          links = await s.tx.projectTask.findMany({
            where: projectWhere(s),
            take: 10001,
            orderBy: { taskId: 'asc' },
          }),
          goalLinks = await s.tx.projectGoal.findMany({
            where: projectWhere(s),
            take: 10001,
            orderBy: { goalId: 'asc' },
          });
        if (
          links.length > bounds.maxRecords ||
          goalLinks.length > bounds.maxRecords
        )
          throw new PayloadTooLargeException();
        const header =
          ['kind', 'id', 'parentId', 'title', 'text', 'status']
            .map(cell)
            .join(',') + '\r\n';
        const empty = {
          schemaVersion: 1,
          projectId: pid,
          generatedAt: s.now.toISOString(),
          tasks: [],
          goals: [],
          documents: [],
          comments: [],
          files: [],
        };
        let used = Buffer.byteLength(
            input.format === 'JSON' ? JSON.stringify(empty) : header,
          ),
          records = 0;
        const counts: Record<Bucket, number> = {
          tasks: 0,
          goals: 0,
          documents: 0,
          comments: 0,
          files: 0,
        };
        const accept = (bucket: Bucket, item: Item) => {
          used +=
            Buffer.byteLength(
              input.format === 'JSON'
                ? JSON.stringify(item)
                : csvRecord(bucket, item).map(cell).join(',') + '\r\n',
            ) + (input.format === 'JSON' && counts[bucket] > 0 ? 1 : 0);
          counts[bucket]++;
          if (++records > bounds.maxRecords || used > bounds.maxBytes)
            throw new PayloadTooLargeException();
        };
        const tasks: ExportData['tasks'] = [],
          goals: ExportData['goals'] = [];
        let after: string | undefined;
        for (;;) {
          const rows = await this.tasks.project(
            s.tx,
            s.a,
            links.map((r) => ({ spaceId: pid, id: r.taskId })),
            { limit: 100, ...(after ? { after } : {}) },
          );
          for (const r of rows) {
            accept('tasks', r);
            tasks.push(r);
          }
          if (rows.length < 100) break;
          after = rows.at(-1)!.task.id;
        }
        after = undefined;
        for (;;) {
          const rows = await this.goals.project(
            s.tx,
            s.a,
            goalLinks.map((r) => ({ spaceId: pid, id: r.goalId })),
            { limit: 100, ...(after ? { after } : {}) },
          );
          for (const r of rows) {
            accept('goals', r);
            goals.push(r);
          }
          if (rows.length < 100) break;
          after = rows.at(-1)!.id;
        }
        const documents = await this.content.exportDocuments(s, (r) =>
          accept('documents', r),
        );
        const visible = {
            tasks: tasks.map((r) => r.task.id),
            goals: goals.map((r) => r.id),
            documents: documents.map((r) => r.id),
          },
          comments = await this.content.exportComments(s, visible, (r) =>
            accept('comments', r),
          ),
          files = await this.files.exportMetadata(s, visible, (r) =>
            accept('files', r),
          );
        const result = c.ProjectExportSchema.parse({
          schemaVersion: 1,
          projectId: pid,
          generatedAt: s.now.toISOString(),
          tasks,
          goals,
          documents,
          comments,
          files,
        });
        if (
          tasks.length +
            goals.length +
            documents.length +
            comments.length +
            files.length >
          bounds.maxRecords
        )
          throw new PayloadTooLargeException();
        let body: string;
        if (input.format === 'JSON') body = JSON.stringify(result);
        else {
          const rows: string[][] = [];
          for (const bucket of [
            'tasks',
            'goals',
            'documents',
            'comments',
            'files',
          ] as const)
            for (const item of result[bucket])
              rows.push(csvRecord(bucket, item));
          body =
            header + rows.map((r) => r.map(cell).join(',') + '\r\n').join('');
        }
        if (Buffer.byteLength(body, 'utf8') > bounds.maxBytes)
          throw new PayloadTooLargeException();
        return { body, version: bounds.authorizationVersion };
      },
    );
    // Inline delivery retains no export artifact. Publication/download share this fresh fenced check.
    await this.op.write(
      actor,
      pid,
      ['export.visible', 'file.read'],
      undefined,
      'export.publish',
      pid,
      [],
      async (s) => {
        const current = await this.op.kernel.exportBounds(s.tx, s.a, pid);
        if (current.authorizationVersion !== built.version)
          throw new ConflictException({ code: 'EXPORT_SOURCE_CHANGED' });
        await s.begin();
      },
    );
    return {
      body: built.body,
      mimeType:
        input.format === 'JSON'
          ? 'application/json'
          : 'text/csv; charset=utf-8',
      filename: 'project.' + (input.format === 'JSON' ? 'json' : 'csv'),
    };
  }
}
