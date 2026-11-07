import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedAuthority, SharedKernel } from '../../spaces/public/index.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { ProjectsService } from './projects.service.js';
/** Projects owns source links and their disposal. Financial anchors belong to Companies. */
@Injectable()
export class ProjectFinanceReferences {
  constructor(
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}
  hint(id: string) {
    return this.projects.hint(id);
  }
  async create(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    actor: RequestActor,
    company: { spaceId: string; scopeId: string; id: string },
    projectId: string,
  ) {
    const p = await tx.project.findUnique({ where: { id: projectId } });
    if (!p) throw new NotFoundException();
    const source = a.require(tx, p.spaceId, 'settings.manage');
    if (!['OWNER', 'ADMIN'].includes(source.role ?? ''))
      throw new ForbiddenException();
    a.require(tx, company.spaceId, 'task.read');
    await tx.companyProjectFinanceLink.create({
      data: {
        id: randomUUID(),
        spaceId: p.spaceId,
        scopeId: p.scopeId,
        projectId,
        companySpaceId: company.spaceId,
        companyScopeId: company.scopeId,
        referenceId: company.id,
        createdByActorId: source.actorId,
      },
    });
    await this.kernel.offerEffect(
      tx,
      actor,
      p.spaceId,
      source.actorId,
      'company.finance.reference',
      company.id,
      randomUUID(),
    );
  }
  async visible(
    actor: RequestActor,
    companySpaceId: string,
    referenceId: string,
  ) {
    const hint = await this.db.client.companyProjectFinanceLink.findFirst({
      where: { companySpaceId, referenceId },
    });
    if (!hint) return null;
    return this.kernel
      .run(
        actor,
        { userIds: [], spaceIds: [companySpaceId, hint.spaceId] },
        [
          {
            spaceId: companySpaceId,
            scopeId: companySpaceId,
            capability: 'task.read',
          },
        ],
        async (tx, a) => {
          if (!a.has(tx, hint.spaceId, 'task.read')) return null;
          const row = await tx.companyProjectFinanceLink.findFirst({
            where: { id: hint.id, companySpaceId, referenceId },
          });
          if (!row) return null;
          const p = await tx.project.findUnique({
            where: { id: row.projectId },
          });
          return p ? { id: p.id, title: p.title } : null;
        },
        undefined,
        [
          {
            spaceId: hint.spaceId,
            scopeId: hint.spaceId,
            capability: 'task.read',
          },
        ],
      )
      .catch((error: unknown) => {
        if (error instanceof NotFoundException) return null;
        throw error;
      });
  }
  async count(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
  ) {
    a.require(tx, spaceId, 'task.read');
    const n = await tx.companyProjectFinanceLink.count({
      where: { companySpaceId: spaceId },
    });
    if (n >= 100) throw new PayloadTooLargeException();
  }
}
