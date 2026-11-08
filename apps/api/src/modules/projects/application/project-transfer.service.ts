import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { ProjectTransfer } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { AuthService } from '../../../platform/auth/auth.service.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { SpacesService } from '../../spaces/public/index.js';
import { PersonalTaskTransfer } from '../../tasks/public/index.js';
import { PersonalGoalTransfer } from '../../goals/public/index.js';
import {
  ProjectExecutionContext,
  projectWhere,
  executionKey,
  executionHash,
  matchRevision,
} from './project-execution-context.js';
import type { ExecutionContext } from './project-execution-context.js';
import { appendProjectActivity } from './project-activity.js';
type Manifest = z.infer<typeof c.ProjectTransferManifestSchema>;
const view = (r: ProjectTransfer, now: Date) =>
  c.ProjectTransferSchema.parse({
    id: r.id,
    projectId: r.projectId,
    state:
      ['PREVIEWED', 'ACCEPTED'].includes(r.state) && r.expiresAt <= now
        ? 'EXPIRED'
        : r.state,
    revision: r.revision,
    manifest: r.manifest,
    manifestHash: r.manifestHash,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    acceptedAt: r.acceptedAt?.toISOString() ?? null,
    appliedAt: r.appliedAt?.toISOString() ?? null,
  });
@Injectable()
export class ProjectTransferService {
  constructor(
    @Inject(ProjectExecutionContext)
    private readonly op: ProjectExecutionContext,
    @Inject(SpacesService) private readonly spaces: SpacesService,
    @Inject(PersonalTaskTransfer) private readonly tasks: PersonalTaskTransfer,
    @Inject(PersonalGoalTransfer) private readonly goals: PersonalGoalTransfer,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  private async row(s: ExecutionContext, id: string) {
    const a = s.a.require(s.tx, s.pid, 'custody.transfer'),
      row = await s.tx.projectTransfer.findFirst({
        where: {
          ...projectWhere(s),
          id,
          creatorAccessId: a.accessId,
          creatorGeneration: a.generation,
        },
      });
    if (!row) throw new NotFoundException();
    return row;
  }
  private async graph(
    s: ExecutionContext,
    source: AuthorizedSpace,
    m: Pick<Manifest, 'tasks' | 'goals' | 'consent'>,
  ) {
    if (s.spaceId !== s.pid)
      throw new ConflictException({
        code: 'PERSONAL_TO_COMPANY_TRANSFER_NOT_APPROVED',
      });
    const candidates = [
      ...(await this.tasks.preview(s.tx, source, m.tasks, m.consent)),
      ...(await this.goals.preview(s.tx, source, m.goals, m.consent)),
    ];
    if (candidates.reduce((n, c) => n + c.children + c.history, 0) > 2000)
      for (const candidate of candidates) {
        candidate.blockers.push('BATCH_GRAPH_LIMIT');
        candidate.nodes = candidate.nodes.slice(0, 1);
      }
    return candidates;
  }
  private async compare(
    s: ExecutionContext,
    row: ProjectTransfer,
    source: AuthorizedSpace,
  ) {
    const m = c.ProjectTransferManifestSchema.parse(row.manifest);
    if (
      !row.sourceSpaceId ||
      source.spaceId !== row.sourceSpaceId ||
      source.spaceId !== m.sourceCustody.id ||
      row.expiresAt <= s.now
    )
      throw new ConflictException({
        code: 'TRANSFER_EXPIRED_OR_SOURCE_UNAVAILABLE',
      });
    if (
      row.authorizationVersion !==
      s.a.require(s.tx, s.pid, 'custody.transfer').authorizationVersion
    )
      throw new ConflictException({ code: 'TRANSFER_AUTHORITY_CHANGED' });
    const candidates = await this.graph(s, source, m);
    if (executionHash(candidates) !== executionHash(m.candidates))
      throw new ConflictException({ code: 'TRANSFER_GRAPH_CHANGED' });
    if (candidates.some((r) => r.blockers.length))
      throw new ConflictException({ code: 'UNSUPPORTED_TRANSFER_GRAPH' });
    return m;
  }
  async preview(
    actor: RequestActor,
    pid: string,
    input: z.infer<typeof c.ProjectTransferPreviewInputSchema>,
    raw?: string,
  ) {
    const source = await this.spaces.authorizePersonal(actor),
      key = executionKey(raw),
      fingerprint = executionHash(input);
    return this.op.write(
      actor,
      pid,
      ['custody.transfer'],
      undefined,
      'transfer.preview',
      input.id,
      [],
      async (s) => {
        const a = s.a.require(s.tx, pid, 'custody.transfer'),
          prior = await s.tx.projectTransfer.findFirst({
            where: {
              ...projectWhere(s),
              creatorAccessId: a.accessId,
              creatorGeneration: a.generation,
              creationKey: key,
            },
          });
        if (prior) {
          if (prior.id !== input.id || prior.fingerprint !== fingerprint)
            throw new ConflictException();
          return view(prior, s.now);
        }
        const candidates = await this.graph(s, source, input),
          manifest = c.ProjectTransferManifestSchema.parse({
            sourceCustody: { kind: 'PERSONAL', id: source.spaceId },
            destinationCustody: {
              kind: 'SHARED_PROJECT',
              id: pid,
              scopeId: pid,
            },
            creatorAccessId: a.accessId,
            creatorGeneration: a.generation,
            authorizationVersion: String(a.authorizationVersion),
            tasks: input.tasks,
            goals: input.goals,
            consent: input.consent,
            candidates,
          });
        await s.begin();
        const row = await s.tx.projectTransfer.create({
          data: {
            id: input.id,
            ...projectWhere(s),
            sourceCustodyId: source.spaceId,
            sourceSpaceId: source.spaceId,
            creatorAccessId: a.accessId,
            creatorGeneration: a.generation,
            createdByActorId: a.actorId,
            authorizationVersion: a.authorizationVersion + 1n,
            manifest,
            manifestHash: executionHash(manifest),
            createdAt: s.now,
            expiresAt: new Date(s.now.getTime() + 1800000),
            creationKey: key,
            fingerprint,
          },
        });
        return view(row, s.now);
      },
    );
  }
  get(actor: RequestActor, pid: string, id: string) {
    return this.op.read(
      actor,
      pid,
      ['custody.transfer'],
      undefined,
      async (s) => view(await this.row(s, id), s.now),
    );
  }
  async accept(
    actor: RequestActor,
    pid: string,
    id: string,
    expected: number,
    manifestHash: string,
  ) {
    const source = await this.spaces.authorizePersonal(actor);
    return this.op.write(
      actor,
      pid,
      ['custody.transfer'],
      undefined,
      'transfer.accept',
      id,
      [],
      async (s) => {
        const row = await this.row(s, id);
        matchRevision(row.revision, expected);
        if (row.state !== 'PREVIEWED' || row.manifestHash !== manifestHash)
          throw new ConflictException();
        await this.compare(s, row, source);
        await s.begin();
        return view(
          await s.tx.projectTransfer.update({
            where: { id },
            data: {
              state: 'ACCEPTED',
              revision: { increment: 1 },
              acceptedAt: s.now,
              authorizationVersion:
                s.a.require(s.tx, pid, 'custody.transfer')
                  .authorizationVersion + 1n,
            },
          }),
          s.now,
        );
      },
    );
  }
  async apply(
    actor: RequestActor,
    pid: string,
    id: string,
    expected: number,
    input: z.infer<typeof c.ProjectTransferApplySchema>,
    raw?: string,
  ) {
    const source = await this.spaces.authorizePersonal(actor),
      key = executionKey(raw),
      hint = await this.get(actor, pid, id),
      caps: Parameters<ProjectExecutionContext['write']>[2] = [
        'custody.transfer',
      ];
    if (hint.manifest.tasks.length) caps.push('task.create');
    if (hint.manifest.goals.length) caps.push('goal.manage');
    return this.op.write(
      actor,
      pid,
      caps,
      undefined,
      'transfer.apply',
      id,
      [],
      async (s) => {
        const row = await this.row(s, id);
        if (row.manifestHash !== input.manifestHash)
          throw new ConflictException();
        await this.auth.verifyPasswordInside(
          s.tx,
          actor.userId,
          input.password,
        );
        if (row.state === 'APPLIED') {
          if (row.applyKeyHash !== key || row.revision !== expected + 2)
            throw new ConflictException();
          return view(row, s.now);
        }
        matchRevision(row.revision, expected);
        if (row.state !== 'ACCEPTED') throw new ConflictException();
        const manifest = await this.compare(s, row, source);
        if (manifest.tasks.length)
          await s.grow('task.shared', manifest.tasks.length);
        if (manifest.goals.length)
          await s.grow('goal.shared', manifest.goals.length);
        await s.begin();
        await s.tx.projectTransfer.update({
          where: { id },
          data: {
            state: 'APPLYING',
            revision: { increment: 1 },
            reauthenticatedAt: s.now,
            applyKeyHash: key,
          },
        });
        // Source owners execute in the approved order; no private reference is unlinked implicitly.
        if (manifest.tasks.length)
          await this.tasks.apply(s.tx, source, s.a, pid, manifest.tasks, s.now);
        if (manifest.goals.length)
          await this.goals.apply(s.tx, source, s.a, pid, manifest.goals, s.now);
        for (const task of manifest.tasks)
          await s.tx.projectTask.create({
            data: { ...projectWhere(s), taskId: task.id },
          });
        for (const goal of manifest.goals)
          await s.tx.projectGoal.create({
            data: { ...projectWhere(s), goalId: goal.id },
          });
        const actorId = s.a.require(s.tx, pid, 'custody.transfer').actorId;
        for (const task of manifest.tasks)
          await appendProjectActivity(
            s.tx,
            pid,
            actorId,
            'task.custody.transferred',
            task.id,
            { kind: 'TASK', id: task.id },
          );
        for (const goal of manifest.goals)
          await appendProjectActivity(
            s.tx,
            pid,
            actorId,
            'goal.custody.transferred',
            goal.id,
            { kind: 'GOAL', id: goal.id },
          );
        return view(
          await s.tx.projectTransfer.update({
            where: { id },
            data: {
              state: 'APPLIED',
              revision: { increment: 1 },
              appliedAt: s.now,
            },
          }),
          s.now,
        );
      },
    );
  }
  cancel(actor: RequestActor, pid: string, id: string, expected: number) {
    return this.op.write(
      actor,
      pid,
      ['custody.transfer'],
      undefined,
      'transfer.cancel',
      id,
      [],
      async (s) => {
        const row = await this.row(s, id);
        matchRevision(row.revision, expected);
        if (!['PREVIEWED', 'ACCEPTED'].includes(row.state))
          throw new ConflictException();
        await s.begin();
        return view(
          await s.tx.projectTransfer.update({
            where: { id },
            data: {
              state: row.expiresAt <= s.now ? 'EXPIRED' : 'CANCELED',
              revision: { increment: 1 },
            },
          }),
          s.now,
        );
      },
    );
  }
}
