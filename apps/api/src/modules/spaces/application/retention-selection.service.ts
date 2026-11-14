import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type {
  Prisma,
  SharedRetentionPolicy,
} from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedKernel } from './shared-kernel.service.js';
import { CollaborationService } from './collaboration.service.js';
import { SharedRetentionSchema } from './shared-retention.js';
import { retentionTransition } from './retention-transition.js';
type Policy = z.infer<typeof SharedRetentionSchema>;
const contexts = c.RetentionContextSchema.options as readonly string[];
/**
 * OD-1/R1/R2 (owner-approved): Space Managers select from the immutable,
 * operator-approved catalog only; after creation retention may only grow.
 * Holds, obligations, holds-based lifecycle evidence and Company custody
 * plans keep their existing guards; nothing is deleted or rewritten here.
 */
@Injectable()
export class RetentionSelectionService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(CollaborationService)
    private readonly collaboration: CollaborationService,
  ) {}
  private parse(row: SharedRetentionPolicy | null) {
    const parsed = row && SharedRetentionSchema.safeParse(row.configuration);
    return parsed?.success && parsed.data.policyVersion === row!.version
      ? { policy: parsed.data, createdAt: row!.createdAt }
      : null;
  }
  private summary(p: { policy: Policy; createdAt: Date }) {
    const rule = (k: keyof Policy['classRules']) => ({
      retainAfterClosureSeconds:
        p.policy.classRules[k].retainAfterClosureSeconds,
      disposalAction: p.policy.classRules[k].disposalAction,
    });
    return c.RetentionPolicySummarySchema.parse({
      version: p.policy.policyVersion,
      applicableContexts: p.policy.applicableContexts,
      marketScope: p.policy.marketScope,
      classRules: {
        workContent: rule('workContent'),
        commentsHistory: rule('commentsHistory'),
        filesDerivatives: rule('filesDerivatives'),
        exports: rule('exports'),
        accessAuditLifecycle: rule('accessAuditLifecycle'),
      },
      createdAt: p.createdAt.toISOString(),
    });
  }
  private async policy(tx: Prisma.TransactionClient, version: string) {
    const p = this.parse(
      await tx.sharedRetentionPolicy.findUnique({ where: { version } }),
    );
    if (!p) throw new NotFoundException();
    return p;
  }
  /** Applicable catalog entries; holds and obligations are never disclosed. */
  async catalog(query: z.infer<typeof c.RetentionPolicyCatalogQuerySchema>) {
    this.kernel.assertEnabled();
    const q = c.RetentionPolicyCatalogQuerySchema.parse(query);
    const rows = await this.db.client.sharedRetentionPolicy.findMany({
      orderBy: { version: 'asc' },
      take: 1000,
    });
    return c.RetentionPolicyCatalogSchema.parse({
      items: rows
        .map((r) => this.parse(r))
        .filter(
          (p): p is NonNullable<typeof p> =>
            !!p && p.policy.applicableContexts.includes(q.context),
        )
        .slice(0, 200)
        .map((p) => this.summary(p)),
    });
  }
  async current(actor: RequestActor, spaceId: string) {
    this.kernel.assertEnabled();
    const domain = await this.db.client.domainScopeCustody.findUnique({
      where: { scopeId: spaceId },
    });
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [spaceId] },
      [
        {
          spaceId,
          scopeId: spaceId,
          capability: 'task.read',
          allowArchived: true,
        },
      ],
      async (tx, a) => {
        a.require(tx, spaceId, 'task.read');
        const custody = domain
          ? await tx.domainScopeCustody.findUniqueOrThrow({
              where: { scopeId: spaceId },
            })
          : await tx.sharedCustody.findUniqueOrThrow({ where: { spaceId } });
        if (!contexts.includes(custody.kind)) throw new NotFoundException();
        return c.SpaceRetentionSchema.parse({
          spaceId,
          kind: custody.kind,
          policy: this.summary(
            await this.policy(tx, custody.retentionPolicyVersion),
          ),
          revision: custody.revision,
          canChange:
            !domain &&
            ['ACTIVE', 'ARCHIVED'].includes(custody.state) &&
            a.has(tx, spaceId, 'settings.manage'),
        });
      },
      undefined,
      [
        {
          spaceId,
          scopeId: spaceId,
          capability: 'settings.manage',
          allowArchived: true,
        },
      ],
    );
  }
  async change(
    actor: RequestActor,
    spaceId: string,
    revision: number,
    input: z.infer<typeof c.SpaceRetentionChangeSchema>,
  ) {
    this.kernel.assertEnabled();
    const body = c.SpaceRetentionChangeSchema.parse(input);
    if (
      await this.db.client.domainScopeCustody.findUnique({
        where: { scopeId: spaceId },
      })
    )
      throw new ConflictException({ code: 'RETENTION_DOMAIN_SCOPED' });
    return this.collaboration.signed(
      actor,
      spaceId,
      [],
      'retention.change',
      spaceId,
      async (tx, now, locked, begin) => {
        const access = await this.kernel.participantAuthority(
          tx,
          actor,
          actor.userId,
          { spaceId, scopeId: spaceId, capability: 'settings.manage' },
          locked,
        );
        await tx.$queryRaw`SELECT 1 FROM "SharedCustody" WHERE "spaceId"=${spaceId}::uuid FOR UPDATE`;
        const custody = await tx.sharedCustody.findUniqueOrThrow({
          where: { spaceId },
        });
        if (custody.revision !== revision)
          throw new ConflictException({ code: 'STALE_REVISION' });
        if (!['ACTIVE', 'ARCHIVED'].includes(custody.state))
          throw new ConflictException({ code: 'RETENTION_CUSTODY_CLOSING' });
        if (body.policyVersion === custody.retentionPolicyVersion)
          throw new ConflictException({ code: 'RETENTION_UNCHANGED' });
        if (
          await tx.companyCustodyTransfer.count({
            where: {
              OR: [{ sourceCustodyId: spaceId }, { companyId: spaceId }],
              appliedAt: null,
              expiresAt: { gt: now },
            },
          })
        )
          throw new ConflictException({ code: 'RETENTION_TRANSFER_PENDING' });
        const current = await this.policy(tx, custody.retentionPolicyVersion),
          next = await this.policy(tx, body.policyVersion),
          refusal = retentionTransition(
            current.policy,
            next.policy,
            custody.kind,
          );
        if (refusal) throw new ConflictException({ code: refusal });
        const auditId = await begin();
        const updated = await tx.sharedCustody.update({
          where: { spaceId },
          data: {
            retentionPolicyVersion: next.policy.policyVersion,
            revision: { increment: 1 },
          },
        });
        await this.kernel.offerEffect(
          tx,
          actor,
          spaceId,
          access.actorId,
          'retention.change',
          spaceId,
          auditId,
        );
        // offerEffect may advance custody bookkeeping; serve the committed revision.
        const final = await tx.sharedCustody.findUniqueOrThrow({
          where: { spaceId },
        });
        return c.SpaceRetentionSchema.parse({
          spaceId,
          kind: updated.kind,
          policy: this.summary(next),
          revision: final.revision,
          canChange: true,
        });
      },
    );
  }
}
