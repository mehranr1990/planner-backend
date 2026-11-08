import type { SharedCleanupScope } from '../../../platform/lifecycle/shared-cleanup.js';
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
import { ProjectWorkMetricsService } from './project-work-metrics.service.js';
import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
import { ProjectsService } from './projects.service.js';
/** Projects owns source links and their disposal. Financial anchors belong to Companies. */
@Injectable()
export class ProjectFinanceReferences {
  constructor(
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(ProjectWorkMetricsService)
    private readonly metrics: ProjectWorkMetricsService,
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
    const source = a.require(
      tx,
      p.spaceId,
      'settings.manage',
      undefined,
      p.scopeId,
    );
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
      p.scopeId,
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
          if (!a.has(tx, hint.spaceId, 'task.read', undefined, hint.scopeId))
            return null;
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
            scopeId: hint.scopeId,
            capability: 'task.read',
          },
        ],
      )
      .catch((error: unknown) => {
        if (error instanceof NotFoundException) return null;
        throw error;
      });
  }
  async portfolioHints(companySpaceId: string, references: string[]) {
    if (references.length > 100) throw new PayloadTooLargeException();
    return this.db.client.companyProjectFinanceLink.findMany({
      where: { companySpaceId, referenceId: { in: references } },
      select: { spaceId: true, scopeId: true },
      take: 101,
    });
  }
  async portfolio(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    companySpaceId: string,
    references: string[],
    window: z.infer<typeof c.ProjectReportWindowSchema>,
    now: Date,
  ) {
    a.require(tx, companySpaceId, 'task.read');
    const rows = await tx.companyProjectFinanceLink.findMany({
      where: { companySpaceId, referenceId: { in: references } },
      orderBy: { referenceId: 'asc' },
      take: 101,
    });
    if (rows.length > 100) throw new PayloadTooLargeException();
    const result = [];
    for (const r of rows) {
      if (!a.has(tx, r.spaceId, 'task.read', undefined, r.scopeId)) continue;
      const p = await tx.project.findUnique({ where: { id: r.projectId } });
      if (!p) continue;
      result.push({
        referenceId: r.referenceId,
        projectId: p.id,
        title: p.title,
        report: await this.metrics.reportAuthorized(tx, a, p.id, window, now),
      });
    }
    return result;
  }
  async cleanupCompany(tx: Prisma.TransactionClient, s: SharedCleanupScope) {
    s.verify(tx);
    const deleted =
      await tx.$executeRaw`DELETE FROM "CompanyProjectFinanceLink" WHERE id IN (SELECT id FROM "CompanyProjectFinanceLink" WHERE "companySpaceId"=${s.spaceId}::uuid ORDER BY id LIMIT 200)`;
    return deleted === 0;
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
