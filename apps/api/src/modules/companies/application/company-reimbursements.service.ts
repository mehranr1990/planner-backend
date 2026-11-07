import {
  Inject,
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  CompanyExpenseVersion,
  CompanyReimbursementBucket,
  CompanyReimbursementRequest,
  CompanyPaymentAcknowledgement,
  CompanyAcknowledgementCorrection,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { amount, units } from '../../finance/public/index.js';
import { CompanyFinanceService } from './company-finance.service.js';
import { CompanyFinanceExtensions } from './company-finance.extensions.js';
import type {
  StaffContext,
  StaffPage,
  StaffMember,
} from './company-staff.context.js';
const dates = <T extends { createdAt: Date; updatedAt: Date }>(r: T) => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
type Effect = {
  kind: string;
  entitlement?: bigint;
  reserved?: bigint;
  acknowledged?: bigint;
  pending?: bigint;
  requestId?: string;
  paymentId?: string;
  correctionId?: string;
  sourceVersionId?: string;
};
@Injectable()
export class CompanyReimbursementsService implements OnModuleInit {
  constructor(
    @Inject(CompanyFinanceService) readonly finance: CompanyFinanceService,
    @Inject(CompanyFinanceExtensions)
    private readonly extensions: CompanyFinanceExtensions,
  ) {}
  onModuleInit() {
    this.extensions.reimbursements((s, id, v) => this.expenseChanged(s, id, v));
  }
  get op() {
    return this.finance.op;
  }
  async managerMember(s: StaffContext, m: StaffMember) {
    const member = await this.op.member(s, m);
    if (
      !(await this.op.access.staffReviewer(s, member)) &&
      !(s.scopeId !== s.spaceId && member.role === 'DEPT_MANAGER')
    )
      throw new ForbiddenException();
    return member;
  }
  async bucket(s: StaffContext, id: string) {
    const b = await s.tx.companyReimbursementBucket.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!b) throw new NotFoundException();
    return b;
  }
  async row(s: StaffContext, id: string) {
    const r = await s.tx.companyReimbursementRequest.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!r) throw new NotFoundException();
    return r;
  }
  audience(s: StaffContext, r: CompanyReimbursementRequest) {
    if (
      !this.finance.manager(s) &&
      !this.op.self(s, {
        accessId: r.beneficiaryAccessId,
        generation: r.beneficiaryGeneration,
      })
    )
      throw new NotFoundException();
  }
  claimant(s: StaffContext, r: CompanyReimbursementRequest) {
    if (
      !this.op.self(s, {
        accessId: r.beneficiaryAccessId,
        generation: r.beneficiaryGeneration,
      })
    )
      throw new ForbiddenException();
  }
  async eligibleSource(s: StaffContext, expenseId: string) {
    const expense = await this.finance.expenseRow(s, expenseId);
    const v = await this.finance.version(
      s,
      expenseId,
      expense.effectiveVersionId ?? undefined,
    );
    await this.finance.audience(s, v);
    if (expense.state !== 'APPROVED' || !expense.effectiveVersionId)
      throw new ConflictException({
        code: 'EFFECTIVE_APPROVED_EXPENSE_REQUIRED',
      });
    if (
      !v.payerAccessId ||
      !this.op.self(s, {
        accessId: v.payerAccessId,
        generation: v.payerGeneration!,
      })
    )
      throw new ForbiddenException();
    await this.op.member(s, {
      accessId: v.payerAccessId,
      generation: v.payerGeneration!,
    });
    return v;
  }
  async current(s: StaffContext, r: CompanyReimbursementRequest) {
    const b = await this.bucket(s, r.bucketId),
      expense = await this.finance.expenseRow(s, b.expenseId);
    if (
      expense.state !== 'APPROVED' ||
      expense.effectiveVersionId !== r.expenseVersionId
    )
      throw new ConflictException({ code: 'REIMBURSEMENT_SOURCE_SUPERSEDED' });
    const v = await this.finance.version(s, b.expenseId, r.expenseVersionId);
    if (
      v.payerAccessId !== r.beneficiaryAccessId ||
      v.payerGeneration !== r.beneficiaryGeneration ||
      v.currency !== b.currency
    )
      throw new ConflictException();
    await this.op.member(s, {
      accessId: r.beneficiaryAccessId,
      generation: r.beneficiaryGeneration,
    });
    return b;
  }
  async sums(
    s: StaffContext,
    b: CompanyReimbursementBucket,
    requestId?: string,
  ) {
    const rows = await s.tx.companyReimbursementEffect.findMany({
      where: {
        ...this.op.where(s),
        bucketId: b.id,
        ...(requestId ? { requestId } : {}),
      },
    });
    if (rows.length > 100000) throw new PayloadTooLargeException();
    const result = {
      entitlement: 0n,
      reserved: 0n,
      acknowledged: 0n,
      pending: 0n,
    };
    for (const row of rows)
      for (const key of [
        'entitlement',
        'reserved',
        'acknowledged',
        'pending',
      ] as const)
        result[key] += units(row[key].toString(), b.scale);
    return result;
  }
  async effect(s: StaffContext, b: CompanyReimbursementBucket, e: Effect) {
    const t = await this.sums(s, b);
    const next = {
      entitlement: t.entitlement + (e.entitlement ?? 0n),
      reserved: t.reserved + (e.reserved ?? 0n),
      acknowledged: t.acknowledged + (e.acknowledged ?? 0n),
      pending: t.pending + (e.pending ?? 0n),
    };
    if (
      Object.values(next).some((n) => n < 0n) ||
      next.pending > next.reserved ||
      next.reserved >
        (next.entitlement > next.acknowledged
          ? next.entitlement - next.acknowledged
          : 0n)
    )
      throw new ConflictException({ code: 'REIMBURSEMENT_BALANCE_CONFLICT' });
    await s.tx.companyReimbursementEffect.create({
      data: {
        ...this.op.where(s),
        id: randomUUID(),
        bucketId: b.id,
        kind: e.kind,
        requestId: e.requestId ?? null,
        paymentId: e.paymentId ?? null,
        correctionId: e.correctionId ?? null,
        sourceVersionId: e.sourceVersionId ?? null,
        createdByActorId: s.root.actorId,
        entitlement: amount(e.entitlement ?? 0n, b.scale),
        reserved: amount(e.reserved ?? 0n, b.scale),
        acknowledged: amount(e.acknowledged ?? 0n, b.scale),
        pending: amount(e.pending ?? 0n, b.scale),
      },
    });
  }
  async balanceView(s: StaffContext, b: CompanyReimbursementBucket) {
    const t = await this.sums(s, b),
      available = t.entitlement - t.acknowledged - t.reserved,
      excess = t.acknowledged - t.entitlement;
    return {
      ...dates(b),
      entitlement: amount(t.entitlement, b.scale),
      reserved: amount(t.reserved, b.scale),
      acknowledged: amount(t.acknowledged, b.scale),
      pending: amount(t.pending, b.scale),
      available: amount(available > 0n ? available : 0n, b.scale),
      excess: amount(excess > 0n ? excess : 0n, b.scale),
      reconciliationRequired: excess > 0n,
    };
  }
  async view(s: StaffContext, r: CompanyReimbursementRequest) {
    this.audience(s, r);
    const b = await this.bucket(s, r.bucketId),
      t = await this.sums(s, b, r.id),
      original = units(r.amount.toString(), b.scale);
    return c.CompanyReimbursementSchema.strip().parse({
      ...dates(r),
      beneficiary: {
        accessId: r.beneficiaryAccessId,
        generation: r.beneficiaryGeneration,
      },
      currency: b.currency,
      scale: b.scale,
      amount: amount(original, b.scale),
      reserved: amount(t.reserved, b.scale),
      acknowledged: amount(t.acknowledged, b.scale),
      pending: amount(t.pending, b.scale),
      settlement:
        t.acknowledged === 0n
          ? 'UNACKNOWLEDGED'
          : t.acknowledged === original
            ? 'FULL'
            : 'PARTIAL',
    });
  }
  read(actor: RequestActor, id: string, scopeId: string, target: string) {
    return this.finance.read(actor, id, scopeId, async (s) =>
      this.view(s, await this.row(s, target)),
    );
  }
  list(actor: RequestActor, id: string, scopeId: string, q: StaffPage) {
    return this.finance.read(actor, id, scopeId, (s) =>
      this.op.page(s, 'reimbursements', q, async () => {
        const rows = await s.tx.companyReimbursementRequest.findMany({
          where: {
            ...this.op.where(s),
            ...(this.finance.manager(s)
              ? {}
              : {
                  beneficiaryAccessId: s.me.accessId,
                  beneficiaryGeneration: s.me.generation,
                }),
          },
        });
        return Promise.all(rows.map((r) => this.view(s, r)));
      }),
    );
  }
  create(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyReimbursementCreateSchema>,
    key?: string,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      'reimbursement.create',
      input.id,
      async (s) => {
        const v = await this.eligibleSource(s, input.expenseId);
        const created = await this.op.once(
          s,
          'company.reimbursement.create',
          key,
          input,
          async () => {
            const m = this.finance.money(input.amount, v.currency),
              beneficiaryActorId = await this.op.access.financeActor(
                s,
                scopeId,
                { accessId: v.payerAccessId!, generation: v.payerGeneration! },
              );
            if (m.n > units(v.amount.toString(), v.scale))
              throw new ConflictException();
            await this.op.growth(
              s,
              'company.reimbursement-request',
              await s.tx.companyReimbursementRequest.count({
                where: this.op.where(s),
              }),
            );
            let b = await s.tx.companyReimbursementBucket.findFirst({
              where: {
                ...this.op.where(s),
                expenseId: input.expenseId,
                beneficiaryActorId,
                currency: v.currency,
              },
            });
            await s.change();
            if (!b) {
              b = await s.tx.companyReimbursementBucket.create({
                data: {
                  ...this.op.where(s),
                  id: randomUUID(),
                  expenseId: input.expenseId,
                  initialVersionId: v.id,
                  beneficiaryActorId,
                  currency: v.currency,
                  scale: v.scale,
                },
              });
              await this.effect(s, b, {
                kind: 'INITIAL',
                entitlement: units(v.amount.toString(), v.scale),
                sourceVersionId: v.id,
              });
            }
            await s.tx.companyReimbursementRequest.create({
              data: {
                ...this.op.where(s),
                id: input.id,
                bucketId: b.id,
                expenseVersionId: v.id,
                beneficiaryAccessId: v.payerAccessId!,
                beneficiaryGeneration: v.payerGeneration!,
                amount: m.value,
                state: 'DRAFT',
              },
            });
            return { id: input.id };
          },
        );
        return this.view(s, await this.row(s, created.id));
      },
    );
  }
  patch(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
    input: z.infer<typeof c.CompanyReimbursementPatchSchema>,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      'reimbursement.edit',
      target,
      async (s) => {
        const r = await this.row(s, target);
        this.audience(s, r);
        this.claimant(s, r);
        this.op.match(r.revision, revision);
        if (r.state !== 'DRAFT') throw new ConflictException();
        const b = await this.current(s, r),
          m = this.finance.money(input.amount, b.currency),
          v = await this.finance.version(s, b.expenseId, r.expenseVersionId);
        if (m.n > units(v.amount.toString(), v.scale))
          throw new ConflictException();
        await s.change();
        return this.view(
          s,
          await s.tx.companyReimbursementRequest.update({
            where: { id: r.id },
            data: { amount: m.value, ...this.op.changed(s) },
          }),
        );
      },
    );
  }
  cancel(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      'reimbursement.cancel',
      target,
      async (s) => {
        const r = await this.row(s, target);
        this.audience(s, r);
        this.claimant(s, r);
        this.op.match(r.revision, revision);
        if (!['DRAFT', 'SUBMITTED'].includes(r.state))
          throw new ConflictException();
        await s.change();
        await this.extensions.cancel(s, { reimbursementId: r.id });
        return this.view(
          s,
          await s.tx.companyReimbursementRequest.update({
            where: { id: r.id },
            data: { state: 'CANCELED', ...this.op.changed(s) },
          }),
        );
      },
    );
  }
  async approveWithin(
    s: StaffContext,
    r: CompanyReimbursementRequest,
    approve: boolean,
  ) {
    if (r.state !== 'SUBMITTED') throw new ConflictException();
    const b = await this.current(s, r);
    await s.change();
    const row = await s.tx.companyReimbursementRequest.update({
      where: { id: r.id },
      data: { state: approve ? 'APPROVED' : 'REJECTED', ...this.op.changed(s) },
    });
    if (approve)
      await this.effect(s, b, {
        kind: 'APPROVAL',
        requestId: r.id,
        sourceVersionId: r.expenseVersionId,
        reserved: units(r.amount.toString(), b.scale),
      });
    return row;
  }
  close(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      'reimbursement.close',
      target,
      async (s) => {
        const r = await this.row(s, target);
        this.audience(s, r);
        this.claimant(s, r);
        this.op.match(r.revision, revision);
        if (r.state !== 'APPROVED') throw new ConflictException();
        const b = await this.bucket(s, r.bucketId),
          t = await this.sums(s, b, r.id);
        if (t.pending) throw new ConflictException();
        await s.change();
        await this.effect(s, b, {
          kind: 'CLOSE',
          requestId: r.id,
          reserved: -t.reserved,
        });
        return this.view(
          s,
          await s.tx.companyReimbursementRequest.update({
            where: { id: r.id },
            data: { state: 'CLOSED', ...this.op.changed(s) },
          }),
        );
      },
    );
  }
  balances(
    actor: RequestActor,
    id: string,
    scopeId: string,
    expenseId: string,
    q: StaffPage,
  ) {
    return this.finance.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      await this.finance.expenseRow(s, expenseId);
      return this.op.page(
        s,
        'reimbursement.balances:' + expenseId,
        q,
        async () =>
          Promise.all(
            (
              await s.tx.companyReimbursementBucket.findMany({
                where: { ...this.op.where(s), expenseId },
              })
            ).map((b) => this.balanceView(s, b)),
          ),
      );
    });
  }
  history(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    q: StaffPage,
  ) {
    return this.finance.read(actor, id, scopeId, async (s) => {
      const r = await this.row(s, target);
      this.audience(s, r);
      const b = await this.bucket(s, r.bucketId);
      return this.op.page(s, 'reimbursement.history:' + target, q, async () =>
        (
          await s.tx.companyReimbursementEffect.findMany({
            where: { ...this.op.where(s), requestId: r.id },
          })
        ).map((e) => ({
          ...dates(e),
          entitlement: amount(
            units(e.entitlement.toString(), b.scale),
            b.scale,
          ),
          reserved: amount(units(e.reserved.toString(), b.scale), b.scale),
          acknowledged: amount(
            units(e.acknowledged.toString(), b.scale),
            b.scale,
          ),
          pending: amount(units(e.pending.toString(), b.scale), b.scale),
        })),
      );
    });
  }
  async paymentRow(s: StaffContext, id: string) {
    const p = await s.tx.companyPaymentAcknowledgement.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!p) throw new NotFoundException();
    const r = await this.row(s, p.requestId);
    this.audience(s, r);
    return { p, r, b: await this.bucket(s, r.bucketId) };
  }
  paymentView(p: CompanyPaymentAcknowledgement, b: CompanyReimbursementBucket) {
    return {
      ...dates(p),
      amount: amount(units(p.amount.toString(), b.scale), b.scale),
      author: { accessId: p.authorAccessId, generation: p.authorGeneration },
    };
  }
  payments(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    q: StaffPage,
  ) {
    return this.finance.read(actor, id, scopeId, async (s) => {
      const r = await this.row(s, target);
      this.audience(s, r);
      const b = await this.bucket(s, r.bucketId);
      return this.op.page(s, 'reimbursement.payments:' + target, q, async () =>
        (
          await s.tx.companyPaymentAcknowledgement.findMany({
            where: { ...this.op.where(s), requestId: r.id },
          })
        ).map((p) => this.paymentView(p, b)),
      );
    });
  }
  payment(actor: RequestActor, id: string, scopeId: string, target: string) {
    return this.finance.read(actor, id, scopeId, async (s) => {
      const { p, b } = await this.paymentRow(s, target);
      return this.paymentView(p, b);
    });
  }
  proposePayment(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    input: z.infer<typeof c.CompanyPaymentAcknowledgementCreateSchema>,
    key?: string,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      'payment.propose',
      input.id,
      async (s) => {
        this.op.manage(s);
        const r = await this.row(s, target);
        if (
          r.state !== 'APPROVED' ||
          this.op.self(s, {
            accessId: r.beneficiaryAccessId,
            generation: r.beneficiaryGeneration,
          })
        )
          throw new ForbiddenException();
        const b = await this.current(s, r);
        const created = await this.op.once(
          s,
          'company.payment.propose',
          key,
          { target, input },
          async () => {
            const m = this.finance.money(input.amount, b.currency),
              t = await this.sums(s, b, r.id);
            if (m.n > t.reserved - t.pending) throw new ConflictException();
            await this.op.growth(
              s,
              'company.payment-acknowledgement',
              await s.tx.companyPaymentAcknowledgement.count({
                where: this.op.where(s),
              }),
            );
            await s.change();
            await s.tx.companyPaymentAcknowledgement.create({
              data: {
                ...this.op.where(s),
                id: input.id,
                requestId: r.id,
                bucketId: b.id,
                authorAccessId: s.me.accessId,
                authorGeneration: s.me.generation,
                amount: m.value,
                reference: input.reference,
                state: 'PROPOSED',
              },
            });
            await this.effect(s, b, {
              kind: 'PROPOSE',
              requestId: r.id,
              paymentId: input.id,
              pending: m.n,
            });
            return { id: input.id };
          },
        );
        const { p } = await this.paymentRow(s, created.id);
        return this.paymentView(p, b);
      },
    );
  }
  paymentDecision(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
    input: z.infer<typeof c.CompanyPaymentAcknowledgementDecisionSchema> | null,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      input ? 'payment.decide' : 'payment.cancel',
      target,
      async (s) => {
        const { p, r, b } = await this.paymentRow(s, target);
        this.op.match(p.revision, revision);
        if (p.state !== 'PROPOSED') throw new ConflictException();
        if (input) {
          this.claimant(s, r);
          if (input.decision === 'ACKNOWLEDGE') {
            if (r.state !== 'APPROVED') throw new ConflictException();
            await this.current(s, r);
            await this.managerMember(s, {
              accessId: p.authorAccessId,
              generation: p.authorGeneration,
            });
          }
        } else {
          if (
            !this.op.self(s, {
              accessId: p.authorAccessId,
              generation: p.authorGeneration,
            })
          )
            throw new ForbiddenException();
          this.op.manage(s);
        }
        const confirm = input?.decision === 'ACKNOWLEDGE',
          n = units(p.amount.toString(), b.scale);
        await s.change();
        await this.effect(s, b, {
          kind: confirm ? 'ACKNOWLEDGE' : input ? 'DISPUTE' : 'CANCEL',
          requestId: r.id,
          paymentId: p.id,
          pending: -n,
          ...(confirm ? { acknowledged: n, reserved: -n } : {}),
        });
        const row = await s.tx.companyPaymentAcknowledgement.update({
          where: { id: p.id },
          data: {
            state: confirm ? 'ACKNOWLEDGED' : input ? 'DISPUTED' : 'CANCELED',
            ...this.op.changed(s),
          },
        });
        return this.paymentView(row, b);
      },
    );
  }
  async correctionRow(s: StaffContext, id: string) {
    const row = await s.tx.companyAcknowledgementCorrection.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!row) throw new NotFoundException();
    return { correction: row, ...(await this.paymentRow(s, row.paymentId)) };
  }
  correctionView(
    row: CompanyAcknowledgementCorrection,
    b: CompanyReimbursementBucket,
  ) {
    return {
      ...dates(row),
      amount: amount(units(row.amount.toString(), b.scale), b.scale),
      author: {
        accessId: row.authorAccessId,
        generation: row.authorGeneration,
      },
    };
  }
  corrections(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    q: StaffPage,
  ) {
    return this.finance.read(actor, id, scopeId, async (s) => {
      const { p, b } = await this.paymentRow(s, target);
      return this.op.page(s, 'payment.corrections:' + target, q, async () =>
        (
          await s.tx.companyAcknowledgementCorrection.findMany({
            where: { ...this.op.where(s), paymentId: p.id },
          })
        ).map((row) => this.correctionView(row, b)),
      );
    });
  }
  proposeCorrection(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    input: z.infer<typeof c.CompanyAcknowledgementCorrectionCreateSchema>,
    key?: string,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      'acknowledgement.correct',
      input.id,
      async (s) => {
        this.op.manage(s);
        const { p, r, b } = await this.paymentRow(s, target);
        if (
          p.state !== 'ACKNOWLEDGED' ||
          this.op.self(s, {
            accessId: r.beneficiaryAccessId,
            generation: r.beneficiaryGeneration,
          })
        )
          throw new ForbiddenException();
        await this.op.member(s, {
          accessId: r.beneficiaryAccessId,
          generation: r.beneficiaryGeneration,
        });
        const created = await this.op.once(
          s,
          'company.acknowledgement.correct',
          key,
          { target, input },
          async () => {
            const m = this.finance.money(input.amount, b.currency),
              rows = await s.tx.companyAcknowledgementCorrection.findMany({
                where: {
                  ...this.op.where(s),
                  paymentId: p.id,
                  state: { in: ['PROPOSED', 'ACKNOWLEDGED'] },
                },
              });
            const remaining = rows.reduce(
              (n, x) => n - units(x.amount.toString(), b.scale),
              units(p.amount.toString(), b.scale),
            );
            if (m.n > remaining) throw new ConflictException();
            await this.op.growth(
              s,
              'company.acknowledgement-correction',
              await s.tx.companyAcknowledgementCorrection.count({
                where: this.op.where(s),
              }),
            );
            await s.change();
            await s.tx.companyAcknowledgementCorrection.create({
              data: {
                ...this.op.where(s),
                id: input.id,
                paymentId: p.id,
                requestId: r.id,
                bucketId: b.id,
                authorAccessId: s.me.accessId,
                authorGeneration: s.me.generation,
                amount: m.value,
                reason: input.reason,
                state: 'PROPOSED',
              },
            });
            return { id: input.id };
          },
        );
        return this.correctionView(
          (await this.correctionRow(s, created.id)).correction,
          b,
        );
      },
    );
  }
  correctionDecision(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
    input: z.infer<
      typeof c.CompanyAcknowledgementCorrectionDecisionSchema
    > | null,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      input ? 'acknowledgement.decide' : 'acknowledgement.cancel',
      target,
      async (s) => {
        const {
          correction: row,
          p,
          r,
          b,
        } = await this.correctionRow(s, target);
        this.op.match(row.revision, revision);
        if (row.state !== 'PROPOSED' || p.state !== 'ACKNOWLEDGED')
          throw new ConflictException();
        if (input) {
          this.claimant(s, r);
          if (input.decision === 'ACKNOWLEDGE')
            await this.managerMember(s, {
              accessId: row.authorAccessId,
              generation: row.authorGeneration,
            });
        } else {
          if (
            !this.op.self(s, {
              accessId: row.authorAccessId,
              generation: row.authorGeneration,
            })
          )
            throw new ForbiddenException();
          this.op.manage(s);
        }
        await s.change();
        const accepted = input?.decision === 'ACKNOWLEDGE';
        if (accepted) {
          const n = units(row.amount.toString(), b.scale);
          let reserved = 0n;
          if (r.state === 'APPROVED') {
            const source = await this.finance.expenseRow(s, b.expenseId);
            if (
              source.state === 'APPROVED' &&
              source.effectiveVersionId === r.expenseVersionId
            )
              reserved = n;
          }
          await this.effect(s, b, {
            kind: 'CORRECTION',
            requestId: r.id,
            paymentId: p.id,
            correctionId: row.id,
            acknowledged: -n,
            reserved,
          });
        }
        return this.correctionView(
          await s.tx.companyAcknowledgementCorrection.update({
            where: { id: row.id },
            data: {
              state: accepted
                ? 'ACKNOWLEDGED'
                : input
                  ? 'DECLINED'
                  : 'CANCELED',
              ...this.op.changed(s),
            },
          }),
          b,
        );
      },
    );
  }
  async expenseChanged(
    s: StaffContext,
    expenseId: string,
    v: CompanyExpenseVersion | null,
  ) {
    const buckets = await s.tx.companyReimbursementBucket.findMany({
      where: { ...this.op.where(s), expenseId },
    });
    if (!buckets.length) return;
    const changedVersion = v ?? (await this.finance.version(s, expenseId));
    const actorId = v?.payerAccessId
      ? await this.op.access.financeActor(s, s.scopeId, {
          accessId: v.payerAccessId,
          generation: v.payerGeneration!,
        })
      : null;
    for (const b of buckets) {
      const requests = await s.tx.companyReimbursementRequest.findMany({
        where: {
          ...this.op.where(s),
          bucketId: b.id,
          state: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] },
        },
      });
      for (const r of requests) {
        if (v && r.expenseVersionId === v.id) continue;
        for (const p of await s.tx.companyPaymentAcknowledgement.findMany({
          where: { requestId: r.id, state: 'PROPOSED' },
        })) {
          await this.effect(s, b, {
            kind: 'SUPERSEDE',
            sourceVersionId: changedVersion.id,
            requestId: r.id,
            paymentId: p.id,
            pending: -units(p.amount.toString(), b.scale),
          });
          await s.tx.companyPaymentAcknowledgement.update({
            where: { id: p.id },
            data: { state: 'INVALIDATED', ...this.op.changed(s) },
          });
        }
        const t = await this.sums(s, b, r.id);
        if (t.reserved)
          await this.effect(s, b, {
            kind: 'SUPERSEDE',
            sourceVersionId: changedVersion.id,
            requestId: r.id,
            reserved: -t.reserved,
          });
        if (r.state === 'APPROVED' && !t.reserved && t.acknowledged > 0n)
          continue;
        await this.extensions.cancel(s, { reimbursementId: r.id });
        await s.tx.companyReimbursementRequest.update({
          where: { id: r.id },
          data: { state: 'INVALIDATED', ...this.op.changed(s) },
        });
      }
      const t = await this.sums(s, b),
        entitlement =
          v && actorId === b.beneficiaryActorId && v.currency === b.currency
            ? units(v.amount.toString(), b.scale)
            : 0n;
      await this.effect(s, b, {
        kind: 'SUPERSEDE',
        sourceVersionId: changedVersion.id,

        entitlement: entitlement - t.entitlement,
      });
    }
  }
}
