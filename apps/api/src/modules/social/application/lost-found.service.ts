import {
  Injectable,
  Inject,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { socialRevision } from './social-context.js';
import type { Tx } from './social-context.js';
import { LendingKit, LENDING_LIMIT, iso, titleFilter } from './lending-kit.js';
import {
  LIVE_CLAIM_STATES,
  claimAllowed,
  claimTransition,
} from '../domain/lending.js';
import type { ClaimAction } from '../domain/lending.js';
type Report = Prisma.SocialLostFoundReportGetPayload<object>;
type Claim = Prisma.SocialLostFoundClaimGetPayload<object>;
type Page = z.infer<typeof c.SocialPageQuerySchema>;
const OPEN_REPORTS = 200,
  CLAIMS_PER_REPORT = 200,
  AGREED = ['ACKNOWLEDGED', 'DISPUTED', 'RESOLVED'];
type Access = {
  reporter: boolean;
  claim: Claim | null;
  moderator: boolean;
  audience: boolean;
};
/**
 * P6-04 Lost & Found, independent of lending: a report needs no asset or loan.
 * Claims and matches are statements between verified accounts; acknowledgement
 * and resolution record agreement and handover, never legal ownership.
 */
@Injectable()
export class SocialLostFoundService {
  constructor(@Inject(LendingKit) private readonly kit: LendingKit) {}
  private get rt() {
    return this.kit.rt;
  }
  private async lockReport(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM "SocialLostFoundReport" WHERE id=${id}::uuid FOR UPDATE`;
    const row = await tx.socialLostFoundReport.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    return row;
  }
  /** GROUP checks require the Group fence; audience requires a current reporter. */
  private async access(
    tx: Tx,
    actor: RequestActor,
    r: Report,
    locked: string[],
    inGroupFence: boolean,
  ): Promise<Access> {
    const reporter = r.reporterUserId === actor.userId;
    const claim = await tx.socialLostFoundClaim.findFirst({
      where: { reportId: r.id, claimantUserId: actor.userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    let moderator = false,
      audience = false;
    if (r.audience === 'GROUP' && r.groupId && inGroupFence) {
      const member = await this.rt.can(
        tx,
        actor,
        r.groupId,
        'task.read',
        locked,
      );
      moderator =
        member &&
        (await this.rt.can(tx, actor, r.groupId, 'settings.manage', locked));
      audience =
        member &&
        !!r.reporterUserId &&
        (await this.rt.groupUsers(tx, r.groupId)).has(r.reporterUserId);
    } else if (r.audience === 'CONNECTIONS' && r.reporterUserId)
      audience = await this.kit.connected(tx, actor.userId, r.reporterUserId);
    return { reporter, claim, moderator, audience };
  }
  private readable(r: Report, a: Access) {
    return (
      a.reporter ||
      !!a.claim ||
      (a.moderator && r.state !== 'WITHDRAWN') ||
      (a.audience && (r.state === 'OPEN' || r.state === 'RESOLVED'))
    );
  }
  private async view(tx: Tx, actor: RequestActor, r: Report, a: Access) {
    let contested: boolean | null = null,
      open: number | null = null;
    if (a.reporter) {
      const live = await tx.socialLostFoundClaim.findMany({
        where: { reportId: r.id, state: { in: LIVE_CLAIM_STATES } },
        select: { state: true },
      });
      open = live.length;
      contested = live.length > 1 || live.some((l) => l.state === 'DISPUTED');
    }
    return c.SocialLostFoundSchema.parse({
      id: r.id,
      kind: r.kind,
      audience: r.audience,
      groupId: r.groupId,
      reporterUserId: r.reporterUserId,
      isReporter: a.reporter,
      title: r.title,
      description: r.description,
      occurredOn: r.occurredOn?.toISOString().slice(0, 10) ?? null,
      assetId: a.reporter ? r.assetId : null,
      state: r.state,
      contested,
      openClaimCount: open,
      myClaimId: a.claim?.id ?? null,
      revision: r.revision,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      closedAt: iso(r.closedAt),
    });
  }
  private claimView(actor: RequestActor, r: Report, cl: Claim, now: Date) {
    return c.SocialLostFoundClaimSchema.parse({
      id: cl.id,
      reportId: cl.reportId,
      claimantUserId: cl.claimantUserId,
      holder: r.kind === 'LOST' ? 'CLAIMANT' : 'REPORTER',
      note: cl.note,
      linkedReportId: cl.linkedReportId,
      state: cl.state,
      handoverAt: iso(cl.handoverAt),
      receiptAt: iso(cl.receiptAt),
      resolvedAt: iso(cl.resolvedAt),
      disputedByUserId: cl.disputedByUserId,
      disputeNote: cl.disputeNote,
      ownershipVerified: false,
      allowedActions: claimAllowed(r, cl, actor.userId, now),
      revision: cl.revision,
      createdAt: cl.createdAt.toISOString(),
      updatedAt: cl.updatedAt.toISOString(),
    });
  }
  private async hint(id: string, actor: RequestActor, group = false) {
    this.rt.kernel.assertEnabled();
    const r = await this.rt.db.client.socialLostFoundReport.findUnique({
      where: { id },
      select: { reporterUserId: true, groupId: true },
    });
    if (!r) throw new NotFoundException();
    const party =
      r.reporterUserId === actor.userId ||
      !!(await this.rt.db.client.socialLostFoundClaim.findFirst({
        where: { reportId: id, claimantUserId: actor.userId },
        select: { id: true },
      }));
    return { ...r, party, fence: party && !group ? null : r.groupId };
  }
  /** Parties use their account fence; everyone else is evaluated in the Group fence. */
  private async withReport<T>(
    actor: RequestActor,
    id: string,
    work: (
      tx: Tx,
      now: Date,
      r: Report,
      a: Access,
      locked: string[],
    ) => Promise<T>,
    opts: { lock?: boolean; group?: boolean } = {},
  ) {
    const lock = !!opts.lock;
    const h = await this.hint(id, actor, opts.group);
    return this.rt.run(actor, h.fence, [], async (tx, now, locked) => {
      const r = lock
        ? await this.lockReport(tx, id)
        : await tx.socialLostFoundReport.findUnique({ where: { id } });
      if (!r) throw new NotFoundException();
      const a = await this.access(tx, actor, r, locked, !!h.fence);
      if (!this.readable(r, a)) throw new NotFoundException();
      return work(tx, now, r, a, locked);
    });
  }
  async create(
    actor: RequestActor,
    body: z.infer<typeof c.SocialLostFoundCreateSchema>,
    key: string | undefined,
  ) {
    const groupId = body.audience === 'GROUP' ? body.groupId! : null;
    if (!groupId) this.rt.kernel.assertEnabled();
    return this.rt.run(actor, groupId, [], async (tx, now, locked) => {
      if (
        groupId &&
        !(await this.rt.can(tx, actor, groupId, 'task.read', locked))
      )
        throw new NotFoundException();
      return this.rt.once(
        tx,
        actor,
        'social.lost-found.create',
        key,
        body,
        now,
        async () => {
          if (
            await tx.socialLostFoundReport.findUnique({
              where: { id: body.id },
            })
          )
            throw new ConflictException({ code: 'REPORT_EXISTS' });
          if (
            body.assetId &&
            !(await tx.socialAsset.findFirst({
              where: { id: body.assetId, ownerUserId: actor.userId },
            }))
          )
            throw new NotFoundException();
          if (
            body.occurredOn &&
            body.occurredOn > now.toISOString().slice(0, 10)
          )
            throw new UnprocessableEntityException({
              code: 'OCCURRED_IN_FUTURE',
            });
          if (
            (await tx.socialLostFoundReport.count({
              where: {
                reporterUserId: actor.userId,
                state: { in: ['OPEN', 'HIDDEN'] },
              },
            })) >= OPEN_REPORTS
          )
            throw new PayloadTooLargeException();
          const row = await tx.socialLostFoundReport.create({
            data: {
              id: body.id,
              kind: body.kind,
              reporterUserId: actor.userId,
              audience: body.audience,
              groupId,
              assetId: body.assetId ?? null,
              title: body.title,
              description: body.description ?? null,
              occurredOn: body.occurredOn
                ? new Date(body.occurredOn + 'T00:00:00.000Z')
                : null,
            },
          });
          await this.kit.record(
            tx,
            actor,
            { reportId: row.id },
            'lost-found.reported',
            null,
            'OPEN',
          );
          const a = {
            reporter: true,
            claim: null,
            moderator: false,
            audience: false,
          };
          return {
            resultId: row.id,
            value: await this.view(tx, actor, row, a),
          };
        },
      );
    });
  }
  read(actor: RequestActor, id: string) {
    return this.withReport(actor, id, (tx, _now, r, a) =>
      this.view(tx, actor, r, a),
    );
  }
  async list(
    actor: RequestActor,
    q: z.infer<typeof c.SocialLostFoundListQuerySchema>,
  ) {
    const groupId = q.view === 'GROUP' ? q.groupId! : null;
    if (!groupId) this.rt.kernel.assertEnabled();
    return this.rt.run(actor, groupId, [], async (tx, _now, locked) => {
      const kind = q.kind ? { kind: q.kind } : {};
      let where: Prisma.SocialLostFoundReportWhereInput;
      let moderator = false;
      if (q.view === 'MINE') where = { reporterUserId: actor.userId };
      else if (q.view === 'CLAIMED')
        where = { claims: { some: { claimantUserId: actor.userId } } };
      else if (q.view === 'CONNECTIONS')
        where = {
          audience: 'CONNECTIONS',
          state: { in: ['OPEN', 'RESOLVED'] },
          reporterUserId: { in: [...(await this.kit.peers(tx, actor.userId))] },
        };
      else {
        if (!(await this.rt.can(tx, actor, groupId!, 'task.read', locked)))
          throw new NotFoundException();
        moderator = await this.rt.can(
          tx,
          actor,
          groupId!,
          'settings.manage',
          locked,
        );
        where = {
          audience: 'GROUP',
          groupId,
          state: {
            in: moderator
              ? ['OPEN', 'RESOLVED', 'HIDDEN']
              : ['OPEN', 'RESOLVED'],
          },
          reporterUserId: { in: [...(await this.rt.groupUsers(tx, groupId!))] },
        };
      }
      const rows = await tx.socialLostFoundReport.findMany({
        where: { ...where, ...kind, ...titleFilter(q.q) },
        orderBy: { id: 'asc' },
        take: LENDING_LIMIT + 1,
      });
      if (rows.length > LENDING_LIMIT) throw new PayloadTooLargeException();
      const claims = await tx.socialLostFoundClaim.findMany({
        where: {
          reportId: { in: rows.map((r) => r.id) },
          claimantUserId: actor.userId,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const mine = new Map(claims.map((cl) => [cl.reportId, cl]));
      const items = [];
      for (const r of rows)
        items.push(
          await this.view(tx, actor, r, {
            reporter: r.reporterUserId === actor.userId,
            claim: mine.get(r.id) ?? null,
            moderator,
            audience: q.view === 'CONNECTIONS' || q.view === 'GROUP',
          }),
        );
      return this.kit.page(
        actor,
        `social.lost-found:${q.view}:${groupId ?? ''}:${q.kind ?? ''}:${q.q ?? ''}`,
        q,
        items,
        items.map((i) => [i.openClaimCount, i.myClaimId]),
      );
    });
  }
  /** Reporter only: open opposite-kind reports the reporter can already see. Never proof. */
  async matches(
    actor: RequestActor,
    id: string,
    q: z.infer<typeof c.SocialLostFoundMatchQuerySchema>,
  ) {
    const h = await this.hint(id, actor);
    if (h.reporterUserId !== actor.userId) throw new NotFoundException();
    return this.rt.run(actor, h.groupId, [], async (tx, _now, locked) => {
      const r = await tx.socialLostFoundReport.findUnique({ where: { id } });
      if (!r || r.reporterUserId !== actor.userId)
        throw new NotFoundException();
      let scope: Prisma.SocialLostFoundReportWhereInput;
      if (r.groupId) {
        if (!(await this.rt.can(tx, actor, r.groupId, 'task.read', locked)))
          throw new NotFoundException();
        scope = {
          audience: 'GROUP',
          groupId: r.groupId,
          reporterUserId: {
            in: [...(await this.rt.groupUsers(tx, r.groupId))],
          },
        };
      } else
        scope = {
          audience: 'CONNECTIONS',
          reporterUserId: { in: [...(await this.kit.peers(tx, actor.userId))] },
        };
      const rows = await tx.socialLostFoundReport.findMany({
        where: {
          ...scope,
          kind: r.kind === 'LOST' ? 'FOUND' : 'LOST',
          state: 'OPEN',
          id: { not: r.id },
          ...titleFilter(q.q),
        },
        orderBy: { id: 'asc' },
        take: LENDING_LIMIT + 1,
      });
      if (rows.length > LENDING_LIMIT) throw new PayloadTooLargeException();
      const items = [];
      for (const m of rows)
        items.push(
          await this.view(tx, actor, m, {
            reporter: false,
            claim: null,
            moderator: false,
            audience: true,
          }),
        );
      return this.kit.page(
        actor,
        `social.lost-found.matches:${id}:${q.q ?? ''}`,
        q,
        items,
      );
    });
  }
  async act(
    actor: RequestActor,
    id: string,
    action: z.infer<typeof c.SocialLostFoundActionSchema>,
    revision: number,
    key: string | undefined,
  ) {
    return this.withReport(
      actor,
      id,
      async (tx, now, r, a) =>
        this.rt.once(
          tx,
          actor,
          'social.lost-found.' + action,
          key,
          { id, action, revision },
          now,
          async () => {
            socialRevision(revision, r.revision);
            let state: string;
            if (action === 'withdraw') {
              if (!a.reporter)
                throw new ForbiddenException({ code: 'REPORTER_REQUIRED' });
              if (!['OPEN', 'HIDDEN'].includes(r.state))
                throw new ConflictException({ code: 'REPORT_CLOSED' });
              state = 'WITHDRAWN';
            } else {
              // Moderation is limited to Group Owner/Admin on Group posts.
              if (!a.moderator)
                throw new ForbiddenException({ code: 'MODERATOR_REQUIRED' });
              if (r.state !== (action === 'hide' ? 'OPEN' : 'HIDDEN'))
                throw new ConflictException({ code: 'REPORT_STATE_CONFLICT' });
              state = action === 'hide' ? 'HIDDEN' : 'OPEN';
            }
            if (state === 'WITHDRAWN')
              await this.supersede(tx, actor, r.id, LIVE_CLAIM_STATES, now);
            const row = await tx.socialLostFoundReport.update({
              where: { id },
              data: {
                state,
                closedAt: state === 'WITHDRAWN' ? now : null,
                revision: { increment: 1 },
                updatedAt: now,
              },
            });
            await this.kit.record(
              tx,
              actor,
              { reportId: id },
              'lost-found.' + action,
              r.state,
              state,
            );
            return { resultId: id, value: await this.view(tx, actor, row, a) };
          },
        ),
      { lock: true, group: action !== 'withdraw' },
    );
  }
  private async supersede(
    tx: Tx,
    actor: RequestActor | null,
    reportId: string,
    states: string[],
    now: Date,
    except?: string,
  ) {
    const open = await tx.socialLostFoundClaim.findMany({
      where: {
        reportId,
        state: { in: states },
        ...(except ? { id: { not: except } } : {}),
      },
    });
    for (const cl of open) {
      const changed = await tx.socialLostFoundClaim.update({
        where: { id: cl.id },
        data: {
          state: 'SUPERSEDED',
          stateBeforeDispute: null,
          revision: { increment: 1 },
          updatedAt: now,
        },
      });
      await this.kit.record(
        tx,
        actor,
        { reportId, claimId: cl.id },
        'claim.superseded',
        cl.state,
        'SUPERSEDED',
      );
      await this.kit.notify(
        tx,
        actor,
        [cl.claimantUserId],
        'CLAIM_DECIDED',
        { reportId },
        `${cl.id}:${changed.revision}`,
      );
    }
  }

  // Claims -----------------------------------------------------------------------
  async claim(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialLostFoundClaimCreateSchema>,
    key: string | undefined,
  ) {
    this.rt.kernel.assertEnabled();
    const h = await this.rt.db.client.socialLostFoundReport.findUnique({
      where: { id },
      select: { reporterUserId: true, groupId: true },
    });
    if (!h?.reporterUserId) throw new NotFoundException();
    const reporter = h.reporterUserId;
    if (reporter === actor.userId)
      throw new UnprocessableEntityException({
        code: 'PARTICIPANT_INELIGIBLE',
      });
    return this.rt.run(
      actor,
      h.groupId,
      [reporter],
      async (tx, now, locked) => {
        const r = await this.lockReport(tx, id);
        const a = await this.access(tx, actor, r, locked, !!h.groupId);
        if (!a.audience || !['OPEN', 'RESOLVED'].includes(r.state))
          throw new NotFoundException();
        return this.rt.once(
          tx,
          actor,
          'social.claim.create',
          key,
          { id, body },
          now,
          async () => {
            if (r.state !== 'OPEN' || r.reporterUserId !== reporter)
              throw new ConflictException({ code: 'REPORT_CLOSED' });
            await this.kit.contacts.require(tx, actor.userId, reporter, locked);
            if (
              await tx.socialLostFoundClaim.findUnique({
                where: { id: body.id },
              })
            )
              throw new ConflictException({ code: 'CLAIM_EXISTS' });
            if (
              body.linkedReportId &&
              !(await tx.socialLostFoundReport.findFirst({
                where: {
                  id: body.linkedReportId,
                  reporterUserId: actor.userId,
                  state: 'OPEN',
                  kind: r.kind === 'LOST' ? 'FOUND' : 'LOST',
                },
              }))
            )
              throw new UnprocessableEntityException({
                code: 'LINKED_REPORT_INVALID',
              });
            if (
              (await tx.socialLostFoundClaim.count({
                where: { reportId: id },
              })) >= CLAIMS_PER_REPORT
            )
              throw new PayloadTooLargeException();
            const row = await this.kit.unique('CLAIM_PENDING', () =>
              tx.socialLostFoundClaim.create({
                data: {
                  id: body.id,
                  reportId: id,
                  claimantUserId: actor.userId,
                  linkedReportId: body.linkedReportId ?? null,
                  note: body.note,
                },
              }),
            );
            await this.kit.record(
              tx,
              actor,
              { reportId: id, claimId: row.id },
              'claim.submitted',
              null,
              'PENDING',
            );
            await this.kit.notify(
              tx,
              actor,
              [reporter],
              'CLAIM_SUBMITTED',
              { reportId: id },
              row.id,
            );
            return {
              resultId: row.id,
              value: this.claimView(actor, r, row, now),
            };
          },
        );
      },
    );
  }
  /** Claims are visible only to their claimant and the report's reporter. */
  private async withClaim<T>(
    actor: RequestActor,
    reportId: string,
    claimId: string,
    work: (
      tx: Tx,
      now: Date,
      r: Report,
      cl: Claim,
      locked: string[],
    ) => Promise<T>,
    lock = false,
  ) {
    this.rt.kernel.assertEnabled();
    const cl0 = await this.rt.db.client.socialLostFoundClaim.findFirst({
      where: { id: claimId, reportId },
      select: {
        claimantUserId: true,
        report: { select: { reporterUserId: true } },
      },
    });
    if (
      !cl0 ||
      ![cl0.claimantUserId, cl0.report.reporterUserId].includes(actor.userId)
    )
      throw new NotFoundException();
    const other =
      cl0.claimantUserId === actor.userId
        ? cl0.report.reporterUserId
        : cl0.claimantUserId;
    return this.rt.run(
      actor,
      null,
      other ? [other] : [],
      async (tx, now, locked) => {
        const r = lock
          ? await this.lockReport(tx, reportId)
          : await tx.socialLostFoundReport.findUnique({
              where: { id: reportId },
            });
        if (lock)
          await tx.$queryRaw`SELECT id FROM "SocialLostFoundClaim" WHERE id=${claimId}::uuid FOR UPDATE`;
        const cl = await tx.socialLostFoundClaim.findFirst({
          where: { id: claimId, reportId },
        });
        if (
          !r ||
          !cl ||
          ![cl.claimantUserId, r.reporterUserId].includes(actor.userId)
        )
          throw new NotFoundException();
        return work(tx, now, r, cl, locked);
      },
    );
  }
  readClaim(actor: RequestActor, reportId: string, claimId: string) {
    return this.withClaim(actor, reportId, claimId, async (_tx, now, r, cl) =>
      this.claimView(actor, r, cl, now),
    );
  }
  async claims(actor: RequestActor, id: string, q: Page) {
    return this.withReport(actor, id, async (tx, now, r, a) => {
      if (!a.reporter && !a.claim) throw new NotFoundException();
      const rows = await tx.socialLostFoundClaim.findMany({
        where: {
          reportId: id,
          ...(a.reporter ? {} : { claimantUserId: actor.userId }),
        },
        orderBy: { id: 'asc' },
        take: CLAIMS_PER_REPORT,
      });
      const items = rows.map((cl) => this.claimView(actor, r, cl, now));
      return this.kit.page(actor, `social.claims:${id}`, q, items, a.reporter);
    });
  }
  async actClaim(
    actor: RequestActor,
    reportId: string,
    claimId: string,
    action: ClaimAction,
    body: z.infer<typeof c.SocialLoanDecisionSchema>,
    revision: number,
    key: string | undefined,
  ) {
    return this.withClaim(
      actor,
      reportId,
      claimId,
      async (tx, now, r, cl, locked) =>
        this.rt.once(
          tx,
          actor,
          'social.claim.' + action,
          key,
          { reportId, claimId, action, body, revision },
          now,
          async () => {
            socialRevision(revision, cl.revision);
            const patch = this.kit.rule(() =>
              claimTransition(r, cl, actor.userId, action, now, body.note),
            );
            if (action === 'acknowledge') {
              if (
                await tx.socialLostFoundClaim.findFirst({
                  where: {
                    reportId,
                    state: { in: AGREED },
                    id: { not: claimId },
                  },
                })
              )
                throw new ConflictException({ code: 'CLAIM_CONFLICT' });
              await this.kit.contacts.require(
                tx,
                r.reporterUserId!,
                cl.claimantUserId!,
                locked,
              );
            }
            const row = await this.kit.unique('CLAIM_CONFLICT', () =>
              tx.socialLostFoundClaim.update({
                where: { id: claimId },
                data: { ...patch, revision: { increment: 1 }, updatedAt: now },
              }),
            );
            await this.kit.record(
              tx,
              actor,
              { reportId, claimId },
              'claim.' + action,
              cl.state,
              row.state,
              body.note,
            );
            await this.kit.notify(
              tx,
              actor,
              [r.reporterUserId, row.claimantUserId],
              row.state === 'RESOLVED'
                ? 'CLAIM_RESOLVED'
                : action === 'handover' || action === 'receive'
                  ? 'CLAIM_HANDOVER'
                  : action === 'dispute' || action === 'resume'
                    ? 'CLAIM_DISPUTED'
                    : 'CLAIM_DECIDED',
              { reportId },
              `${claimId}:${row.revision}`,
            );
            let report = r;
            if (row.state === 'RESOLVED')
              report = await this.resolve(tx, actor, r, row, now);
            return {
              resultId: claimId,
              value: this.claimView(actor, report, row, now),
            };
          },
        ),
      true,
    );
  }
  /** A verified two-party handover closes the report and supersedes other live claims. */
  private async resolve(
    tx: Tx,
    actor: RequestActor,
    r: Report,
    cl: Claim,
    now: Date,
  ) {
    await this.supersede(tx, actor, r.id, LIVE_CLAIM_STATES, now, cl.id);
    const report = await tx.socialLostFoundReport.update({
      where: { id: r.id },
      data: {
        state: 'RESOLVED',
        closedAt: now,
        revision: { increment: 1 },
        updatedAt: now,
      },
    });
    await this.kit.record(
      tx,
      actor,
      { reportId: r.id },
      'lost-found.resolved',
      r.state,
      'RESOLVED',
    );
    // The claimant's own linked counter-report closes too, unless it is in its own agreement.
    if (cl.linkedReportId) {
      const linked = await this.lockReport(tx, cl.linkedReportId);
      const busy = await tx.socialLostFoundClaim.count({
        where: {
          reportId: linked.id,
          state: { in: ['ACKNOWLEDGED', 'DISPUTED'] },
        },
      });
      if (
        linked.state === 'OPEN' &&
        linked.reporterUserId === cl.claimantUserId &&
        !busy
      ) {
        await this.supersede(tx, actor, linked.id, ['PENDING'], now);
        await tx.socialLostFoundReport.update({
          where: { id: linked.id },
          data: {
            state: 'RESOLVED',
            closedAt: now,
            revision: { increment: 1 },
            updatedAt: now,
          },
        });
        await this.kit.record(
          tx,
          actor,
          { reportId: linked.id },
          'lost-found.resolved',
          'OPEN',
          'RESOLVED',
        );
      }
    }
    return report;
  }

  // Evidence and history -------------------------------------------------------
  /** Report evidence: the reporter, and the claimant of an agreed claim. */
  reportEvidence(actor: RequestActor, id: string) {
    return this.withReport(actor, id, async (tx, _now, _r, a) => {
      if (!a.reporter && !(a.claim && AGREED.includes(a.claim.state)))
        throw new NotFoundException();
      return this.kit.evidence(tx, { reportId: id });
    });
  }
  addReportEvidence(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialEvidenceCreateSchema>,
    key: string | undefined,
  ) {
    return this.withReport(
      actor,
      id,
      async (tx, now, r, a) => {
        if (!a.reporter) throw new NotFoundException();
        if (r.state === 'WITHDRAWN')
          throw new ConflictException({ code: 'REPORT_CLOSED' });
        return this.kit.addEvidence(
          tx,
          actor,
          { reportId: id },
          body,
          now,
          key,
        );
      },
      { lock: true },
    );
  }
  claimEvidence(actor: RequestActor, reportId: string, claimId: string) {
    return this.withClaim(actor, reportId, claimId, (tx) =>
      this.kit.evidence(tx, { reportId, claimId }),
    );
  }
  addClaimEvidence(
    actor: RequestActor,
    reportId: string,
    claimId: string,
    body: z.infer<typeof c.SocialEvidenceCreateSchema>,
    key: string | undefined,
  ) {
    return this.withClaim(
      actor,
      reportId,
      claimId,
      (tx, now) =>
        this.kit.addEvidence(tx, actor, { reportId, claimId }, body, now, key),
      true,
    );
  }
  /** Reporter: all events; claimant: own claim events; moderator: report-level events. */
  history(actor: RequestActor, id: string) {
    return this.withReport(actor, id, async (tx, _now, _r, a) => {
      if (a.reporter) return this.kit.history(tx, { reportId: id });
      if (a.claim) {
        const mine = await tx.socialLostFoundClaim.findMany({
          where: { reportId: id, claimantUserId: actor.userId },
          select: { id: true },
        });
        return this.kit.history(tx, {
          reportId: id,
          claimId: { in: mine.map((m) => m.id) },
        });
      }
      if (a.moderator)
        return this.kit.history(tx, { reportId: id, claimId: null });
      throw new NotFoundException();
    });
  }
}
