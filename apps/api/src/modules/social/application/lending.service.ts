import {
  Injectable,
  Inject,
  ConflictException,
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
  OPEN_LOAN_STATES,
  dueProposal,
  inCustody,
  loanAllowed,
  loanAwaits,
  loanOverdue,
  loanTransition,
} from '../domain/lending.js';
import type { LoanAction } from '../domain/lending.js';
type Asset = Prisma.SocialAssetGetPayload<object>;
type Loan = Prisma.SocialLoanGetPayload<{ include: { asset: true } }>;
const ASSET_LIMIT = 1000,
  LOANS_PER_ASSET = 1000;
/**
 * P6-04 assets and loans. Assets are personally owned; GROUP audience only
 * associates them with a Social Group for discovery and requests. Loan rights
 * belong to the two parties and survive Group departure; new requests need
 * current eligibility. Nothing here moves money or imposes penalties.
 */
@Injectable()
export class SocialLendingService {
  constructor(@Inject(LendingKit) private readonly kit: LendingKit) {}
  private get rt() {
    return this.kit.rt;
  }
  private async lockAsset(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM "SocialAsset" WHERE id=${id}::uuid FOR UPDATE`;
    const row = await tx.socialAsset.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    return row;
  }
  private async lockLoan(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM "SocialLoan" WHERE id=${id}::uuid FOR UPDATE`;
    const row = await tx.socialLoan.findUnique({
      where: { id },
      include: { asset: true },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  /** Owner, or the current audience of an active asset. GROUP checks need the Group fence. */
  private async visible(
    tx: Tx,
    actor: RequestActor,
    a: Asset,
    locked: string[],
  ) {
    if (a.ownerUserId === actor.userId) return true;
    if (a.state !== 'ACTIVE' || !a.ownerUserId) return false;
    if (a.audience === 'CONNECTIONS')
      return this.kit.connected(tx, actor.userId, a.ownerUserId);
    if (a.audience === 'GROUP' && a.groupId)
      return (
        (await this.rt.can(tx, actor, a.groupId, 'task.read', locked)) &&
        (await this.rt.groupUsers(tx, a.groupId)).has(a.ownerUserId)
      );
    return false;
  }
  private async busy(tx: Tx, ids: string[]) {
    const rows = await tx.socialLoan.findMany({
      where: { assetId: { in: ids }, state: { in: OPEN_LOAN_STATES } },
      select: { assetId: true },
    });
    return new Set(rows.map((r) => r.assetId));
  }
  private assetView(actor: RequestActor, a: Asset, busy: Set<string>) {
    return c.SocialAssetSchema.parse({
      id: a.id,
      ownerUserId: a.ownerUserId,
      isOwner: a.ownerUserId === actor.userId,
      audience: a.audience,
      groupId: a.groupId,
      title: a.title,
      description: a.description,
      state: a.state,
      available: a.state === 'ACTIVE' && !busy.has(a.id),
      revision: a.revision,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    });
  }
  private async oneAsset(tx: Tx, actor: RequestActor, a: Asset) {
    return this.assetView(actor, a, await this.busy(tx, [a.id]));
  }
  /** The Group fence is used only where Group authority is evaluated. */
  private fence(
    actor: RequestActor,
    a: { ownerUserId: string | null; audience: string; groupId: string | null },
  ) {
    return a.audience === 'GROUP' && a.groupId && a.ownerUserId !== actor.userId
      ? a.groupId
      : null;
  }
  async createAsset(
    actor: RequestActor,
    body: z.infer<typeof c.SocialAssetCreateSchema>,
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
        'social.asset.create',
        key,
        body,
        now,
        async () => {
          if (await tx.socialAsset.findUnique({ where: { id: body.id } }))
            throw new ConflictException({ code: 'ASSET_EXISTS' });
          if (
            (await tx.socialAsset.count({
              where: { ownerUserId: actor.userId, state: 'ACTIVE' },
            })) >= ASSET_LIMIT
          )
            throw new PayloadTooLargeException();
          const row = await tx.socialAsset.create({
            data: {
              id: body.id,
              ownerUserId: actor.userId,
              audience: body.audience,
              groupId,
              title: body.title,
              description: body.description ?? null,
            },
          });
          await this.kit.outbox(tx, actor, 'social.asset.created', row.id);
          return {
            resultId: row.id,
            value: this.assetView(actor, row, new Set()),
          };
        },
      );
    });
  }
  private async assetHint(id: string) {
    this.rt.kernel.assertEnabled();
    const row = await this.rt.db.client.socialAsset.findUnique({
      where: { id },
      select: { ownerUserId: true, audience: true, groupId: true },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  async readAsset(actor: RequestActor, id: string) {
    const h = await this.assetHint(id);
    return this.rt.run(
      actor,
      this.fence(actor, h),
      [],
      async (tx, _now, locked) => {
        const a = await tx.socialAsset.findUnique({ where: { id } });
        if (!a || !(await this.visible(tx, actor, a, locked)))
          throw new NotFoundException();
        return this.oneAsset(tx, actor, a);
      },
    );
  }
  async listAssets(
    actor: RequestActor,
    q: z.infer<typeof c.SocialAssetListQuerySchema>,
  ) {
    const groupId = q.view === 'GROUP' ? q.groupId! : null;
    if (!groupId) this.rt.kernel.assertEnabled();
    return this.rt.run(actor, groupId, [], async (tx, _now, locked) => {
      let where: Prisma.SocialAssetWhereInput;
      if (q.view === 'MINE') where = { ownerUserId: actor.userId };
      else if (q.view === 'CONNECTIONS')
        where = {
          audience: 'CONNECTIONS',
          state: 'ACTIVE',
          ownerUserId: { in: [...(await this.kit.peers(tx, actor.userId))] },
        };
      else {
        if (!(await this.rt.can(tx, actor, groupId!, 'task.read', locked)))
          throw new NotFoundException();
        where = {
          audience: 'GROUP',
          groupId,
          state: 'ACTIVE',
          ownerUserId: { in: [...(await this.rt.groupUsers(tx, groupId!))] },
        };
      }
      const rows = await tx.socialAsset.findMany({
        where: { ...where, ...titleFilter(q.q) },
        orderBy: { id: 'asc' },
        take: LENDING_LIMIT + 1,
      });
      if (rows.length > LENDING_LIMIT) throw new PayloadTooLargeException();
      const busy = await this.busy(
        tx,
        rows.map((r) => r.id),
      );
      const items = rows.map((r) => this.assetView(actor, r, busy));
      return this.kit.page(
        actor,
        `social.assets:${q.view}:${groupId ?? ''}:${q.q ?? ''}`,
        q,
        items,
        items.map((i) => i.available),
      );
    });
  }
  /** Ends undecided loans with history and a counterparty notice. */
  private async cancelPending(
    tx: Tx,
    actor: RequestActor,
    loans: { id: string; state: string; borrowerUserId: string | null }[],
    now: Date,
    action: string,
  ) {
    for (const l of loans) {
      const row = await tx.socialLoan.update({
        where: { id: l.id },
        data: {
          state: 'CANCELED',
          closedAt: now,
          proposedDueAt: null,
          dueProposedByUserId: null,
          dueProposedAt: null,
          revision: { increment: 1 },
          updatedAt: now,
        },
      });
      await this.kit.record(
        tx,
        actor,
        { loanId: l.id },
        action,
        l.state,
        'CANCELED',
      );
      await this.kit.notify(
        tx,
        actor,
        [l.borrowerUserId],
        'LOAN_DECIDED',
        { loanId: l.id },
        `${l.id}:${row.revision}`,
      );
    }
  }
  /**
   * ADR 0064 decisions A/D: owner-only. An audience change takes effect in the
   * same commit; visibility is evaluated per request, so nothing stale remains.
   * Undecided requests whose borrower is outside the new audience are canceled;
   * offers, agreed loans and history stay with their parties.
   */
  async patchAsset(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialAssetPatchSchema>,
    revision: number,
    key: string | undefined,
  ) {
    const groupId = body.audience === 'GROUP' ? body.groupId! : null;
    if (!groupId) this.rt.kernel.assertEnabled();
    return this.rt.run(actor, groupId, [], async (tx, now, locked) => {
      const a = await this.lockAsset(tx, id);
      if (a.ownerUserId !== actor.userId) throw new NotFoundException();
      if (
        groupId &&
        !(await this.rt.can(tx, actor, groupId, 'task.read', locked))
      )
        throw new NotFoundException();
      return this.rt.once(
        tx,
        actor,
        'social.asset.patch',
        key,
        { id, body, revision },
        now,
        async () => {
          socialRevision(revision, a.revision);
          if (a.state !== 'ACTIVE')
            throw new ConflictException({ code: 'ASSET_ARCHIVED' });
          const row = await tx.socialAsset.update({
            where: { id },
            data: {
              ...(body.title !== undefined ? { title: body.title } : {}),
              ...(body.description !== undefined
                ? { description: body.description }
                : {}),
              ...(body.audience !== undefined
                ? { audience: body.audience, groupId }
                : {}),
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          if (body.audience !== undefined) {
            const requests = await tx.socialLoan.findMany({
              where: { assetId: id, state: 'REQUESTED' },
            });
            const stale = [];
            for (const l of requests)
              if (
                !l.borrowerUserId ||
                !(await this.eligible(tx, row, l.borrowerUserId))
              )
                stale.push(l);
            await this.cancelPending(
              tx,
              actor,
              stale,
              now,
              'loan.audience-changed',
            );
          }
          await this.kit.outbox(tx, actor, 'social.asset.updated', id);
          return { resultId: id, value: await this.oneAsset(tx, actor, row) };
        },
      );
    });
  }
  /** Archiving ends pending requests/offers; agreed or custody loans block it. */
  async archiveAsset(
    actor: RequestActor,
    id: string,
    revision: number,
    key: string | undefined,
  ) {
    this.rt.kernel.assertEnabled();
    return this.rt.run(actor, null, [], async (tx, now) => {
      const a = await this.lockAsset(tx, id);
      if (a.ownerUserId !== actor.userId) throw new NotFoundException();
      return this.rt.once(
        tx,
        actor,
        'social.asset.archive',
        key,
        { id, revision },
        now,
        async () => {
          socialRevision(revision, a.revision);
          if (a.state !== 'ACTIVE')
            throw new ConflictException({ code: 'ASSET_ARCHIVED' });
          if ((await this.busy(tx, [id])).size)
            throw new ConflictException({ code: 'ASSET_ON_LOAN' });
          const pending = await tx.socialLoan.findMany({
            where: { assetId: id, state: { in: ['REQUESTED', 'OFFERED'] } },
          });
          await this.cancelPending(
            tx,
            actor,
            pending,
            now,
            'loan.asset-archived',
          );
          const row = await tx.socialAsset.update({
            where: { id },
            data: {
              state: 'ARCHIVED',
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          await this.kit.outbox(tx, actor, 'social.asset.archived', id);
          return { resultId: id, value: this.assetView(actor, row, new Set()) };
        },
      );
    });
  }

  // Loans ----------------------------------------------------------------------
  private role(actor: RequestActor, l: Loan) {
    return l.lenderUserId === actor.userId
      ? ('LENDER' as const)
      : l.borrowerUserId === actor.userId
        ? ('BORROWER' as const)
        : null;
  }
  private loanView(actor: RequestActor, l: Loan, now: Date) {
    const role = this.role(actor, l);
    return c.SocialLoanSchema.parse({
      id: l.id,
      assetId: l.assetId,
      assetTitle: l.asset.title,
      groupId: l.asset.audience === 'GROUP' ? l.asset.groupId : null,
      lenderUserId: l.lenderUserId,
      borrowerUserId: l.borrowerUserId,
      myRole: role ?? 'MODERATOR',
      origin: l.origin,
      state: l.state,
      dueAt: iso(l.dueAt),
      overdue: loanOverdue(l, now),
      custodyConfirmed: !!l.handedOverAt && inCustody(l),
      note: l.note,
      lenderHandoverAt: iso(l.lenderHandoverAt),
      borrowerReceiptAt: iso(l.borrowerReceiptAt),
      handedOverAt: iso(l.handedOverAt),
      returnRequestedAt: iso(l.returnRequestedAt),
      returnedAt: iso(l.returnedAt),
      closedAt: iso(l.closedAt),
      pendingOutcome: l.pendingOutcome,
      pendingOutcomeByUserId: l.pendingOutcomeByUserId,
      proposedDueAt: iso(l.proposedDueAt),
      dueProposedByUserId: l.dueProposedByUserId,
      dueProposedAt: iso(l.dueProposedAt),
      stateBeforeDispute: l.stateBeforeDispute,
      disputedByUserId: l.disputedByUserId,
      disputeNote: l.disputeNote,
      orphaned: !!l.orphanedAt,
      allowedActions: role ? loanAllowed(l, actor.userId, now) : [],
      revision: l.revision,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    });
  }
  /** Borrower eligibility for a request: current audience membership and no block. */
  private async eligible(tx: Tx, a: Asset, borrower: string) {
    if (!a.ownerUserId) return false;
    if (a.audience === 'CONNECTIONS')
      return this.kit.connected(tx, a.ownerUserId, borrower);
    if (a.audience === 'GROUP' && a.groupId) {
      const members = await this.rt.groupUsers(tx, a.groupId);
      return members.has(borrower) && members.has(a.ownerUserId);
    }
    return false;
  }
  async createLoan(
    actor: RequestActor,
    body: z.infer<typeof c.SocialLoanCreateSchema>,
    key: string | undefined,
  ) {
    const h = await this.assetHint(body.assetId);
    if (!h.ownerUserId) throw new NotFoundException();
    const offer = body.mode === 'OFFER';
    if (offer && h.ownerUserId !== actor.userId) throw new NotFoundException();
    const counterpart = offer ? body.borrowerUserId! : h.ownerUserId;
    if (counterpart === actor.userId)
      throw new UnprocessableEntityException({
        code: 'PARTICIPANT_INELIGIBLE',
      });
    const fence = offer ? null : this.fence(actor, h);
    return this.rt.run(actor, fence, [counterpart], async (tx, now, locked) => {
      const a = await this.lockAsset(tx, body.assetId);
      if (
        offer
          ? a.ownerUserId !== actor.userId
          : !(await this.visible(tx, actor, a, locked))
      )
        throw new NotFoundException();
      return this.rt.once(
        tx,
        actor,
        'social.loan.create',
        key,
        body,
        now,
        async () => {
          if (
            a.state !== 'ACTIVE' ||
            a.ownerUserId !== (offer ? actor.userId : counterpart)
          )
            throw new ConflictException({ code: 'ASSET_UNAVAILABLE' });
          if (!offer && a.audience === 'PRIVATE') throw new NotFoundException();
          // Existing verified-account and block rules; reasons stay private.
          await this.kit.contacts.require(
            tx,
            actor.userId,
            counterpart,
            locked,
          );
          if (body.dueAt && Date.parse(body.dueAt) <= now.getTime())
            throw new UnprocessableEntityException({ code: 'DUE_IN_PAST' });
          if (await tx.socialLoan.findUnique({ where: { id: body.id } }))
            throw new ConflictException({ code: 'LOAN_EXISTS' });
          const borrower = offer ? counterpart : actor.userId;
          if (
            await tx.socialLoan.findFirst({
              where: {
                assetId: a.id,
                borrowerUserId: borrower,
                state: { in: ['REQUESTED', 'OFFERED'] },
              },
            })
          )
            throw new ConflictException({ code: 'LOAN_PENDING' });
          if (
            (await tx.socialLoan.count({ where: { assetId: a.id } })) >=
            LOANS_PER_ASSET
          )
            throw new PayloadTooLargeException();
          const state = offer ? 'OFFERED' : 'REQUESTED';
          await tx.socialLoan.create({
            data: {
              id: body.id,
              assetId: a.id,
              lenderUserId: a.ownerUserId,
              borrowerUserId: borrower,
              origin: body.mode,
              state,
              dueAt: body.dueAt ? new Date(body.dueAt) : null,
              note: body.note ?? null,
              // The owner's statement is recorded but is not confirmed custody.
              lenderHandoverAt: offer && body.alreadyWithBorrower ? now : null,
            },
          });
          await this.kit.record(
            tx,
            actor,
            { loanId: body.id },
            offer ? 'loan.offered' : 'loan.requested',
            null,
            state,
            body.note,
          );
          if (offer && body.alreadyWithBorrower)
            await this.kit.record(
              tx,
              actor,
              { loanId: body.id },
              'loan.handover',
              state,
              state,
            );
          const row = await tx.socialLoan.findUniqueOrThrow({
            where: { id: body.id },
            include: { asset: true },
          });
          await this.kit.notify(
            tx,
            actor,
            [counterpart],
            offer ? 'LOAN_OFFERED' : 'LOAN_REQUESTED',
            { loanId: row.id },
            row.id,
          );
          return { resultId: row.id, value: this.loanView(actor, row, now) };
        },
      );
    });
  }
  private async loanHint(id: string) {
    this.rt.kernel.assertEnabled();
    const row = await this.rt.db.client.socialLoan.findUnique({
      where: { id },
      select: {
        lenderUserId: true,
        borrowerUserId: true,
        origin: true,
        assetId: true,
        asset: { select: { ownerUserId: true, audience: true, groupId: true } },
      },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  /**
   * Parties read in their account fence; a Group Owner/Admin may read loans of
   * currently Group-associated assets (moderation, read-only).
   */
  private async readable<T>(
    actor: RequestActor,
    id: string,
    work: (tx: Tx, now: Date, l: Loan) => Promise<T>,
  ) {
    const h = await this.loanHint(id);
    const party = [h.lenderUserId, h.borrowerUserId].includes(actor.userId);
    const groupId =
      !party && h.asset.audience === 'GROUP' ? h.asset.groupId : null;
    if (!party && !groupId) throw new NotFoundException();
    return this.rt.run(actor, groupId, [], async (tx, now, locked) => {
      const l = await tx.socialLoan.findUnique({
        where: { id },
        include: { asset: true },
      });
      if (!l) throw new NotFoundException();
      if (!this.role(actor, l)) {
        const g = l.asset.audience === 'GROUP' ? l.asset.groupId : null;
        if (
          !g ||
          g !== groupId ||
          !(await this.rt.can(tx, actor, g, 'settings.manage', locked))
        )
          throw new NotFoundException();
      }
      return work(tx, now, l);
    });
  }
  readLoan(actor: RequestActor, id: string) {
    return this.readable(actor, id, async (_tx, now, l) =>
      this.loanView(actor, l, now),
    );
  }
  loanHistory(actor: RequestActor, id: string) {
    return this.readable(actor, id, (tx) =>
      this.kit.history(tx, { loanId: id }),
    );
  }
  loanEvidence(actor: RequestActor, id: string) {
    return this.readable(actor, id, (tx) =>
      this.kit.evidence(tx, { loanId: id }),
    );
  }
  async addLoanEvidence(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialEvidenceCreateSchema>,
    key: string | undefined,
  ) {
    const h = await this.loanHint(id);
    if (![h.lenderUserId, h.borrowerUserId].includes(actor.userId))
      throw new NotFoundException();
    return this.rt.run(actor, null, [], async (tx, now) => {
      const l = await this.lockLoan(tx, id);
      if (!this.role(actor, l)) throw new NotFoundException();
      return this.kit.addEvidence(tx, actor, { loanId: id }, body, now, key);
    });
  }
  async listLoans(
    actor: RequestActor,
    q: z.infer<typeof c.SocialLoanListQuerySchema>,
  ) {
    const groupId = q.groupId ?? null;
    if (!groupId) this.rt.kernel.assertEnabled();
    return this.rt.run(actor, groupId, [], async (tx, now, locked) => {
      const parties =
        q.role === 'LENDER'
          ? [{ lenderUserId: actor.userId }]
          : q.role === 'BORROWER'
            ? [{ borrowerUserId: actor.userId }]
            : [
                { lenderUserId: actor.userId },
                { borrowerUserId: actor.userId },
              ];
      let where: Prisma.SocialLoanWhereInput = { OR: parties };
      if (groupId) {
        if (!(await this.rt.can(tx, actor, groupId, 'settings.manage', locked)))
          throw new NotFoundException();
        where = { asset: { audience: 'GROUP', groupId } };
      }
      const rows = await tx.socialLoan.findMany({
        where: { ...where, ...(q.assetId ? { assetId: q.assetId } : {}) },
        include: { asset: true },
        orderBy: { id: 'asc' },
        take: LENDING_LIMIT + 1,
      });
      if (rows.length > LENDING_LIMIT) throw new PayloadTooLargeException();
      const items = rows
        .filter(
          (r) =>
            q.actionRequired === undefined ||
            loanAwaits(r, actor.userId) === (q.actionRequired === 'true'),
        )
        .map((r) => this.loanView(actor, r, now));
      return this.kit.page(
        actor,
        `social.loans:${q.role}:${groupId ?? ''}:${q.assetId ?? ''}:${q.actionRequired ?? ''}`,
        q,
        items,
        items.map((i) => i.overdue),
      );
    });
  }
  async act(
    actor: RequestActor,
    id: string,
    action: LoanAction,
    body: z.infer<typeof c.SocialLoanDecisionSchema>,
    revision: number,
    key: string | undefined,
  ) {
    const h = await this.loanHint(id);
    const role =
      h.lenderUserId === actor.userId
        ? 'LENDER'
        : h.borrowerUserId === actor.userId
          ? 'BORROWER'
          : null;
    if (!role) throw new NotFoundException();
    const counterpart = role === 'LENDER' ? h.borrowerUserId : h.lenderUserId;
    // Accepting a request re-checks the borrower's current Group eligibility under the Group fence.
    const fence =
      action === 'accept' &&
      h.origin === 'REQUEST' &&
      h.asset.audience === 'GROUP' &&
      h.asset.groupId
        ? h.asset.groupId
        : null;
    return this.rt.run(
      actor,
      fence,
      counterpart ? [counterpart] : [],
      async (tx, now, locked) =>
        this.rt.once(
          tx,
          actor,
          'social.loan.' + action,
          key,
          { id, action, body, revision },
          now,
          async () => {
            // Asset before loan: the same order as archiving, so accept cannot deadlock it.
            if (action === 'accept') await this.lockAsset(tx, h.assetId);
            const l = await this.lockLoan(tx, id);
            if (!this.role(actor, l)) throw new NotFoundException();
            socialRevision(revision, l.revision);
            const patch = this.kit.rule(() =>
              loanTransition(l, actor.userId, action, now, body.note),
            );
            if (action === 'accept') {
              const a = await this.lockAsset(tx, l.assetId);
              if (
                a.state !== 'ACTIVE' ||
                a.ownerUserId !== l.lenderUserId ||
                (await this.busy(tx, [a.id])).size
              )
                throw new ConflictException({ code: 'ASSET_UNAVAILABLE' });
              if (
                l.origin === 'REQUEST' &&
                !(await this.eligible(tx, a, l.borrowerUserId!))
              )
                throw new ConflictException({ code: 'BORROWER_INELIGIBLE' });
              await this.kit.contacts.require(
                tx,
                l.lenderUserId!,
                l.borrowerUserId!,
                locked,
              );
            }
            const row = await this.kit.unique('ASSET_UNAVAILABLE', () =>
              tx.socialLoan.update({
                where: { id },
                data: { ...patch, revision: { increment: 1 }, updatedAt: now },
                include: { asset: true },
              }),
            );
            await this.kit.record(
              tx,
              actor,
              { loanId: id },
              'loan.' + action,
              l.state,
              row.state,
              body.note ?? null,
            );
            await this.kit.notify(
              tx,
              actor,
              [row.lenderUserId, row.borrowerUserId],
              loanNotice(action, row.state),
              { loanId: id },
              `${id}:${row.revision}`,
            );
            return { resultId: id, value: this.loanView(actor, row, now) };
          },
        ),
    );
  }
  /** ADR 0064 decision D: a proposal only; `accept-due` by the other party applies it. */
  async proposeDue(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialLoanDueProposalSchema>,
    revision: number,
    key: string | undefined,
  ) {
    const h = await this.loanHint(id);
    if (![h.lenderUserId, h.borrowerUserId].includes(actor.userId))
      throw new NotFoundException();
    const counterpart =
      h.lenderUserId === actor.userId ? h.borrowerUserId : h.lenderUserId;
    return this.rt.run(
      actor,
      null,
      counterpart ? [counterpart] : [],
      async (tx, now) =>
        this.rt.once(
          tx,
          actor,
          'social.loan.propose-due',
          key,
          { id, body, revision },
          now,
          async () => {
            const l = await this.lockLoan(tx, id);
            if (!this.role(actor, l)) throw new NotFoundException();
            socialRevision(revision, l.revision);
            const patch = this.kit.rule(() =>
              dueProposal(l, actor.userId, new Date(body.dueAt), now),
            );
            const row = await tx.socialLoan.update({
              where: { id },
              data: { ...patch, revision: { increment: 1 }, updatedAt: now },
              include: { asset: true },
            });
            await this.kit.record(
              tx,
              actor,
              { loanId: id },
              'loan.propose-due',
              l.state,
              row.state,
              body.note ?? null,
            );
            await this.kit.notify(
              tx,
              actor,
              [row.lenderUserId, row.borrowerUserId],
              'LOAN_DUE_PROPOSED',
              { loanId: id },
              `${id}:${row.revision}`,
            );
            return { resultId: id, value: this.loanView(actor, row, now) };
          },
        ),
    );
  }
}
/** The counterparty's notice for a completed loan transition. */
function loanNotice(action: LoanAction, state: string) {
  switch (action) {
    case 'handover':
    case 'receive':
      return state === 'HANDED_OVER' ? 'LOAN_RECEIVED' : 'LOAN_HANDOVER';
    case 'return':
      return 'LOAN_RETURN_REQUESTED';
    case 'confirm-return':
      return 'LOAN_RETURNED';
    case 'dispute':
    case 'resume':
      return 'LOAN_DISPUTED';
    case 'report-lost':
    case 'report-damaged':
      return 'LOAN_OUTCOME_PROPOSED';
    case 'accept-outcome':
      return 'LOAN_OUTCOME_CONFIRMED';
    case 'accept-due':
    case 'decline-due':
    case 'withdraw-due':
      return 'LOAN_DUE_DECIDED';
    default:
      return 'LOAN_DECIDED';
  }
}
