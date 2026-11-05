import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedAuthority, SharedKernel } from '../../spaces/public/index.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { ProjectsService } from './projects.service.js';
@Injectable()
export class TeamProjects {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}
  async hint(id: string) {
    return this.projects.hint(id);
  }
  async candidates(teamId: string, visibleIds: string[]) {
    return this.db.client.teamProjectReference.findMany({
      where: { teamId, active: true, spaceId: { in: visibleIds } },
      orderBy: { projectId: 'asc' },
    });
  }
  async list(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    teamId: string,
    visibleIds: string[],
  ) {
    a.require(tx, teamId, 'task.read');
    const rows = await tx.teamProjectReference.findMany({
      where: { teamId, active: true, spaceId: { in: visibleIds } },
      orderBy: { projectId: 'asc' },
    });
    const result = [];
    for (const row of rows) {
      a.require(tx, row.spaceId, 'task.read');
      const project = await tx.project.findUniqueOrThrow({
        where: { id: row.projectId },
      });
      result.push({
        link: {
          teamId,
          projectId: row.projectId,
          revision: row.revision,
          active: row.active,
        },
        project: await this.projects.view(tx, project, a),
      });
    }
    return result;
  }
  async reference(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    actor: RequestActor,
    teamId: string,
    projectId: string,
    revision: number | undefined,
    active: boolean,
  ) {
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException();
    const ta = a.require(tx, teamId, 'settings.manage');
    const pa = a.require(tx, project.spaceId, 'settings.manage');
    const prior = await tx.teamProjectReference.findUnique({
      where: { teamId_projectId: { teamId, projectId } },
    });
    if (prior?.active && active && revision === undefined)
      return { teamId, projectId, revision: prior.revision, active: true };
    if (prior ? revision !== prior.revision : revision !== undefined || !active)
      throw new ConflictException();
    if (!prior)
      await this.kernel.featureGrowth(tx, teamId, 'team.project-reference');
    const row = prior
      ? await tx.teamProjectReference.update({
          where: { teamId_projectId: { teamId, projectId } },
          data: { active, revision: { increment: 1 } },
        })
      : await tx.teamProjectReference.create({
          data: { teamId, projectId, spaceId: project.spaceId },
        });
    for (const access of [ta, pa])
      await this.kernel.offerEffect(
        tx,
        actor,
        access.spaceId,
        access.actorId,
        active ? 'team.project.reference' : 'team.project.unreference',
        projectId,
        randomUUID(),
        !prior && access.spaceId === teamId
          ? { actorId: ta.actorId, feature: 'team.project-reference', delta: 1 }
          : undefined,
      );
    return { teamId, projectId, revision: row.revision, active: row.active };
  }
}
