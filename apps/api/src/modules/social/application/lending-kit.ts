import {
  Injectable,
  Inject,
  ConflictException,
  ForbiddenException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { DmContacts } from '../../messaging/public/index.js';
import { ActivityRuntime } from './activity-runtime.js';
import { socialHash } from './social-context.js';
import type { Tx } from './social-context.js';
import { LendingRuleError } from '../domain/lending.js';
export const LENDING_LIMIT = 5000;
export const EVIDENCE_LIMIT = 50;
const HISTORY_LIMIT = 1000;
export const iso = (d: Date | null) => d?.toISOString() ?? null;
type Search = string | undefined;
export const titleFilter = (q: Search) =>
  q ? { title: { contains: q, mode: 'insensitive' as const } } : {};
export type LendingContext = {
  loanId?: string;
  reportId?: string;
  claimId?: string;
};
/** P6-04 shared plumbing: fences and receipts come from the Activity runtime. */
@Injectable()
export class LendingKit {
  constructor(
    @Inject(ActivityRuntime) readonly rt: ActivityRuntime,
    @Inject(DmContacts) readonly contacts: DmContacts,
  ) {}
  rule<T>(work: () => T): T {
    try {
      return work();
    } catch (e) {
      if (!(e instanceof LendingRuleError)) throw e;
      throw e.status === 403
        ? new ForbiddenException({ code: e.code })
        : e.status === 422
          ? new UnprocessableEntityException({ code: e.code })
          : new ConflictException({ code: e.code });
    }
  }
  /** Maps the partial unique indexes to a stable conflict instead of a 500. */
  async unique<T>(code: string, work: () => Promise<T>) {
    try {
      return await work();
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException({ code });
      throw e;
    }
  }
  async connected(tx: Tx, a: string, b: string) {
    return !!(await tx.socialConnection.findFirst({
      where: {
        state: 'ACCEPTED',
        OR: [
          { requesterUserId: a, recipientUserId: b },
          { requesterUserId: b, recipientUserId: a },
        ],
      },
      select: { id: true },
    }));
  }
  async peers(tx: Tx, userId: string) {
    const rows = await tx.socialConnection.findMany({
      where: {
        state: 'ACCEPTED',
        OR: [{ requesterUserId: userId }, { recipientUserId: userId }],
      },
      select: { requesterUserId: true, recipientUserId: true },
      take: LENDING_LIMIT + 1,
    });
    if (rows.length > LENDING_LIMIT) throw new PayloadTooLargeException();
    return new Set(
      rows.map((r) =>
        r.requesterUserId === userId ? r.recipientUserId : r.requesterUserId,
      ),
    );
  }
  /** Authorized history row plus the existing transactional outbox. */
  async record(
    tx: Tx,
    actor: RequestActor | null,
    ctx: LendingContext,
    action: string,
    from: string | null,
    to: string | null,
    note?: string | null,
  ) {
    await tx.socialLendingEvent.create({
      data: {
        id: randomUUID(),
        loanId: ctx.loanId ?? null,
        reportId: ctx.reportId ?? null,
        claimId: ctx.claimId ?? null,
        actorUserId: actor?.userId ?? null,
        action,
        fromState: from,
        toState: to,
        note: note?.trim() || null,
      },
    });
    if (actor)
      await this.outbox(
        tx,
        actor,
        'social.' + action,
        ctx.claimId ?? ctx.loanId ?? ctx.reportId!,
      );
  }
  /**
   * ADR 0064 decision B: the Social notice inbox (polled via /social-notices,
   * no push under ADR 0044), committed with the transition. Recipients are the
   * current parties only; the payload is kind + resource id, never notes or
   * evidence. The (userId, dedupeKey) unique index absorbs retries and replays.
   */
  async notify(
    tx: Tx,
    actor: RequestActor | null,
    users: (string | null)[],
    kind: string,
    ctx: { loanId: string } | { reportId: string },
    dedupe: string,
  ) {
    const recipients = [
      ...new Set(users.filter((u): u is string => !!u && u !== actor?.userId)),
    ];
    if (!recipients.length) return;
    const loanId = 'loanId' in ctx ? ctx.loanId : null,
      reportId = 'reportId' in ctx ? ctx.reportId : null;
    await tx.socialNotice.createMany({
      data: recipients.map((userId) => ({
        id: randomUUID(),
        userId,
        loanId,
        lostFoundReportId: reportId,
        kind,
        resourceId: (loanId ?? reportId)!,
        dedupeKey: `${kind}:${dedupe}`.slice(0, 160),
      })),
      skipDuplicates: true,
    });
  }
  async outbox(tx: Tx, actor: RequestActor, type: string, resourceId: string) {
    const personal = await this.rt.context.owner(tx, actor.userId);
    await tx.outboxEvent.create({
      data: {
        id: randomUUID(),
        type,
        version: 1,
        aggregateId: resourceId,
        spaceId: personal.spaceId,
        payload: {},
        correlationId: actor.correlationId,
      },
    });
  }
  async history(tx: Tx, where: Prisma.SocialLendingEventWhereInput) {
    const rows = await tx.socialLendingEvent.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_LIMIT + 1,
    });
    return c.SocialLendingHistorySchema.parse({
      truncated: rows.length > HISTORY_LIMIT,
      items: rows
        .slice(0, HISTORY_LIMIT)
        .reverse()
        .map((r) => ({
          id: r.id,
          claimId: r.claimId,
          actorUserId: r.actorUserId,
          action: r.action,
          fromState: r.fromState,
          toState: r.toState,
          note: r.note,
          occurredAt: r.occurredAt.toISOString(),
        })),
    });
  }
  evidenceView(r: Prisma.SocialEvidenceGetPayload<object>) {
    return c.SocialEvidenceSchema.parse({
      id: r.id,
      loanId: r.loanId,
      reportId: r.reportId,
      claimId: r.claimId,
      addedByUserId: r.addedByUserId,
      kind: r.kind,
      label: r.label,
      note: r.note,
      observedAt: iso(r.observedAt),
      content: null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  async evidence(tx: Tx, ctx: LendingContext) {
    const where = this.evidenceWhere(ctx);
    const rows = await tx.socialEvidence.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: EVIDENCE_LIMIT,
    });
    return { items: rows.map((r) => this.evidenceView(r)) };
  }
  private evidenceWhere(ctx: LendingContext) {
    return ctx.claimId
      ? { claimId: ctx.claimId }
      : ctx.loanId
        ? { loanId: ctx.loanId }
        : { reportId: ctx.reportId! };
  }
  /** Descriptive metadata only: no file reference is accepted (ADR 0057/0063). */
  async addEvidence(
    tx: Tx,
    actor: RequestActor,
    ctx: LendingContext,
    body: z.infer<typeof c.SocialEvidenceCreateSchema>,
    now: Date,
    key: string | undefined,
  ) {
    return this.rt.once(
      tx,
      actor,
      'social.evidence.add',
      key,
      { ctx, body },
      now,
      async () => {
        if (await tx.socialEvidence.findUnique({ where: { id: body.id } }))
          throw new ConflictException({ code: 'EVIDENCE_EXISTS' });
        if (
          (await tx.socialEvidence.count({ where: this.evidenceWhere(ctx) })) >=
          EVIDENCE_LIMIT
        )
          throw new PayloadTooLargeException();
        if (body.observedAt && Date.parse(body.observedAt) > now.getTime())
          throw new UnprocessableEntityException({
            code: 'OBSERVED_IN_FUTURE',
          });
        const row = await tx.socialEvidence.create({
          data: {
            id: body.id,
            loanId: ctx.claimId ? null : (ctx.loanId ?? null),
            reportId: ctx.claimId || ctx.loanId ? null : ctx.reportId!,
            claimId: ctx.claimId ?? null,
            addedByUserId: actor.userId,
            kind: body.kind,
            label: body.label,
            note: body.note ?? null,
            observedAt: body.observedAt ? new Date(body.observedAt) : null,
          },
        });
        await this.record(tx, actor, ctx, 'evidence.added', null, null);
        return { resultId: row.id, value: this.evidenceView(row) };
      },
    );
  }
  page<T extends { id: string }>(
    actor: RequestActor,
    context: string,
    q: { limit: number; after?: string | undefined },
    items: (T & { revision: number })[],
    extra: unknown = null,
  ) {
    return this.rt.context.page(
      actor,
      context,
      socialHash([extra, items.map((i) => [i.id, i.revision])]),
      q,
      items,
    );
  }
}
