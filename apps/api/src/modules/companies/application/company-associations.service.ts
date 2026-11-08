import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  PayloadTooLargeException,
  BadRequestException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import {
  SharedKernel,
  SharedAuthority,
  CollaborationService,
  CompanyAccess,
} from '../../spaces/public/index.js';
import type {
  CompanyTransaction,
  SharedRequest,
} from '../../spaces/public/index.js';
import { ProjectCompanyAssociations } from '../../projects/public/index.js';
import { TeamCompanyAssociations } from '../../teams/public/index.js';
import { CompaniesService } from './companies.service.js';
type Kind = z.infer<typeof c.CompanyAssociationKindSchema>;
type Row = Awaited<ReturnType<ProjectCompanyAssociations['row']>> & {};
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
@Injectable()
export class CompanyAssociationsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(CollaborationService) private readonly signed: CollaborationService,
    @Inject(CompanyAccess) private readonly access: CompanyAccess,
    @Inject(CompaniesService) private readonly companies: CompaniesService,
    @Inject(ProjectCompanyAssociations)
    private readonly projects: ProjectCompanyAssociations,
    @Inject(TeamCompanyAssociations)
    private readonly teams: TeamCompanyAssociations,
  ) {}
  private source(kind: Kind) {
    return kind === 'PROJECT' ? this.projects : this.teams;
  }
  private view(kind: Kind, r: Row) {
    return c.CompanyAssociationSchema.parse({
      id: r.id,
      kind,
      sourceId: r.sourceId,
      companySpaceId: r.companySpaceId,
      companyScopeId: r.companyScopeId,
      state: r.state,
      revision: r.revision,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    });
  }
  private async context(
    tx: Prisma.TransactionClient,
    actor: RequestActor,
    id: string,
    scopeId: string,
    locked: string[],
    now: Date,
    begin: () => Promise<string>,
  ): Promise<CompanyTransaction> {
    const root = await this.kernel.participantAuthority(
      tx,
      actor,
      actor.userId,
      { spaceId: id, scopeId: id, capability: 'task.read' },
      locked,
    );
    const ctx = { tx, actor, spaceId: id, root, locked, now, begin };
    if (scopeId === id) throw new NotFoundException();
    await this.companies.staffVisibility(ctx, scopeId, true);
    return ctx;
  }
  private async snapshot(
    ctx: CompanyTransaction,
    scopeId: string,
    kind: Kind,
    sourceId: string,
  ) {
    const owner = await this.kernel.custodian(ctx.tx, sourceId),
      co = await this.kernel.custodian(ctx.tx, ctx.spaceId);
    const source = await this.source(kind).owner(
      ctx.tx,
      ctx.actor,
      sourceId,
      ctx.locked,
      owner.userId,
    );
    const company = await this.kernel.participantAuthority(
      ctx.tx,
      ctx.actor,
      co.userId,
      {
        spaceId: ctx.spaceId,
        scopeId: ctx.spaceId,
        capability: 'custody.handover',
      },
      ctx.locked,
    );
    const sourceAdmission = await this.access.seat(ctx, scopeId, owner.userId),
      destination = await this.access.seat(ctx, scopeId, co.userId);
    const proof = new SharedAuthority(ctx.tx, [
      await this.kernel.participantAuthority(
        ctx.tx,
        ctx.actor,
        co.userId,
        { spaceId: ctx.spaceId, scopeId: ctx.spaceId, capability: 'task.read' },
        ctx.locked,
      ),
    ]);
    let companyEpoch: number;
    try {
      companyEpoch = await this.kernel.relationshipEpoch(
        ctx.tx,
        proof,
        ctx.spaceId,
      );
    } finally {
      proof.close();
    }
    return {
      spaceId: source.row.spaceId,
      scopeId: source.row.scopeId,
      sourceId,
      companySpaceId: ctx.spaceId,
      companyScopeId: scopeId,
      sourceAccessId: source.a.accessId,
      sourceGeneration: source.a.generation,
      sourceEpoch: source.epoch,
      companyAccessId: company.accessId,
      companyGeneration: company.generation,
      companyEpoch,
      sourceCompanyAccessId: sourceAdmission.accessId,
      sourceCompanyGeneration: sourceAdmission.generation,
      destinationAccessId: destination.accessId,
      destinationGeneration: destination.generation,
    };
  }
  private same(
    row: Row,
    snapshot: Awaited<ReturnType<CompanyAssociationsService['snapshot']>>,
  ) {
    return Object.entries(snapshot).every(
      ([k, v]) => row[k as keyof Row] === v,
    );
  }
  private async run<T>(
    actor: RequestActor,
    id: string,
    scopeId: string,
    kind: Kind,
    sourceId: string,
    side: 'SOURCE' | 'COMPANY',
    action: string,
    target: string,
    work: (
      ctx: CompanyTransaction,
      a: SharedAuthority,
      begin: () => Promise<string>,
    ) => Promise<T>,
    revoking = false,
  ) {
    await this.companies.hint(id);
    await this.source(kind).hint(sourceId);
    const requests: SharedRequest[] = [
      {
        spaceId: side === 'SOURCE' ? sourceId : id,
        scopeId: side === 'SOURCE' ? sourceId : id,
        capability: side === 'SOURCE' ? 'custody.transfer' : 'custody.handover',
      },
    ];
    if (!revoking)
      requests.push({ spaceId: id, scopeId: id, capability: 'task.read' });
    let authority: SharedAuthority;
    const effectSpace = side === 'SOURCE' ? sourceId : id;
    return this.signed.signed(
      actor,
      effectSpace,
      [],
      action,
      target,
      async (tx, now, locked, begin) => {
        const ctx = revoking
          ? {
              tx,
              actor,
              spaceId: id,
              root: authority.require(tx, effectSpace, requests[0]!.capability),
              locked,
              now,
              begin,
            }
          : await this.context(tx, actor, id, scopeId, locked, now, begin);
        return work(ctx, authority, begin);
      },
      false,
      'PROJECT',
      (body, abort) =>
        this.kernel.run(
          actor,
          { userIds: [], spaceIds: [id, sourceId] },
          requests,
          async (tx, a) => {
            authority = a;
            const now = (
              await tx.$queryRaw<
                { now: Date }[]
              >`SELECT clock_timestamp() AS now`
            )[0]!.now;
            const users = [
              ...new Set([
                actor.userId,
                (await this.kernel.custodian(tx, id)).userId,
                (await this.kernel.custodian(tx, sourceId)).userId,
              ]),
            ];
            return body(tx, now, users);
          },
          abort,
        ),
    );
  }
  create(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyAssociationCreateSchema>,
    key?: string,
  ) {
    if (!key || !/^[!-~]{1,128}$/.test(key)) throw new BadRequestException();
    const source = this.source(input.kind);
    return this.run(
      actor,
      id,
      scopeId,
      input.kind,
      input.sourceId,
      'SOURCE',
      'company.association.propose',
      input.id,
      async (ctx, a, begin) => {
        const snapshot = await this.snapshot(
          ctx,
          scopeId,
          input.kind,
          input.sourceId,
        );
        const receipt = await this.kernel.receipt(
          ctx.tx,
          a,
          {
            spaceId: input.sourceId,
            scopeId: input.sourceId,
            capability: 'custody.transfer',
          },
          {
            operation: 'company.association.propose',
            key:
              snapshot.sourceGeneration +
              ':' +
              snapshot.sourceEpoch +
              ':' +
              (key ?? ''),
            fingerprint: hash({ id, scopeId, input }),
          },
          async () => {
            if (!key || !/^[!-~]{1,128}$/.test(key))
              throw new ConflictException();
            if (
              (
                await this.projects.rows(ctx.tx, {
                  companySpaceId: id,
                  companyScopeId: scopeId,
                })
              ).length +
                (
                  await this.teams.rows(ctx.tx, {
                    companySpaceId: id,
                    companyScopeId: scopeId,
                  })
                ).length >=
              1000
            )
              throw new PayloadTooLargeException();
            if (
              (
                await source.rows(ctx.tx, {
                  sourceId: input.sourceId,
                  state: { not: 'REVOKED' },
                })
              ).length
            )
              throw new ConflictException({
                code: 'COMPANY_ASSOCIATION_EXISTS',
              });
            await this.kernel.featureGrowth(
              ctx.tx,
              input.sourceId,
              'company.association',
            );
            const audit = await begin();
            await source.create(ctx.tx, {
              id: input.id,
              ...snapshot,
              expiresAt: new Date(ctx.now.getTime() + 1800000),
            });
            await this.kernel.offerEffect(
              ctx.tx,
              actor,
              input.sourceId,
              a.require(ctx.tx, input.sourceId, 'custody.transfer').actorId,
              'company.association.propose',
              input.id,
              audit,
              {
                actorId: a.require(ctx.tx, input.sourceId, 'custody.transfer')
                  .actorId,
                feature: 'company.association',
                delta: 1,
              },
            );
            return { id: input.id, statusCode: 201 };
          },
        );
        const row = await source.row(ctx.tx, receipt.id);
        if (
          !row ||
          !this.same(row, snapshot) ||
          row.state === 'REVOKED' ||
          (row.expiresAt && row.expiresAt <= ctx.now)
        )
          throw new ConflictException({
            code: 'ASSOCIATION_REAPPROVAL_REQUIRED',
          });
        return this.view(input.kind, row);
      },
    );
  }
  async change(
    actor: RequestActor,
    id: string,
    scopeId: string,
    kind: Kind,
    target: string,
    revision: number,
    action:
      | 'accept'
      | 'request-attachment'
      | 'accept-attachment'
      | 'revoke'
      | 'detach',
    side: 'SOURCE' | 'COMPANY' = 'SOURCE',
  ) {
    const source = this.source(kind),
      hint = await source.row(this.db.client, target);
    if (!hint || hint.companySpaceId !== id || hint.companyScopeId !== scopeId)
      throw new NotFoundException();
    const acting =
      action === 'accept' || action === 'accept-attachment'
        ? 'COMPANY'
        : action === 'request-attachment'
          ? 'SOURCE'
          : side;
    return this.run(
      actor,
      id,
      scopeId,
      kind,
      hint.sourceId,
      acting,
      'company.association.' + action.replaceAll('-', '.'),
      target,
      async (ctx, a, begin) => {
        const row = await source.row(ctx.tx, target);
        if (!row || row.companySpaceId !== id || row.companyScopeId !== scopeId)
          throw new NotFoundException();
        if (row.revision !== revision)
          throw new ConflictException({ code: 'STALE_REVISION' });
        if (row.state === 'REVOKED') throw new ConflictException();
        if (action !== 'revoke' && action !== 'detach') {
          const current = await this.snapshot(ctx, scopeId, kind, row.sourceId);
          if (!this.same(row, current))
            throw new ConflictException({
              code: 'ASSOCIATION_REAPPROVAL_REQUIRED',
            });
          const expected =
            action === 'accept'
              ? 'PENDING'
              : action === 'request-attachment'
                ? 'ASSOCIATED'
                : 'ATTACH_PENDING';
          if (
            row.state !== expected ||
            (row.expiresAt && row.expiresAt <= ctx.now)
          )
            throw new ConflictException();
        }
        if (
          action === 'detach' &&
          !['ATTACHED', 'ATTACH_PENDING'].includes(row.state)
        )
          throw new ConflictException();
        const audit = await begin(),
          state =
            action === 'accept'
              ? 'ASSOCIATED'
              : action === 'request-attachment'
                ? 'ATTACH_PENDING'
                : action === 'accept-attachment'
                  ? 'ATTACHED'
                  : action === 'detach'
                    ? 'ASSOCIATED'
                    : 'REVOKED';
        const updated = await source.update(ctx.tx, target, {
          state,
          revision: { increment: 1 },
          updatedAt: ctx.now,
          expiresAt:
            state === 'ATTACH_PENDING'
              ? new Date(ctx.now.getTime() + 1800000)
              : null,
        });
        const effectSpace = acting === 'SOURCE' ? row.spaceId : id,
          proof = a.require(
            ctx.tx,
            effectSpace,
            acting === 'SOURCE' ? 'custody.transfer' : 'custody.handover',
          );
        await this.kernel.offerEffect(
          ctx.tx,
          actor,
          effectSpace,
          proof.actorId,
          'company.association.' + action.replaceAll('-', '.'),
          target,
          audit,
        );
        return this.view(kind, updated);
      },
      action === 'revoke' || action === 'detach',
    );
  }
  async list(
    actor: RequestActor,
    id: string,
    scopeId: string,
    q: z.infer<typeof c.CompanyAssociationQuerySchema>,
    attached = false,
  ) {
    await this.companies.hint(id);
    const hints = [
      ...(
        await this.projects.rows(this.db.client, {
          companySpaceId: id,
          companyScopeId: scopeId,
        })
      ).map((r) => ({ kind: 'PROJECT' as const, ...r })),
      ...(
        await this.teams.rows(this.db.client, {
          companySpaceId: id,
          companyScopeId: scopeId,
        })
      ).map((r) => ({ kind: 'TEAM' as const, ...r })),
    ];
    if (hints.length > 1000) throw new PayloadTooLargeException();
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [id, ...hints.map((r) => r.spaceId)] },
      [{ spaceId: id, scopeId: id, capability: 'task.read' }],
      async (tx, a) => {
        const now = (
          await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
        )[0]!.now;
        const locked = [
          ...new Set([
            actor.userId,
            (await this.kernel.custodian(tx, id)).userId,
            ...(await Promise.all(
              hints.map(
                async (r) =>
                  (await this.kernel.custodian(tx, r.spaceId)).userId,
              ),
            )),
          ]),
        ];
        const ctx = await this.context(
          tx,
          actor,
          id,
          scopeId,
          locked,
          now,
          async () => {
            throw new Error('Read cannot mutate');
          },
        );
        const current = [
          ...(
            await this.projects.rows(tx, {
              companySpaceId: id,
              companyScopeId: scopeId,
            })
          ).map((r) => ({ kind: 'PROJECT' as const, ...r })),
          ...(
            await this.teams.rows(tx, {
              companySpaceId: id,
              companyScopeId: scopeId,
            })
          ).map((r) => ({ kind: 'TEAM' as const, ...r })),
        ];
        if (
          hash(current.map((r) => [r.id, r.revision])) !==
          hash(hints.map((r) => [r.id, r.revision]))
        )
          throw new ConflictException({ code: 'ASSOCIATION_SOURCES_CHANGED' });
        const out = [];
        for (const row of current) {
          if (
            row.state === 'REVOKED' ||
            (row.expiresAt && row.expiresAt <= now) ||
            (attached && row.state !== 'ATTACHED')
          )
            continue;
          try {
            if (
              !this.same(
                row,
                await this.snapshot(ctx, scopeId, row.kind, row.sourceId),
              )
            )
              continue;
            if (attached) {
              if (!a.has(tx, row.spaceId, 'task.read')) continue;
            } else {
              const sourceOwner = await this.kernel.custodian(tx, row.spaceId);
              if (
                ctx.root.role !== 'OWNER' &&
                sourceOwner.userId !== actor.userId
              )
                continue;
            }
            out.push(this.view(row.kind, row));
          } catch (e) {
            if (
              !(e instanceof NotFoundException) &&
              !(e instanceof ForbiddenException) &&
              !(e instanceof ConflictException)
            )
              throw e;
          }
        }
        out.sort((a, b) => a.id.localeCompare(b.id));
        const context =
            'company.associations:' + id + ':' + scopeId + ':' + attached,
          stamp = hash([
            ctx.root.authorizationVersion.toString(),
            out,
            out.map((r) => {
              const proof = a.has(tx, r.sourceId, 'task.read')
                ? a.require(tx, r.sourceId, 'task.read')
                : null;
              return proof
                ? [proof.generation, proof.authorizationVersion.toString()]
                : null;
            }),
          ]);
        const after = this.kernel.cursorPosition(
            context,
            stamp,
            actor.userId,
            q.after,
          ),
          rows = out.filter((r) => !after || r.id > after),
          items = rows.slice(0, q.limit);
        return this.kernel.cursorPage(context, stamp, actor.userId, {
          items,
          nextCursor: rows.length > q.limit ? items.at(-1)!.id : null,
        });
      },
      undefined,
      hints.map((r) => ({
        spaceId: r.spaceId,
        scopeId: r.scopeId,
        capability: 'task.read' as const,
      })),
      true,
    );
  }
}
