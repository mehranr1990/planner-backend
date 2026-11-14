import {
  Inject,
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  CompanyPaymentRun,
  CompanyPaymentRunItem,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { units, amount } from '../../finance/public/index.js';
import { CompanyReimbursementsService } from './company-reimbursements.service.js';
import type { StaffContext, StaffPage } from './company-staff.context.js';
/**
 * OD-7 (owner-approved): internal batch payment runs over APPROVED
 * reimbursements. No money moves. Confirming a run (by a manager other than
 * its creator) proposes one standard payment acknowledgement per item through
 * the existing reimbursement engine; beneficiaries still acknowledge or
 * dispute. A reimbursement can be in at most one active run.
 */
@Injectable()
export class CompanyPaymentRunsService {
  constructor(
    @Inject(CompanyReimbursementsService)
    private readonly reimbursements: CompanyReimbursementsService,
  ) {}
  private get finance() {
    return this.reimbursements.finance;
  }
  private get op() {
    return this.finance.op;
  }
  /** Outstanding = reserved − pending − acknowledged proposals for an APPROVED request. */
  private async outstanding(s: StaffContext, reimbursementId: string) {
    const r = await this.reimbursements.row(s, reimbursementId);
    if (r.state !== 'APPROVED') return null;
    const b = await this.reimbursements.current(s, r),
      t = await this.reimbursements.sums(s, b, r.id),
      n = t.reserved - t.pending;
    return n > 0n ? { r, b, n } : null;
  }
  private async view(
    s: StaffContext,
    run: CompanyPaymentRun,
    items: CompanyPaymentRunItem[],
  ) {
    const scale = Number(
      (await s.tx.company.findUniqueOrThrow({ where: { spaceId: s.spaceId } }))
        .scale ?? 2,
    );
    const mine = run.createdByActorId === s.me.actorId,
      open = run.state === 'OPEN';
    return c.PaymentRunSchema.parse({
      id: run.id,
      label: run.label,
      state: run.state,
      currency: run.currency,
      total: amount(units(run.total.toString(), scale), scale),
      reference: run.reference,
      items: items.map((i) => ({
        reimbursementId: i.reimbursementId,
        amount: amount(units(i.amount.toString(), scale), scale),
        acknowledgementId: i.acknowledgementId,
      })),
      closedAt: run.closedAt?.toISOString() ?? null,
      revision: run.revision,
      createdAt: run.createdAt.toISOString(),
      can: { confirm: open && !mine, cancel: open },
    });
  }
  private async runRow(s: StaffContext, runId: string) {
    const run = await s.tx.companyPaymentRun.findFirst({
      where: { id: runId, ...this.op.where(s) },
    });
    if (!run) throw new NotFoundException();
    return {
      run,
      items: await s.tx.companyPaymentRunItem.findMany({
        where: { runId, ...this.op.where(s) },
        orderBy: { id: 'asc' },
      }),
    };
  }
  eligible(actor: RequestActor, id: string, scopeId: string) {
    return this.finance.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      const active = new Set(
        (
          await s.tx.companyPaymentRunItem.findMany({
            where: { ...this.op.where(s), active: true },
            select: { reimbursementId: true },
          })
        ).map((i) => i.reimbursementId),
      );
      const items = [];
      for (const r of await s.tx.companyReimbursementRequest.findMany({
        where: { ...this.op.where(s), state: 'APPROVED' },
        take: 1001,
      })) {
        if (active.has(r.id)) continue;
        const o = await this.outstanding(s, r.id);
        if (!o) continue;
        items.push({
          reimbursementId: r.id,
          beneficiary: {
            accessId: r.beneficiaryAccessId,
            generation: r.beneficiaryGeneration,
          },
          amount: amount(o.n, o.b.scale),
          currency: o.b.currency,
        });
      }
      return c.PaymentRunEligibleSchema.parse({ items: items.slice(0, 1000) });
    });
  }
  list(actor: RequestActor, id: string, scopeId: string, q: StaffPage) {
    return this.finance.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      return this.op.page(s, 'finance.payment.runs', q, async () =>
        Promise.all(
          (
            await s.tx.companyPaymentRun.findMany({
              where: this.op.where(s),
              take: 1001,
            })
          ).map(async (run) => {
            const { items } = await this.runRow(s, run.id);
            return this.view(s, run, items);
          }),
        ),
      );
    });
  }
  read(actor: RequestActor, id: string, scopeId: string, runId: string) {
    return this.finance.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      const { run, items } = await this.runRow(s, runId);
      return this.view(s, run, items);
    });
  }
  create(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.PaymentRunCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.PaymentRunCreateSchema.parse(input);
    if (new Set(body.reimbursementIds).size !== body.reimbursementIds.length)
      throw new ConflictException({ code: 'DUPLICATE_ITEM' });
    return this.finance.write(
      actor,
      id,
      scopeId,
      'payment.run.create',
      body.id,
      async (s) => {
        this.op.manage(s);
        await this.op.once(
          s,
          'company.payment.run.create',
          key,
          body,
          async () => {
            const lines = [];
            let currency: string | null = null,
              scale = 2;
            for (const rid of body.reimbursementIds) {
              const o = await this.outstanding(s, rid);
              if (!o)
                throw new ConflictException({
                  code: 'NOT_ELIGIBLE',
                  reimbursementId: rid,
                });
              if (
                this.op.self(s, {
                  accessId: o.r.beneficiaryAccessId,
                  generation: o.r.beneficiaryGeneration,
                })
              )
                throw new ForbiddenException({
                  code: 'SELF_PAYMENT_FORBIDDEN',
                });
              if (currency && currency !== o.b.currency)
                throw new ConflictException({
                  code: 'COMPANY_CURRENCY_MISMATCH',
                });
              currency = o.b.currency;
              scale = o.b.scale;
              lines.push({ rid, n: o.n });
            }
            await s.change();
            await s.tx.companyPaymentRun.create({
              data: {
                ...this.op.where(s),
                id: body.id,
                label: body.label,
                state: 'OPEN',
                currency: currency!,
                total: amount(
                  lines.reduce((sum, l) => sum + l.n, 0n),
                  scale,
                ),
                createdByActorId: s.me.actorId,
                updatedAt: s.now,
              },
            });
            for (const l of lines)
              await s.tx.companyPaymentRunItem.create({
                data: {
                  ...this.op.where(s),
                  id: randomUUID(),
                  runId: body.id,
                  reimbursementId: l.rid,
                  amount: amount(l.n, scale),
                },
              });
            return { id: body.id };
          },
        );
        const { run, items } = await this.runRow(s, body.id);
        return this.view(s, run, items);
      },
    );
  }
  confirm(
    actor: RequestActor,
    id: string,
    scopeId: string,
    runId: string,
    revision: number,
    input: z.infer<typeof c.PaymentRunConfirmSchema>,
  ) {
    const body = c.PaymentRunConfirmSchema.parse(input);
    return this.finance.write(
      actor,
      id,
      scopeId,
      'payment.run.confirm',
      runId,
      async (s) => {
        this.op.manage(s);
        const { run, items } = await this.runRow(s, runId);
        this.op.match(run.revision, revision);
        if (run.state !== 'OPEN')
          throw new ConflictException({ code: 'RUN_CLOSED' });
        if (run.createdByActorId === s.me.actorId)
          throw new ForbiddenException({ code: 'SELF_APPROVAL_FORBIDDEN' });
        await s.change();
        for (const item of items) {
          const o = await this.outstanding(s, item.reimbursementId);
          const n = units(item.amount.toString(), o?.b.scale ?? 2);
          if (!o || o.n < n)
            throw new ConflictException({
              code: 'RUN_ITEM_CHANGED',
              reimbursementId: item.reimbursementId,
            });
          if (
            this.op.self(s, {
              accessId: o.r.beneficiaryAccessId,
              generation: o.r.beneficiaryGeneration,
            })
          )
            throw new ForbiddenException({ code: 'SELF_PAYMENT_FORBIDDEN' });
          const paymentId = randomUUID();
          await s.tx.companyPaymentAcknowledgement.create({
            data: {
              ...this.op.where(s),
              id: paymentId,
              requestId: o.r.id,
              bucketId: o.b.id,
              authorAccessId: s.me.accessId,
              authorGeneration: s.me.generation,
              amount: amount(n, o.b.scale),
              reference: body.reference,
              state: 'PROPOSED',
            },
          });
          await this.reimbursements.effect(s, o.b, {
            kind: 'PROPOSE',
            requestId: o.r.id,
            paymentId,
            pending: n,
          });
          await s.tx.companyPaymentRunItem.update({
            where: { id: item.id },
            data: { acknowledgementId: paymentId, active: false },
          });
        }
        const updated = await s.tx.companyPaymentRun.update({
          where: { id: run.id, revision: run.revision },
          data: {
            state: 'CONFIRMED',
            reference: body.reference,
            closedAt: s.now,
            closedByActorId: s.me.actorId,
            ...this.op.changed(s),
          },
        });
        return this.view(s, updated, (await this.runRow(s, runId)).items);
      },
    );
  }
  cancel(
    actor: RequestActor,
    id: string,
    scopeId: string,
    runId: string,
    revision: number,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      'payment.run.cancel',
      runId,
      async (s) => {
        this.op.manage(s);
        const { run } = await this.runRow(s, runId);
        this.op.match(run.revision, revision);
        if (run.state !== 'OPEN')
          throw new ConflictException({ code: 'RUN_CLOSED' });
        await s.change();
        await s.tx.companyPaymentRunItem.updateMany({
          where: { runId, ...this.op.where(s) },
          data: { active: false },
        });
        const updated = await s.tx.companyPaymentRun.update({
          where: { id: run.id, revision: run.revision },
          data: {
            state: 'CANCELED',
            closedAt: s.now,
            closedByActorId: s.me.actorId,
            ...this.op.changed(s),
          },
        });
        return this.view(s, updated, (await this.runRow(s, runId)).items);
      },
    );
  }
}
