import {
  Inject,
  Injectable,
  ConflictException,
  PayloadTooLargeException,
  BadRequestException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedKernel } from '../../spaces/public/index.js';
import type { SharedRequest } from '../../spaces/public/index.js';
import { TeamProjects } from '../../projects/public/index.js';
import { TeamsService } from './teams.service.js';

@Injectable()
export class TeamAssociationsService {
  constructor(
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(TeamsService) private readonly teams: TeamsService,
    @Inject(TeamProjects) private readonly projects: TeamProjects,
  ) {}
  async command(
    actor: RequestActor,
    id: string,
    projectId: string,
    revision: number | undefined,
    input?:
      | z.infer<typeof c.TeamAssociationInputSchema>
      | z.infer<typeof c.TeamAssociationDecisionSchema>,
    key?: string,
  ) {
    await this.teams.hint(id);
    const project = await this.projects.hint(projectId);
    const request = (
      scopeId: string,
      capability: SharedRequest['capability'],
    ): SharedRequest => ({ spaceId: scopeId, scopeId, capability });
    const mutation = !!input,
      decision = input && 'decision' in input ? input.decision : undefined;
    const teamCap = mutation ? 'settings.manage' : 'task.read';
    const projectCap =
      decision && decision !== 'CANCEL' ? 'settings.manage' : 'task.read';
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [id, project.spaceId] },
      [
        request(id, 'task.read'),
        request(id, teamCap),
        request(projectId, 'task.read'),
        request(projectId, projectCap),
      ],
      async (tx, a) => {
        const body =
          input && 'action' in input
            ? c.TeamAssociationInputSchema.parse(input)
            : input
              ? c.TeamAssociationDecisionSchema.parse(input)
              : undefined;
        if (!body) return this.projects.associationView(tx, a, id, projectId);
        if ('action' in body) {
          if (!key || !/^[!-~]{1,128}$/.test(key))
            throw new BadRequestException();
          await this.kernel.receipt(
            tx,
            a,
            request(id, teamCap),
            {
              operation: 'team.project.association.request',
              key: a.require(tx, id, teamCap).generation + ':' + key,
              fingerprint: createHash('sha256')
                .update(JSON.stringify({ projectId, revision, body }))
                .digest('hex'),
            },
            async () => {
              await this.projects.requestAssociation(
                tx,
                a,
                actor,
                id,
                projectId,
                revision,
                body,
              );
              return { id: projectId, statusCode: 201 };
            },
          );
        } else
          await this.projects.reviewAssociation(
            tx,
            a,
            actor,
            id,
            projectId,
            revision!,
            body.decision,
          );
        return this.projects.associationView(tx, a, id, projectId);
      },
    );
  }
  async history(
    actor: RequestActor,
    id: string,
    projectId: string,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    await this.teams.hint(id);
    const p = await this.projects.hint(projectId);
    const request = {
      spaceId: id,
      scopeId: id,
      capability: 'task.read' as const,
    };
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [id, p.spaceId] },
      [
        request,
        { spaceId: p.spaceId, scopeId: projectId, capability: 'task.read' },
      ],
      async (tx, a) => {
        const cursor = this.kernel.scopeCursor(
          tx,
          a,
          request,
          'team-association-history:' + projectId,
        );
        const after = this.kernel.cursorPosition(
          cursor.context,
          cursor.stamp,
          actor.userId,
          q.after,
        );
        const rows = await this.projects.associationHistory(
          tx,
          a,
          id,
          projectId,
          after,
          q.limit,
        );
        return this.kernel.cursorPage(
          cursor.context,
          cursor.stamp,
          actor.userId,
          {
            items: rows.slice(0, q.limit),
            nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
          },
        );
      },
    );
  }
  async pending(
    actor: RequestActor,
    id: string,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    await this.teams.hint(id);
    const hints = await this.kernel.readableContextHints(actor, 'PROJECT');
    const refs = await this.projects.associationCandidates(id, hints.ids);
    if (refs.length > 100) throw new PayloadTooLargeException();
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [id, ...refs.map((r) => r.spaceId)] },
      [
        { spaceId: id, scopeId: id, capability: 'task.read' },
        { spaceId: id, scopeId: id, capability: 'settings.manage' },
        ...refs.map((r) => ({
          spaceId: r.spaceId,
          scopeId: r.projectId,
          capability: 'task.read' as const,
        })),
      ],
      async (tx, a) => {
        const cursor = this.kernel.scopeCursor(
          tx,
          a,
          { spaceId: id, scopeId: id, capability: 'settings.manage' },
          'team-associations:' + hints.stamp.slice(0, 24),
        );
        const after = this.kernel.cursorPosition(
          cursor.context,
          cursor.stamp,
          actor.userId,
          q.after,
        );
        const current = await this.projects.associationCandidates(
          id,
          hints.ids,
          tx,
        );
        if (JSON.stringify(current) !== JSON.stringify(refs))
          throw new ConflictException();
        const selected = current
            .filter((r) => !after || r.projectId > after)
            .slice(0, q.limit + 1),
          items = [];
        for (const r of selected.slice(0, q.limit))
          items.push(
            await this.projects.associationView(tx, a, id, r.projectId),
          );
        return this.kernel.cursorPage(
          cursor.context,
          cursor.stamp,
          actor.userId,
          {
            items,
            nextCursor:
              selected.length > q.limit
                ? selected[q.limit - 1]!.projectId
                : null,
          },
        );
      },
    );
  }
}
