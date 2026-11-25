import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AdminCommand } from '../../../platform/admin/admin-command.js';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { Team, Prisma } from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import {
  SharedKernel,
  TeamCustodyTransfer,
  SharedAuthority,
  CollaborationService,
  ordinaryCapabilities,
  fixedCapabilities,
} from '../../spaces/public/index.js';
import type { SharedRequest } from '../../spaces/public/index.js';
import { TeamProjects } from '../../projects/public/index.js';
import { TeamCustodyGraph } from './teams-custody-graph.js';
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
type Page = z.infer<typeof c.TeamPageQuerySchema>;
@Injectable()
export class TeamsService {
  async adminDelete<T extends Prisma.InputJsonValue>(
    command: AdminCommand,
    id: string,
    authorize: (tx: Prisma.TransactionClient) => Promise<{
      revision: number;
      fingerprint: string;
      recoveryDays: number;
    }>,
    complete: (tx: Prisma.TransactionClient, jobId: string) => Promise<T>,
  ) {
    return this.kernel.administer(
      command,
      id,
      [],
      async (tx, attribution, audit, locked) => {
        const input = await authorize(tx),
          row = await tx.team.findUniqueOrThrow({ where: { id } });
        if (row.revision !== input.revision)
          throw new ConflictException({ code: 'STALE_REVISION' });
        const job = await this.kernel.adminCloseInside(
          tx,
          command,
          id,
          input,
          attribution,
          audit,
          locked,
        );
        await tx.team.update({
          where: { id },
          data: { revision: { increment: 1 }, updatedAt: new Date() },
        });
        return complete(tx, job.jobId);
      },
      { action: 'workspace.delete', resourceId: id },
    );
  }
  async adminCreate(
    command: AdminCommand,
    ownerUserId: string,
    input: {
      id: string;
      title: string;
      description?: string | undefined;
      retentionPolicyVersion: string;
    },
  ) {
    command.require('admin.workspaces.create');
    await this.kernel.provision(
      {
        userId: ownerUserId,
        requestId: command.requestId,
        correlationId: command.requestId,
      },
      input.id,
      input.retentionPolicyVersion,
      async (tx, b) => {
        await tx.team.create({
          data: {
            id: input.id,
            spaceId: b.spaceId,
            scopeId: b.scopeId,
            createdByActorId: b.actorId,
            title: input.title,
            description: input.description ?? null,
            creationKey: hash(command.key),
            creationFingerprint: hash(input),
          },
        });
        await tx.adminDelivery.create({
          data: {
            auditId: command.auditId,
            targetUserId: ownerUserId,
            kind: 'WORKSPACE_CREATED',
            payload: { workspaceId: input.id },
          },
        });
      },
      'TEAM',
      [],
      [],
      command,
    );
    return { id: input.id };
  }
  async adminProfile(
    tx: Prisma.TransactionClient,
    command: AdminCommand,
    id: string,
    input: {
      revision: number;
      title: string;
      description?: string | undefined;
    },
  ) {
    command.require('admin.workspaces.update');
    await command.verify(tx);
    const before = await tx.team.findUniqueOrThrow({ where: { id } });
    if (before.revision !== input.revision) throw new ConflictException();
    const after = await tx.team.update({
      where: { id, revision: input.revision },
      data: {
        title: input.title,
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        revision: { increment: 1 },
      },
    });
    return {
      before: { title: before.title, description: before.description },
      after: { title: after.title, description: after.description },
      revision: after.revision,
    };
  }
  adminMetadata(tx: Prisma.TransactionClient, id: string) {
    return tx.team.findUnique({
      where: { id },
      select: { title: true, description: true, revision: true },
    });
  }
  constructor(
    @Inject(TeamCustodyGraph) private readonly custodyGraph: TeamCustodyGraph,
    @Inject(TeamCustodyTransfer)
    private readonly transfers: TeamCustodyTransfer,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(CollaborationService) readonly collaboration: CollaborationService,
    @Inject(TeamProjects) private readonly projects: TeamProjects,
  ) {}
  private custodySource(id: string) {
    return {
      snapshot: async (
        tx: Prisma.TransactionClient,
        companyId: string,
        transferId: string,
      ): Promise<Prisma.InputJsonValue> => {
        const row = await tx.team.findUnique({ where: { id } });
        if (!row || row.spaceId !== id || row.scopeId !== id)
          throw new ConflictException({
            code: 'TEAM_CUSTODY_REQUIRES_INDEPENDENT_TEAM',
          });
        const graph = await this.custodyGraph.snapshot(tx, {
          sourceSpaceId: id,
          destinationSpaceId: companyId,
          transferId,
          verify: (database, moving) => {
            if (database !== tx || moving) throw new ForbiddenException();
          },
        });
        return JSON.parse(JSON.stringify(graph)) as Prisma.InputJsonValue;
      },
      move: async (
        tx: Prisma.TransactionClient,
        companyId: string,
        transferId: string,
      ) => {
        await this.custodyGraph.move(tx, {
          sourceSpaceId: id,
          destinationSpaceId: companyId,
          transferId,
          verify: (database, moving) => {
            if (database !== tx || !moving) throw new ForbiddenException();
          },
        });
      },
    };
  }
  custodyPreview(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.TeamCustodyPreviewSchema>,
    key: string | undefined,
  ) {
    return this.transfers.preview(
      actor,
      id,
      c.TeamCustodyPreviewSchema.parse(input),
      key,
      this.custodySource(id),
    );
  }
  custodyConsent(
    actor: RequestActor,
    id: string,
    transferId: string,
    input: z.infer<typeof c.TeamCustodyConsentSchema>,
  ) {
    return this.transfers.consent(
      actor,
      id,
      transferId,
      c.TeamCustodyConsentSchema.parse(input),
    );
  }
  custodyApply(
    actor: RequestActor,
    id: string,
    transferId: string,
    input: z.infer<typeof c.TeamCustodyApplySchema>,
  ) {
    return this.transfers.apply(
      actor,
      id,
      transferId,
      c.TeamCustodyApplySchema.parse(input),
      this.custodySource(id),
    );
  }
  private cursor(
    context: string,
    stamp: string,
    userId: string,
    after: string,
  ) {
    return this.kernel.cursorPage(context, stamp, userId, {
      items: [],
      nextCursor: after,
    }).nextCursor;
  }
  async hint(id: string) {
    this.kernel.assertEnabled();
    const row = await this.db.client.team.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    return row;
  }
  private request(
    id: string,
    capability: SharedRequest['capability'] = 'task.read',
  ): SharedRequest {
    return {
      spaceId: id,
      scopeId: id,
      capability,
      allowArchived: capability === 'task.read',
    };
  }
  private async view(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    row: Team,
  ) {
    const state = await this.kernel.contextState(tx, a, row.spaceId, row.id);
    return c.TeamSchema.strip().parse({
      ...row,
      state,
      association: await this.kernel.contextAssociation(
        tx,
        a,
        row.spaceId,
        row.scopeId,
      ),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  async create(
    actor: RequestActor,
    input: z.infer<typeof c.TeamCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.TeamCreateSchema.parse(input);
    if (!key || !/^[!-~]{1,128}$/.test(key)) throw new BadRequestException();
    const creationKey = hash(key),
      creationFingerprint = hash(body);
    try {
      await this.kernel.provision(
        actor,
        body.id,
        body.retentionPolicyVersion,
        async (tx, b) => {
          await tx.team.create({
            data: {
              id: body.id,
              spaceId: b.spaceId,
              scopeId: b.scopeId,
              createdByActorId: b.actorId,
              title: body.title,
              description: body.description ?? null,
              creationKey,
              creationFingerprint,
            },
          });
          await this.kernel.offerEffect(
            tx,
            actor,
            b.spaceId,
            b.actorId,
            'team.create',
            body.id,
            randomUUID(),
          );
        },
        'TEAM',
      );
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
    }
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [body.id] },
      [this.request(body.id)],
      async (tx, a) => {
        const row = await tx.team.findUnique({ where: { id: body.id } });
        if (
          !row ||
          row.creationKey !== creationKey ||
          row.creationFingerprint !== creationFingerprint ||
          !(await this.kernel.creatorIs(tx, row.createdByActorId, actor.userId))
        )
          throw new ConflictException();
        return this.view(tx, a, row);
      },
    );
  }
  async read(actor: RequestActor, id: string) {
    await this.hint(id);
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [id] },
      [this.request(id)],
      async (tx, a) =>
        this.view(tx, a, await tx.team.findUniqueOrThrow({ where: { id } })),
    );
  }
  async accessMe(actor: RequestActor, id: string) {
    await this.hint(id);
    const catalog = [...ordinaryCapabilities, ...fixedCapabilities];
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [id] },
      [this.request(id)],
      async (tx, a) => {
        const access = a.require(tx, id, 'task.read');
        const capabilities: string[] = catalog.filter((cap) =>
          a.has(tx, id, cap),
        );
        if ((await this.kernel.contextState(tx, a, id, id)) === 'ACTIVE') {
          if (['OWNER', 'ADMIN'].includes(access.role ?? ''))
            capabilities.push('conversation.create');
          if (['OWNER', 'ADMIN', 'LEAD'].includes(access.role ?? ''))
            capabilities.push('announcement.publish');
          // Mirrors meeting source management: role and work.manage.
          if (
            ['OWNER', 'ADMIN', 'LEAD'].includes(access.role ?? '') &&
            capabilities.includes('work.manage')
          )
            capabilities.push('meeting.create');
        }
        return c.ScopeAccessMeSchema.strip().parse({ ...access, capabilities });
      },
      undefined,
      catalog.map((capability) => ({
        ...this.request(id, capability),
        allowArchived: [
          'task.read',
          'file.read',
          'custody.archive',
          'custody.accept',
        ].includes(capability),
      })),
      true,
    );
  }
  async patch(
    actor: RequestActor,
    id: string,
    revision: number,
    body: z.infer<typeof c.TeamPatchSchema>,
  ) {
    await this.hint(id);
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [id] },
      [this.request(id), this.request(id, 'settings.manage')],
      async (tx, a) => {
        const prior = await tx.team.findUniqueOrThrow({ where: { id } });
        if (prior.revision !== revision) throw new ConflictException();
        const patch = c.TeamPatchSchema.parse(body);
        const row = await tx.team.update({
          where: { id },
          data: {
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.description !== undefined
              ? { description: patch.description }
              : {}),
            revision: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        await this.kernel.offerEffect(
          tx,
          actor,
          id,
          a.require(tx, id, 'settings.manage').actorId,
          'team.update',
          id,
          randomUUID(),
        );
        return this.view(tx, a, row);
      },
    );
  }
  async list(actor: RequestActor, q: Page) {
    const hints = await this.kernel.readableContextHints(actor, 'TEAM');
    const position = this.kernel.cursorPosition(
      'teams',
      hints.stamp,
      actor.userId,
      q.after,
    );
    if (!hints.ids.length) return { items: [], nextCursor: null };
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: hints.ids },
      hints.ids.map((id) => this.request(id)),
      async (tx, a) => {
        const rows = await tx.team.findMany({
          where: {
            id: { in: hints.ids, ...(position ? { gt: position } : {}) },
          },
          orderBy: { id: 'asc' },
          take: q.limit + 1,
        });
        const items = await Promise.all(
          rows.slice(0, q.limit).map((row) => this.view(tx, a, row)),
        );
        return {
          items,
          nextCursor:
            rows.length > q.limit
              ? this.cursor(
                  'teams',
                  hints.stamp,
                  actor.userId,
                  items.at(-1)!.id,
                )
              : null,
        };
      },
    );
  }
  async members(actor: RequestActor, id: string, q: Page) {
    await this.hint(id);
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [id] },
      [this.request(id)],
      async (tx, a) => {
        const access = a.require(tx, id, 'task.read');
        const rows = await this.kernel.currentMemberships(tx, a, id);
        const stamp = hash([
          String(access.authorizationVersion),
          access.generation,
          rows.map((r) => [r.id, r.revision, r.generation]),
        ]);
        const after = this.kernel.cursorPosition(
          'team-members:' + id,
          stamp,
          actor.userId,
          q.after,
        );
        const selected = rows
          .filter((r) => !after || r.id > after)
          .slice(0, q.limit + 1);
        const items = await Promise.all(
          selected.slice(0, q.limit).map(async (row) => ({
            ...(await this.collaboration.memberView(tx, row)),
            displayName: await this.collaboration.displayName(
              tx,
              access.spaceId,
              row.actorId,
            ),
          })),
        );
        return c.TeamMembershipPageSchema.parse({
          items,
          nextCursor:
            selected.length > q.limit
              ? this.cursor(
                  'team-members:' + id,
                  stamp,
                  actor.userId,
                  items.at(-1)!.id,
                )
              : null,
        });
      },
    );
  }
  /** Owner-only, signed pages over the shared handover history. */
  async handovers(actor: RequestActor, id: string, q: Page) {
    await this.hint(id);
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [id] },
      [this.request(id, 'custody.handover')],
      async (tx, a) => {
        const access = a.require(tx, id, 'custody.handover'),
          context = 'team-handovers:' + id,
          stamp = hash([
            String(access.authorizationVersion),
            access.generation,
          ]),
          rows = await this.collaboration.handoverPage(
            tx,
            a,
            id,
            this.kernel.cursorPosition(context, stamp, actor.userId, q.after),
            q.limit,
          ),
          items = rows.slice(0, q.limit);
        return c.TeamHandoverPageSchema.parse({
          items,
          nextCursor:
            rows.length > q.limit
              ? this.cursor(context, stamp, actor.userId, items.at(-1)!.id)
              : null,
        });
      },
    );
  }
  async projectList(actor: RequestActor, id: string, q: Page) {
    await this.hint(id);
    const hints = await this.kernel.readableContextHints(actor);
    const candidates = await this.projects.candidates(id, hints.ids);
    const requests = [
      this.request(id),
      ...candidates.map((r) => ({
        ...this.request(r.projectId),
        allowArchived: true,
      })),
    ];
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [id, ...candidates.map((r) => r.projectId)] },
      requests,
      async (tx, a) => {
        const rows = await this.projects.list(
          tx,
          a,
          id,
          candidates.map((r) => r.projectId),
        );
        const access = a.require(tx, id, 'task.read');
        const stamp = hash([
          hints.stamp,
          String(access.authorizationVersion),
          access.generation,
          rows.map((r) => [r.link.projectId, r.link.revision]),
        ]);
        const after = this.kernel.cursorPosition(
          'team-projects:' + id,
          stamp,
          actor.userId,
          q.after,
        );
        const selected = rows
          .filter((r) => !after || r.project.id > after)
          .slice(0, q.limit + 1);
        return c.TeamProjectPageSchema.parse({
          items: selected.slice(0, q.limit),
          nextCursor:
            selected.length > q.limit
              ? this.cursor(
                  'team-projects:' + id,
                  stamp,
                  actor.userId,
                  selected[q.limit - 1]!.project.id,
                )
              : null,
        });
      },
    );
  }
  async reference(
    actor: RequestActor,
    id: string,
    projectId: string,
    revision: number | undefined,
    active: boolean,
  ) {
    await this.hint(id);
    const project = await this.projects.hint(projectId);
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [id, project.spaceId] },
      [
        this.request(id, 'settings.manage'),
        this.request(project.scopeId, 'settings.manage'),
      ],
      (tx, a) =>
        this.projects.reference(tx, a, actor, id, projectId, revision, active),
    );
  }
}
