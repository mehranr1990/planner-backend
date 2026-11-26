import {
  Injectable,
  Inject,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { socialHash, socialKey, socialRevision } from './social-context.js';
import type { Tx } from './social-context.js';
import { ActivityRuntime } from './activity-runtime.js';
import { SocialActivitiesService, iso } from './activities.service.js';
import { split, balances, SplitError } from '../domain/split.js';
import { SpacesService } from '../../spaces/public/index.js';
import { ExternalExpensePosting } from '../../finance/public/index.js';
type Page = z.infer<typeof c.SocialPageQuerySchema>;
type Input = z.infer<typeof c.SocialExpenseInputSchema>;
/** Canonical input after Group actor references are resolved to user IDs. */
type Resolved = Omit<Input, 'payerUserId' | 'payerActorId' | 'shares'> & {
  payerUserId: string;
  shares: { userId: string; value?: string }[];
};
/** Never an eligible user ID: unresolvable actor references fail eligibility. */
const UNRESOLVED = 'unresolved';
export type LedgerRef = { kind: 'GROUP' | 'ACTIVITY'; id: string };
type Ledger = {
  groupId: string | null;
  activityId: string | null;
  eligible: Set<string>;
  approvers: string[];
  approver: boolean;
  member: boolean;
  open: boolean;
  /** P6-06: a departed party keeps only their own balance and settlements. */
  former: boolean;
  /** Settlement counterparties: current participants plus open-balance parties. */
  parties: () => Promise<Set<string>>;
  /** Group ledgers: user ID to Group-scoped actor ID (empty for Activities). */
  actors: Map<string, string>;
};
export type SocialObligation = {
  ledgerKind: 'GROUP' | 'ACTIVITY';
  ledgerId: string;
  currency: string;
  netMinor: string;
  owedMinor: string;
  receivableMinor: string;
};
type Where = { groupId: string } | { activityId: string };
type ExpenseRow = Prisma.SocialExpenseGetPayload<{
  include: { revisions: { include: { shares: true } } };
}>;
type Revision = Prisma.SocialExpenseRevisionGetPayload<{
  include: { shares: true };
}>;
const LIMIT = 5000;
/**
 * P6-03: recordkeeping and settlement accounting only. Pending proposals and
 * corrections never affect balances; nothing here moves money or writes
 * Personal Finance (ADR 0060 records that dependency).
 */
@Injectable()
export class SocialExpensesService {
  constructor(
    @Inject(ActivityRuntime) private readonly rt: ActivityRuntime,
    @Inject(SocialActivitiesService)
    private readonly activities: SocialActivitiesService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
    @Inject(ExternalExpensePosting)
    private readonly posting: ExternalExpensePosting,
  ) {}
  private async run<T>(
    actor: RequestActor,
    ref: LedgerRef,
    users: string[],
    work: (tx: Tx, now: Date, l: Ledger, locked: string[]) => Promise<T>,
    former = false,
  ) {
    const groupId = ref.id;
    const parties = (tx: Tx, where: Where, eligible: Set<string>) => async () =>
      new Set([
        ...eligible,
        ...(await this.open(tx, where)).map((r) => r.userId),
      ]);
    if (ref.kind === 'ACTIVITY') {
      const h = await this.rt.hint(ref.id);
      if (former && h.groupId && (await this.retained(h.groupId)))
        return this.retainedLedger(
          actor,
          users,
          { activityId: h.id },
          work,
          async (tx) => {
            await this.rt.lock(tx, h.id);
          },
        );
      return this.rt.run(actor, h.groupId, users, async (tx, now, locked) => {
        const { act, a } = await this.activities.enter(
          tx,
          actor,
          ref.id,
          now,
          locked,
          true,
        );
        // P6-06: Group departure ends Activity access; an open balance keeps
        // only the person's own balance and settlements reachable.
        const formerParty =
          !(a.active || a.manage) &&
          former &&
          (await this.owes(tx, { activityId: act.id }, actor.userId));
        if (!formerParty) this.activities.require(a);
        const eligible = await this.rt.eligible(tx, act);
        const organizers = eligible.filter((p) => p.role === 'ORGANIZER');
        const ids = new Set(eligible.map((p) => p.userId!));
        return work(
          tx,
          now,
          {
            groupId: null,
            activityId: act.id,
            eligible: ids,
            approvers: [
              ...organizers.map((p) => p.userId!),
              ...(act.groupId ? await this.groupAdmins(tx, act.groupId) : []),
            ],
            // ADR 0051: Owner/Admin and the Activity organizer approve in the Activity scope.
            approver: a.manage,
            actors: new Map(),
            member: a.active,
            // Deleted Activities keep their ledger readable and settleable (decision B).
            open: act.state !== 'CANCELED' && act.state !== 'DELETED',
            former: formerParty,
            parties: parties(tx, { activityId: act.id }, ids),
          },
          locked,
        );
      });
    }
    this.rt.kernel.assertEnabled();
    if (former && (await this.retained(groupId)))
      return this.retainedLedger(actor, users, { groupId }, work);
    return this.rt.run(actor, groupId, users, async (tx, now, locked) => {
      const member = await this.rt.can(tx, actor, groupId, 'task.read', locked);
      const formerParty =
        !member && former && (await this.owes(tx, { groupId }, actor.userId));
      if (!member && !formerParty) throw new NotFoundException();
      const eligible = await this.rt.groupUsers(tx, groupId);
      return work(
        tx,
        now,
        {
          groupId,
          activityId: null,
          eligible,
          approvers: await this.groupAdmins(tx, groupId),
          actors: await this.actorIndex(tx, groupId),
          approver:
            member &&
            (await this.rt.can(tx, actor, groupId, 'settings.manage', locked)),
          member,
          open: true,
          former: formerParty,
          parties: parties(tx, { groupId }, eligible),
        },
        locked,
      );
    });
  }
  /** A deleted (or policy-blocked) Group whose ledger records are retained. */
  private async retained(groupId: string) {
    const custody = await this.rt.db.client.sharedCustody.findUnique({
      where: { spaceId: groupId },
      select: { kind: true, state: true },
    });
    return custody?.kind === 'SOCIAL_GROUP' && custody.state !== 'ACTIVE';
  }
  /**
   * P6-06 owner decision (ADR 0066 C): after Group deletion — including after
   * the recovery deadline — a party with a nonzero balance keeps only their own
   * balance, settlements and settlement recording/decisions. No Group fence
   * applies (nobody holds a seat); the verified-account fence and the existing
   * counterparty, revision, idempotency and audit rules do. Everyone else: 404.
   */
  private retainedLedger<T>(
    actor: RequestActor,
    users: string[],
    where: Where,
    work: (tx: Tx, now: Date, l: Ledger, locked: string[]) => Promise<T>,
    lock?: (tx: Tx) => Promise<void>,
  ) {
    return this.rt.kernel.contactOperation(
      actor,
      users,
      async (tx, now, locked) => {
        await this.rt.context.owner(tx, actor.userId);
        await lock?.(tx);
        if (!(await this.owes(tx, where, actor.userId)))
          throw new NotFoundException();
        const none = new Set<string>();
        return work(
          tx,
          now,
          {
            groupId: 'groupId' in where ? where.groupId : null,
            activityId: 'activityId' in where ? where.activityId : null,
            eligible: none,
            approvers: [],
            actors:
              'groupId' in where
                ? await this.actorIndex(tx, where.groupId)
                : new Map(),
            approver: false,
            member: false,
            open: true,
            former: true,
            parties: async () =>
              new Set((await this.open(tx, where)).map((r) => r.userId)),
          },
          locked,
        );
      },
    );
  }
  /** Effective balances of one ledger (approved revisions, confirmed settlements). */
  private async ledger(tx: Tx, where: Where) {
    const effective = await tx.socialExpenseRevision.findMany({
      where: {
        state: 'APPROVED',
        effectiveFor: { is: { ...where, state: 'APPROVED' } },
      },
      include: { shares: true },
      take: LIMIT + 1,
    });
    const settled = await tx.socialSettlement.findMany({
      where: { ...where, state: 'CONFIRMED' },
      take: LIMIT + 1,
    });
    if (effective.length > LIMIT || settled.length > LIMIT)
      throw new PayloadTooLargeException();
    return balances(effective, settled);
  }
  private async open(tx: Tx, where: Where) {
    return (await this.ledger(tx, where)).filter((r) => r.netMinor !== 0n);
  }
  private async owes(tx: Tx, where: Where, userId: string) {
    return (await this.open(tx, where)).some((r) => r.userId === userId);
  }
  /** Group ledger plus the Group's Activity ledgers, bounded. */
  private async groupLedgers(tx: Tx, groupId: string, userId?: string) {
    const acts = await tx.socialActivity.findMany({
      where: {
        groupId,
        // A departing person's guest participation is independent of the Group.
        ...(userId ? { participants: { some: { userId, guest: false } } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: LIMIT + 1,
    });
    if (acts.length > LIMIT) throw new PayloadTooLargeException();
    return [
      { kind: 'GROUP' as const, id: groupId, where: { groupId } },
      ...acts.map((a) => ({
        kind: 'ACTIVITY' as const,
        id: a.id,
        where: { activityId: a.id },
      })),
    ];
  }
  /**
   * P6-06: the person's own nonzero balances that Group departure affects.
   * Amounts only; never counterparties, names or expense content.
   */
  async departureObligations(
    tx: Tx,
    groupId: string,
    userId: string,
  ): Promise<SocialObligation[]> {
    const out: SocialObligation[] = [];
    for (const l of await this.groupLedgers(tx, groupId, userId))
      for (const r of await this.open(tx, l.where))
        if (r.userId === userId)
          out.push({
            ledgerKind: l.kind,
            ledgerId: l.id,
            currency: r.currency,
            netMinor: r.netMinor.toString(),
            owedMinor: r.owedMinor.toString(),
            receivableMinor: r.receivableMinor.toString(),
          });
    return out;
  }
  /** P6-06: Group-wide open balances (counts only) for the deleting owner. */
  async groupOutstanding(tx: Tx, groupId: string) {
    const ledgers: string[] = [],
      parties = new Set<string>(),
      fingerprint: string[] = [];
    for (const l of await this.groupLedgers(tx, groupId)) {
      const rows = await this.open(tx, l.where);
      if (rows.length) ledgers.push(l.id);
      for (const r of rows) {
        parties.add(r.userId);
        fingerprint.push(`${l.id}:${r.userId}:${r.currency}:${r.netMinor}`);
      }
    }
    return {
      ledgerCount: ledgers.length,
      partyCount: parties.size,
      fingerprint: fingerprint.sort(),
    };
  }
  private async groupAdmins(tx: Tx, groupId: string) {
    const custody = await tx.sharedCustody.findUnique({
      where: { spaceId: groupId },
    });
    const seats = await tx.contextAccess.findMany({
      where: {
        spaceId: groupId,
        scopeId: groupId,
        state: 'ACTIVE',
        OR: [
          { memberRole: 'ADMIN' },
          ...(custody?.primaryOwnerAccessId
            ? [{ id: custody.primaryOwnerAccessId }]
            : []),
        ],
      },
      select: { actorId: true },
    });
    const actors = await tx.sharedActor.findMany({
      where: {
        spaceId: groupId,
        id: { in: seats.map((s) => s.actorId) },
        state: 'ACTIVE',
      },
      select: { userId: true },
    });
    return actors.flatMap((a) => (a.userId ? [a.userId] : []));
  }
  private where(l: Ledger) {
    return l.activityId
      ? { activityId: l.activityId }
      : { groupId: l.groupId! };
  }
  private async actorIndex(tx: Tx, groupId: string) {
    const rows = await tx.sharedActor.findMany({
      where: { spaceId: groupId, userId: { not: null } },
      select: { id: true, userId: true },
    });
    return new Map(rows.map((a) => [a.userId!, a.id]));
  }
  /**
   * D3: Group-scoped actor IDs resolve server-side to the account behind that
   * actor in this Group only. Unknown, erased or other-Group actors resolve to
   * a sentinel that fails the in-transaction eligibility check (422) after
   * authorization, so non-members cannot probe actor IDs.
   */
  private async resolve(
    ref: LedgerRef,
    refs: (string | undefined)[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(refs.filter((v): v is string => !!v))];
    if (!ids.length) return new Map();
    if (ref.kind !== 'GROUP')
      throw new UnprocessableEntityException({
        code: 'ACTOR_REFERENCE_UNSUPPORTED',
      });
    const rows = await this.rt.db.client.sharedActor.findMany({
      where: { spaceId: ref.id, id: { in: ids } },
      select: { id: true, userId: true },
    });
    return new Map(rows.flatMap((a) => (a.userId ? [[a.id, a.userId]] : [])));
  }
  private async canonical(ref: LedgerRef, body: Input): Promise<Resolved> {
    const map = await this.resolve(ref, [
      body.payerActorId,
      ...body.shares.map((s) => s.actorId),
    ]);
    const user = (userId?: string, actorId?: string) =>
      userId ?? map.get(actorId!) ?? UNRESOLVED;
    const { payerActorId: _payer, payerUserId: _user, ...rest } = body;
    return {
      ...rest,
      payerUserId: user(body.payerUserId, body.payerActorId),
      shares: body.shares.map((s) => ({
        userId: user(s.userId, s.actorId),
        ...(s.value === undefined ? {} : { value: s.value }),
      })),
    };
  }
  private people(body: Resolved) {
    return [body.payerUserId, ...body.shares.map((s) => s.userId)].filter(
      (u) => u !== UNRESOLVED,
    );
  }
  private allocate(l: Ledger, body: Resolved) {
    const people = [body.payerUserId, ...body.shares.map((s) => s.userId)];
    if (people.some((u) => !l.eligible.has(u)))
      throw new UnprocessableEntityException({
        code: 'PARTICIPANT_INELIGIBLE',
      });
    try {
      return split(
        BigInt(body.amountMinor),
        body.method,
        body.shares.map((s) => ({
          userId: s.userId,
          value: s.value === undefined ? undefined : BigInt(s.value),
        })),
        body.payerUserId,
      );
    } catch (e) {
      if (e instanceof SplitError)
        throw new UnprocessableEntityException({ code: e.code });
      throw e;
    }
  }
  private async addRevision(
    tx: Tx,
    actor: RequestActor,
    expenseId: string,
    number: number,
    body: Resolved,
    shares: ReturnType<typeof split>,
  ) {
    return tx.socialExpenseRevision.create({
      data: {
        id: randomUUID(),
        expenseId,
        number,
        title: body.title,
        note: body.note ?? null,
        currency: body.currency,
        scale: c.financeCurrencyScales[body.currency]!,
        amountMinor: BigInt(body.amountMinor),
        payerUserId: body.payerUserId,
        method: body.method,
        incurredOn: new Date(body.incurredOn + 'T00:00:00.000Z'),
        proposedByUserId: actor.userId,
        shares: {
          create: shares.map((s, i) => ({
            position: i + 1,
            userId: s.userId,
            input: s.input,
            shareMinor: s.shareMinor,
          })),
        },
      },
    });
  }
  private revisionView(
    r: Revision | null,
    me: string,
    full: boolean,
    actors: Map<string, string>,
  ) {
    const actorOf = (u: string | null) => (u && actors.get(u)) || null;
    if (!r) return null;
    return c.SocialExpenseRevisionSchema.parse({
      id: r.id,
      number: r.number,
      state: r.state,
      title: r.title,
      note: r.note,
      currency: r.currency,
      scale: r.scale,
      amountMinor: r.amountMinor.toString(),
      payerUserId: r.payerUserId,
      payerActorId: actorOf(r.payerUserId),
      method: r.method,
      incurredOn: r.incurredOn.toISOString().slice(0, 10),
      proposedByUserId: r.proposedByUserId,
      decidedByUserId: r.decidedByUserId,
      decidedAt: iso(r.decidedAt),
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
      // Non-approvers see only their own share of other participants' allocations.
      sharesRestricted: !full,
      shares: r.shares
        .filter((s) => full || s.userId === me)
        .sort((a, b) => a.position - b.position)
        .map((s) => ({
          position: s.position,
          userId: s.userId,
          actorId: actorOf(s.userId),
          input: s.input === null ? null : s.input.toString(),
          shareMinor: s.shareMinor.toString(),
        })),
    });
  }
  private async load(tx: Tx, l: Ledger, expenseId: string) {
    const row = await tx.socialExpense.findFirst({
      where: { id: expenseId, ...this.where(l) },
      include: {
        revisions: { include: { shares: true }, orderBy: { number: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  private involved(row: ExpenseRow, me: string) {
    return (
      row.proposedByUserId === me ||
      row.revisions.some(
        (r) =>
          ['PENDING', 'APPROVED'].includes(r.state) &&
          (r.payerUserId === me ||
            r.proposedByUserId === me ||
            r.shares.some((s) => s.userId === me)),
      )
    );
  }
  private view(row: ExpenseRow, l: Ledger, me: string) {
    const effective =
      row.revisions.find((r) => r.id === row.effectiveRevisionId) ?? null;
    const pending = row.revisions.find((r) => r.state === 'PENDING') ?? null;
    return c.SocialExpenseSchema.parse({
      id: row.id,
      groupId: row.groupId,
      activityId: row.activityId,
      state: row.state,
      proposedByUserId: row.proposedByUserId,
      revision: row.revision,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      canDecide: l.approver && !!pending,
      effective: this.revisionView(effective, me, l.approver, l.actors),
      pending: this.revisionView(pending, me, l.approver, l.actors),
    });
  }
  private readable(row: ExpenseRow, l: Ledger, me: string) {
    if (!l.approver && !this.involved(row, me)) throw new NotFoundException();
  }
  async create(
    actor: RequestActor,
    ref: LedgerRef,
    body: z.infer<typeof c.SocialExpenseCreateSchema>,
    key: string | undefined,
  ) {
    const keyHash = socialKey(key);
    const { id, ...input } = body,
      resolved = await this.canonical(ref, input);
    const users = this.people(resolved);
    return this.run(actor, ref, users, async (tx, now, l) => {
      // Any verified current Group member or accepted Activity participant may propose.
      if (!l.member)
        throw new ForbiddenException({ code: 'LEDGER_PARTICIPATION_REQUIRED' });
      return this.rt.once(
        tx,
        actor,
        'social.expense.create',
        key,
        { ref, body },
        now,
        async () => {
          if (!l.open)
            throw new ConflictException({ code: 'ACTIVITY_NOT_OPEN' });
          if (await tx.socialExpense.findUnique({ where: { id } }))
            throw new ConflictException({ code: 'EXPENSE_EXISTS' });
          if ((await tx.socialExpense.count({ where: this.where(l) })) >= LIMIT)
            throw new PayloadTooLargeException();
          const shares = this.allocate(l, resolved);
          await tx.socialExpense.create({
            data: {
              id,
              ...this.where(l),
              proposedByUserId: actor.userId,
              creationKeyHash: keyHash,
              creationFingerprint: socialHash(body),
            },
          });
          await this.addRevision(tx, actor, id, 1, resolved, shares);
          await this.rt.notify(
            tx,
            l.approvers.filter((u) => u !== actor.userId),
            {
              activityId: l.activityId,
              groupId: l.groupId,
              kind: 'EXPENSE_PROPOSED',
              resourceId: id,
              dedupe: `${id}:1`,
            },
          );
          await this.rt.record(tx, actor, l, 'social.expense.propose', id);
          return {
            resultId: id,
            value: this.view(await this.load(tx, l, id), l, actor.userId),
          };
        },
      );
    });
  }
  async list(actor: RequestActor, ref: LedgerRef, q: Page) {
    return this.run(actor, ref, [], async (tx, _now, l) => {
      const rows = await tx.socialExpense.findMany({
        where: this.where(l),
        include: {
          revisions: { include: { shares: true }, orderBy: { number: 'asc' } },
        },
        orderBy: { id: 'asc' },
        take: LIMIT + 1,
      });
      if (rows.length > LIMIT) throw new PayloadTooLargeException();
      const items = rows
        .filter((r) => l.approver || this.involved(r, actor.userId))
        .map((r) => this.view(r, l, actor.userId));
      return this.rt.context.page(
        actor,
        'social.expenses:' + ref.kind + ':' + ref.id,
        socialHash([l.approver, items.map((i) => [i.id, i.revision])]),
        q,
        items,
      );
    });
  }
  async read(actor: RequestActor, ref: LedgerRef, expenseId: string) {
    return this.run(actor, ref, [], async (tx, _now, l) => {
      const row = await this.load(tx, l, expenseId);
      this.readable(row, l, actor.userId);
      return this.view(row, l, actor.userId);
    });
  }
  async history(actor: RequestActor, ref: LedgerRef, expenseId: string) {
    return this.run(actor, ref, [], async (tx, _now, l) => {
      const row = await this.load(tx, l, expenseId);
      this.readable(row, l, actor.userId);
      return c.SocialExpenseHistorySchema.parse({
        items: row.revisions.map((r) =>
          this.revisionView(r, actor.userId, l.approver, l.actors),
        ),
      });
    });
  }
  private async lockExpense(tx: Tx, l: Ledger, expenseId: string) {
    await tx.$queryRaw`SELECT id FROM "SocialExpense" WHERE id=${expenseId}::uuid FOR UPDATE`;
    return this.load(tx, l, expenseId);
  }
  /** Correction of an approved record, or replacement of a pending proposal; never immediately effective. */
  async revise(
    actor: RequestActor,
    ref: LedgerRef,
    expenseId: string,
    body: Input,
    revision: number,
    key: string | undefined,
  ) {
    const resolved = await this.canonical(ref, body);
    const users = this.people(resolved);
    return this.run(actor, ref, users, async (tx, now, l) => {
      if (!l.member && !l.approver) throw new NotFoundException();
      return this.rt.once(
        tx,
        actor,
        'social.expense.revise',
        key,
        { ref, expenseId, body, revision },
        now,
        async () => {
          const row = await this.lockExpense(tx, l, expenseId);
          this.readable(row, l, actor.userId);
          socialRevision(revision, row.revision);
          if (!l.open)
            throw new ConflictException({ code: 'ACTIVITY_NOT_OPEN' });
          if (!['PENDING', 'APPROVED'].includes(row.state))
            throw new ConflictException({ code: 'EXPENSE_NOT_REVISABLE' });
          if (!l.approver && row.proposedByUserId !== actor.userId)
            throw new ForbiddenException({
              code: 'EXPENSE_PERMISSION_REQUIRED',
            });
          const pending = row.revisions.find((r) => r.state === 'PENDING');
          if (pending)
            await tx.socialExpenseRevision.update({
              where: { id: pending.id },
              data: { state: 'WITHDRAWN' },
            });
          const shares = this.allocate(l, resolved);
          await this.addRevision(
            tx,
            actor,
            expenseId,
            row.revisions.length + 1,
            resolved,
            shares,
          );
          await tx.socialExpense.update({
            where: { id: expenseId },
            data: { revision: { increment: 1 }, updatedAt: now },
          });
          await this.rt.notify(
            tx,
            l.approvers.filter((u) => u !== actor.userId),
            {
              activityId: l.activityId,
              groupId: l.groupId,
              kind: 'EXPENSE_PROPOSED',
              resourceId: expenseId,
              dedupe: `${expenseId}:${row.revisions.length + 1}`,
            },
          );
          await this.rt.record(
            tx,
            actor,
            l,
            'social.expense.revise',
            expenseId,
          );
          return {
            resultId: expenseId,
            value: this.view(
              await this.load(tx, l, expenseId),
              l,
              actor.userId,
            ),
          };
        },
      );
    });
  }
  async decide(
    actor: RequestActor,
    ref: LedgerRef,
    expenseId: string,
    action: z.infer<typeof c.SocialExpenseDecisionActionSchema>,
    body: z.infer<typeof c.SocialExpenseDecisionSchema>,
    revision: number,
    key: string | undefined,
  ) {
    // Notices take recipient User FK locks. Predeclare those accounts before
    // taking the Activity/expense lock, using the existing sorted identity fence.
    const hints =
      action === 'withdraw'
        ? null
        : await this.rt.db.client.socialExpense.findFirst({
            where: {
              id: expenseId,
              ...(ref.kind === 'ACTIVITY'
                ? { activityId: ref.id }
                : { groupId: ref.id }),
            },
            select: {
              revisions: {
                where: { state: 'PENDING' },
                take: 1,
                orderBy: { number: 'desc' },
                select: {
                  proposedByUserId: true,
                  payerUserId: true,
                  shares: { select: { userId: true } },
                },
              },
            },
          });
    const recipients =
      hints?.revisions
        .flatMap((r) => [
          r.proposedByUserId,
          r.payerUserId,
          ...r.shares.map((s) => s.userId),
        ])
        .filter((id): id is string => !!id) ?? [];
    return this.run(actor, ref, recipients, async (tx, now, l, locked) => {
      if (action !== 'withdraw' && !l.approver)
        throw new ForbiddenException({ code: 'EXPENSE_APPROVER_REQUIRED' });
      return this.rt.once(
        tx,
        actor,
        'social.expense.' + action,
        key,
        { ref, expenseId, body, revision },
        now,
        async () => {
          const row = await this.lockExpense(tx, l, expenseId);
          this.readable(row, l, actor.userId);
          socialRevision(revision, row.revision);
          const pending = row.revisions.find((r) => r.state === 'PENDING');
          // Concurrent or repeated decisions find no pending revision and cannot double-apply.
          if (!pending)
            throw new ConflictException({ code: 'EXPENSE_NOT_PENDING' });
          if (
            action !== 'withdraw' &&
            [
              pending.proposedByUserId,
              pending.payerUserId,
              ...pending.shares.map((s) => s.userId),
            ].some((id) => id && !locked.includes(id))
          )
            throw new ConflictException({
              code: 'EXPENSE_PARTICIPANTS_CHANGED',
            });
          if (
            action === 'withdraw' &&
            pending.proposedByUserId !== actor.userId
          )
            throw new ForbiddenException({
              code: 'EXPENSE_PERMISSION_REQUIRED',
            });
          if (action === 'approve') {
            const people = [
              pending.payerUserId,
              ...pending.shares.map((s) => s.userId),
            ];
            if (people.some((u) => !u || !l.eligible.has(u)))
              throw new ConflictException({ code: 'PARTICIPANT_INELIGIBLE' });
            const total = pending.shares.reduce((t, s) => t + s.shareMinor, 0n);
            if (total !== pending.amountMinor)
              throw new ConflictException({ code: 'SPLIT_TOTAL_MISMATCH' });
            if (row.effectiveRevisionId)
              await tx.socialExpenseRevision.update({
                where: { id: row.effectiveRevisionId },
                data: { state: 'SUPERSEDED' },
              });
          }
          await tx.socialExpenseRevision.update({
            where: { id: pending.id },
            data:
              action === 'withdraw'
                ? { state: 'WITHDRAWN' }
                : {
                    state: action === 'approve' ? 'APPROVED' : 'REJECTED',
                    decidedByUserId: actor.userId,
                    decidedAt: now,
                    decisionNote: body.note ?? null,
                  },
          });
          await tx.socialExpense.update({
            where: { id: expenseId },
            data: {
              ...(action === 'approve'
                ? { state: 'APPROVED', effectiveRevisionId: pending.id }
                : row.effectiveRevisionId
                  ? {}
                  : { state: action === 'reject' ? 'REJECTED' : 'WITHDRAWN' }),
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          if (action !== 'withdraw')
            await this.rt.notify(
              tx,
              [
                pending.proposedByUserId,
                pending.payerUserId,
                ...pending.shares.map((s) => s.userId),
              ].map((u) => (u === actor.userId ? null : u)),
              {
                activityId: l.activityId,
                groupId: l.groupId,
                kind: 'EXPENSE_DECIDED',
                resourceId: expenseId,
                dedupe: `${pending.id}`,
              },
            );
          await this.rt.record(
            tx,
            actor,
            l,
            'social.expense.' + action,
            expenseId,
          );
          return {
            resultId: expenseId,
            value: this.view(
              await this.load(tx, l, expenseId),
              l,
              actor.userId,
            ),
          };
        },
      );
    });
  }
  async balances(actor: RequestActor, ref: LedgerRef, all: boolean) {
    return this.run(
      actor,
      ref,
      [],
      async (tx, _now, l) => {
        // ADR 0051: members see their own balances; administrators see their whole scope.
        if (all && !l.approver)
          throw new ForbiddenException({ code: 'BALANCE_PERMISSION_REQUIRED' });
        const rows = (await this.ledger(tx, this.where(l))).filter(
          (r) => all || r.userId === actor.userId,
        );
        const names = new Map<string, string | null>();
        if (all)
          for (const r of rows)
            if (!names.has(r.userId))
              names.set(r.userId, await this.rt.displayName(tx, r.userId));
        return c.SocialBalanceListSchema.parse({
          items: rows.map((r) => ({
            userId: r.userId,
            actorId: l.actors.get(r.userId) ?? null,
            displayName: all ? (names.get(r.userId) ?? null) : null,
            currency: r.currency,
            paidMinor: r.paidMinor.toString(),
            shareMinor: r.shareMinor.toString(),
            settledOutMinor: r.settledOutMinor.toString(),
            settledInMinor: r.settledInMinor.toString(),
            netMinor: r.netMinor.toString(),
            owedMinor: r.owedMinor.toString(),
            receivableMinor: r.receivableMinor.toString(),
          })),
        });
      },
      true,
    );
  }
  private settlementView(
    r: Prisma.SocialSettlementGetPayload<object>,
    l: Ledger,
  ) {
    const actorOf = (u: string | null) => (u && l.actors.get(u)) || null;
    return c.SocialSettlementSchema.parse({
      id: r.id,
      groupId: r.groupId,
      activityId: r.activityId,
      payerUserId: r.payerUserId,
      payeeUserId: r.payeeUserId,
      payerActorId: actorOf(r.payerUserId),
      payeeActorId: actorOf(r.payeeUserId),
      currency: r.currency,
      scale: r.scale,
      amountMinor: r.amountMinor.toString(),
      state: r.state,
      note: r.note,
      disputeNote: r.disputeNote,
      revision: r.revision,
      createdAt: r.createdAt.toISOString(),
      decidedAt: iso(r.decidedAt),
    });
  }
  /** Recorded by the payer; becomes balance-effective only on counterparty confirmation. */
  async settle(
    actor: RequestActor,
    ref: LedgerRef,
    body: z.infer<typeof c.SocialSettlementCreateSchema>,
    key: string | undefined,
  ) {
    const keyHash = socialKey(key);
    const payeeUserId =
      body.payeeUserId ??
      (await this.resolve(ref, [body.payeeActorId])).get(body.payeeActorId!) ??
      UNRESOLVED;
    return this.run(
      actor,
      ref,
      payeeUserId === UNRESOLVED ? [] : [payeeUserId],
      async (tx, now, l) => {
        if (!l.member && !l.former)
          throw new ForbiddenException({
            code: 'LEDGER_PARTICIPATION_REQUIRED',
          });
        return this.rt.once(
          tx,
          actor,
          'social.settlement.create',
          key,
          { ref, body },
          now,
          async () => {
            // P6-06: a departed party with an open balance stays a counterparty.
            const parties = await l.parties();
            if (
              payeeUserId === actor.userId ||
              !parties.has(payeeUserId) ||
              !parties.has(actor.userId)
            )
              throw new UnprocessableEntityException({
                code: 'PARTICIPANT_INELIGIBLE',
              });
            if (
              await tx.socialSettlement.findUnique({ where: { id: body.id } })
            )
              throw new ConflictException({ code: 'SETTLEMENT_EXISTS' });
            if (
              (await tx.socialSettlement.count({ where: this.where(l) })) >=
              LIMIT
            )
              throw new PayloadTooLargeException();
            const row = await tx.socialSettlement.create({
              data: {
                id: body.id,
                ...this.where(l),
                payerUserId: actor.userId,
                payeeUserId: payeeUserId,
                currency: body.currency,
                scale: c.financeCurrencyScales[body.currency]!,
                amountMinor: BigInt(body.amountMinor),
                note: body.note ?? null,
                creationKeyHash: keyHash,
                creationFingerprint: socialHash(body),
              },
            });
            await this.rt.notify(tx, [payeeUserId], {
              activityId: l.activityId,
              groupId: l.groupId,
              kind: 'SETTLEMENT_RECORDED',
              resourceId: row.id,
              dedupe: row.id,
            });
            await this.rt.record(
              tx,
              actor,
              l,
              'social.settlement.record',
              row.id,
            );
            return { resultId: row.id, value: this.settlementView(row, l) };
          },
        );
      },
      true,
    );
  }
  async settlements(actor: RequestActor, ref: LedgerRef, q: Page) {
    return this.run(
      actor,
      ref,
      [],
      async (tx, _now, l) => {
        const rows = await tx.socialSettlement.findMany({
          where: {
            ...this.where(l),
            ...(l.approver
              ? {}
              : {
                  OR: [
                    { payerUserId: actor.userId },
                    { payeeUserId: actor.userId },
                  ],
                }),
          },
          orderBy: { id: 'asc' },
          take: LIMIT + 1,
        });
        if (rows.length > LIMIT) throw new PayloadTooLargeException();
        const items = rows.map((r) => this.settlementView(r, l));
        return this.rt.context.page(
          actor,
          'social.settlements:' + ref.kind + ':' + ref.id,
          socialHash([l.approver, items.map((i) => [i.id, i.revision])]),
          q,
          items,
        );
      },
      true,
    );
  }
  async decideSettlement(
    actor: RequestActor,
    ref: LedgerRef,
    settlementId: string,
    action: z.infer<typeof c.SocialSettlementActionSchema>,
    body: z.infer<typeof c.SocialSettlementDecisionSchema>,
    revision: number,
    key: string | undefined,
  ) {
    return this.run(
      actor,
      ref,
      [],
      async (tx, now, l) =>
        this.rt.once(
          tx,
          actor,
          'social.settlement.' + action,
          key,
          { ref, settlementId, body, revision },
          now,
          async () => {
            await tx.$queryRaw`SELECT id FROM "SocialSettlement" WHERE id=${settlementId}::uuid FOR UPDATE`;
            const row = await tx.socialSettlement.findFirst({
              where: { id: settlementId, ...this.where(l) },
            });
            if (
              !row ||
              (row.payerUserId !== actor.userId &&
                row.payeeUserId !== actor.userId &&
                !l.approver)
            )
              throw new NotFoundException();
            // Only the counterparty confirms or disputes; only the recording payer cancels.
            const party =
              action === 'cancel' ? row.payerUserId : row.payeeUserId;
            if (party !== actor.userId)
              throw new ForbiddenException({
                code: 'SETTLEMENT_COUNTERPARTY_REQUIRED',
              });
            socialRevision(revision, row.revision);
            if (
              !['RECORDED', 'DISPUTED'].includes(row.state) ||
              (action === 'dispute' && row.state !== 'RECORDED')
            )
              throw new ConflictException({ code: 'SETTLEMENT_NOT_PENDING' });
            if (action === 'dispute' && !body.note?.trim())
              throw new UnprocessableEntityException({
                code: 'DISPUTE_NOTE_REQUIRED',
              });
            if (action === 'confirm' && !(await l.parties()).has(actor.userId))
              throw new ConflictException({ code: 'PARTICIPANT_INELIGIBLE' });
            const changed = await tx.socialSettlement.update({
              where: { id: settlementId },
              data: {
                state:
                  action === 'confirm'
                    ? 'CONFIRMED'
                    : action === 'dispute'
                      ? 'DISPUTED'
                      : 'CANCELED',
                ...(action === 'dispute'
                  ? { disputeNote: body.note!.trim() }
                  : {}),
                decidedAt: action === 'cancel' ? row.decidedAt : now,
                revision: { increment: 1 },
              },
            });
            if (action !== 'cancel')
              await this.rt.notify(tx, [row.payerUserId], {
                activityId: l.activityId,
                groupId: l.groupId,
                kind: 'SETTLEMENT_DECIDED',
                resourceId: row.id,
                dedupe: `${row.id}:${changed.revision}`,
              });
            await this.rt.record(
              tx,
              actor,
              l,
              'social.settlement.' + action,
              row.id,
            );
            return { resultId: row.id, value: this.settlementView(changed, l) };
          },
        ),
      true,
    );
  }
  /**
   * ADR 0061: only the caller's own share of the currently effective approved
   * revision is postable, once per expense, into the caller's own Personal
   * Finance. Settlements are not postable (they would double-count the share).
   */
  private async ownShare(
    actor: RequestActor,
    ref: LedgerRef,
    expenseId: string,
  ) {
    return this.run(actor, ref, [], async (tx, _now, l) => {
      const row = await this.load(tx, l, expenseId);
      this.readable(row, l, actor.userId);
      const effective = row.revisions.find(
        (r) => r.id === row.effectiveRevisionId,
      );
      const share = effective?.shares.find((s) => s.userId === actor.userId);
      if (
        !effective ||
        row.state !== 'APPROVED' ||
        !share ||
        share.shareMinor <= 0n
      )
        throw new ConflictException({ code: 'NO_POSTABLE_SHARE' });
      return {
        expenseId,
        revisionId: effective.id,
        title: effective.title,
        currency: effective.currency,
        scale: effective.scale,
        amountMinor: share.shareMinor.toString(),
        localDate: effective.incurredOn.toISOString().slice(0, 10),
      };
    });
  }
  private postingInput(
    s: Awaited<ReturnType<SocialExpensesService['ownShare']>>,
    body: z.infer<typeof c.SocialFinancePostingRequestSchema>,
  ) {
    return {
      source: {
        kind: 'SOCIAL_EXPENSE_SHARE' as const,
        ref: s.expenseId,
        revisionRef: s.revisionId,
      },
      accountId: body.accountId,
      categoryId: body.categoryId,
      currency: s.currency,
      amountMinor: s.amountMinor,
      note: `Shared expense share: ${s.title} (${s.localDate})`.slice(0, 500),
    };
  }
  async financePreview(
    actor: RequestActor,
    ref: LedgerRef,
    expenseId: string,
    body: z.infer<typeof c.SocialFinancePostingRequestSchema>,
  ) {
    const scope = await this.spaces.authorizePersonal(actor);
    const s = await this.ownShare(actor, ref, expenseId);
    const p = await this.posting.preview(scope, this.postingInput(s, body));
    return c.SocialFinancePostingPreviewSchema.parse({
      expenseId,
      revisionId: s.revisionId,
      currency: s.currency,
      scale: s.scale,
      amountMinor: s.amountMinor,
      amount: p.amount,
      localDate: p.localDate,
      transactionType: p.transactionType,
      accountId: p.accountId,
      accountName: p.accountName,
      categoryId: p.categoryId,
      alreadyPosted: p.existing
        ? {
            transactionId: p.existing.transactionId,
            revisionId: p.existing.sourceRevisionRef,
          }
        : null,
    });
  }
  async financePost(
    actor: RequestActor,
    ref: LedgerRef,
    expenseId: string,
    body: z.infer<typeof c.SocialFinancePostingConfirmSchema>,
    key: string | undefined,
  ) {
    socialKey(key);
    const scope = await this.spaces.authorizePersonal(actor);
    const s = await this.ownShare(actor, ref, expenseId);
    // The user confirms exactly the previewed revision; a later revision needs a new review.
    if (body.revisionId !== s.revisionId)
      throw new ConflictException({ code: 'EXPENSE_CHANGED_REVIEW' });
    const r = await this.posting.post(scope, this.postingInput(s, body));
    return c.SocialFinancePostingResultSchema.parse({
      expenseId,
      revisionId: s.revisionId,
      transactionId: r.transactionId,
      created: r.created,
    });
  }
}
