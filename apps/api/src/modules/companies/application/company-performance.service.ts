import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  PayloadTooLargeException,
  ForbiddenException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { CompanyStaffContext } from './company-staff.context.js';
import type { StaffContext, StaffPage } from './company-staff.context.js';
import { companyDates } from './company-assets.service.js';
const ref = (accessId: string, generation: number) => ({
  accessId,
  generation,
});
type Review = Awaited<
  ReturnType<StaffContext['tx']['companyPerformanceReview']['findFirstOrThrow']>
>;
type One = Awaited<
  ReturnType<StaffContext['tx']['companyOneOnOne']['findFirstOrThrow']>
>;
@Injectable()
export class CompanyPerformanceService {
  constructor(@Inject(CompanyStaffContext) readonly op: CompanyStaffContext) {}
  private cycleView(
    r: Awaited<
      ReturnType<StaffContext['tx']['companyReviewCycle']['findFirstOrThrow']>
    >,
  ) {
    return c.CompanyReviewCycleSchema.strip().parse({
      ...companyDates(r),
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
    });
  }
  private async bound(
    s: StaffContext,
    table:
      | 'companyKpiObservation'
      | 'companyReviewCycle'
      | 'companyPerformanceReview'
      | 'companyOneOnOne'
      | 'companyOneOnOneAction',
  ) {
    // Explicit per-table calls retain Prisma argument checking.
    const where = this.op.where(s);
    const count =
      table === 'companyKpiObservation'
        ? await s.tx.companyKpiObservation.count({ where })
        : table === 'companyReviewCycle'
          ? await s.tx.companyReviewCycle.count({ where })
          : table === 'companyPerformanceReview'
            ? await s.tx.companyPerformanceReview.count({ where })
            : table === 'companyOneOnOne'
              ? await s.tx.companyOneOnOne.count({ where })
              : await s.tx.companyOneOnOneAction.count({ where });
    if (count >= 1000) throw new PayloadTooLargeException();
  }
  observations(
    actor: RequestActor,
    id: string,
    scopeId: string,
    q: z.infer<typeof c.CompanyObservationPageQuerySchema>,
  ) {
    return this.op.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      return this.op.page(
        s,
        'company.kpi.observations:' + q.from + ':' + q.to,
        q,
        async () =>
          (
            await s.tx.companyKpiObservation.findMany({
              where: {
                ...this.op.where(s),
                periodStart: { gte: new Date(q.from) },
                periodEnd: { lte: new Date(q.to) },
              },
              take: 1001,
            })
          ).map((r) =>
            c.CompanyKpiObservationSchema.strip().parse({
              ...companyDates(r),
              value: r.value.toFixed(4),
              periodStart: r.periodStart.toISOString(),
              periodEnd: r.periodEnd.toISOString(),
              evidence: 'OBSERVED',
            }),
          ),
      );
    });
  }
  recordObservation(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyKpiObservationCreateSchema>,
    key?: string,
  ) {
    const body = c.CompanyKpiObservationCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.kpi.record',
      body.id,
      async (s) => {
        this.op.manage(s);
        const result = await this.op.once(
          s,
          'company.kpi.record',
          key,
          body,
          async () => {
            if (new Date(body.periodEnd) > s.now)
              throw new ConflictException({
                code: 'FUTURE_OBSERVATION_FORBIDDEN',
              });
            await this.bound(s, 'companyKpiObservation');
            await s.change();
            return s.tx.companyKpiObservation.create({
              data: {
                ...this.op.where(s),
                ...body,
                recordedByActorId: s.root.actorId,
              },
            });
          },
        );
        const r = await s.tx.companyKpiObservation.findFirstOrThrow({
          where: { ...this.op.where(s), id: result.id },
        });
        return c.CompanyKpiObservationSchema.strip().parse({
          ...companyDates(r),
          value: r.value.toFixed(4),
          periodStart: r.periodStart.toISOString(),
          periodEnd: r.periodEnd.toISOString(),
          evidence: 'OBSERVED',
        });
      },
    );
  }
  cycles(actor: RequestActor, id: string, scopeId: string, q: StaffPage) {
    return this.op.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      return this.op.page(s, 'company.review.cycles', q, async () =>
        (
          await s.tx.companyReviewCycle.findMany({
            where: this.op.where(s),
            take: 1001,
          })
        ).map((r) => this.cycleView(r)),
      );
    });
  }
  createCycle(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyReviewCycleCreateSchema>,
    key?: string,
  ) {
    const body = c.CompanyReviewCycleCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.review.cycle.create',
      body.id,
      async (s) => {
        this.op.manage(s);
        const result = await this.op.once(
          s,
          'company.review.cycle.create',
          key,
          body,
          async () => {
            await this.bound(s, 'companyReviewCycle');
            await s.change();
            return s.tx.companyReviewCycle.create({
              data: {
                ...this.op.where(s),
                ...body,
                createdByActorId: s.root.actorId,
              },
            });
          },
        );
        return this.cycleView(await this.cycle(s, result.id));
      },
    );
  }
  private async cycle(s: StaffContext, id: string) {
    const r = await s.tx.companyReviewCycle.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!r) throw new NotFoundException();
    return r;
  }
  changeCycle(
    actor: RequestActor,
    id: string,
    scopeId: string,
    cycleId: string,
    revision: number,
    input: z.infer<typeof c.CompanyReviewCycleChangeSchema>,
  ) {
    const body = c.CompanyReviewCycleChangeSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.review.cycle.change',
      cycleId,
      async (s) => {
        this.op.manage(s);
        const r = await this.cycle(s, cycleId);
        this.op.match(r.revision, revision);
        if (body.state === 'OPEN' ? r.state !== 'DRAFT' : r.state !== 'OPEN')
          throw new ConflictException();
        if (
          body.state === 'CLOSED' &&
          (await s.tx.companyPerformanceReview.count({
            where: { cycleId, state: { not: 'COMPLETED' } },
          }))
        )
          throw new ConflictException({ code: 'REVIEWS_INCOMPLETE' });
        await s.change();
        return this.cycleView(
          await s.tx.companyReviewCycle.update({
            where: { id: cycleId },
            data: { state: body.state, ...this.op.changed(s) },
          }),
        );
      },
    );
  }
  assignReview(
    actor: RequestActor,
    id: string,
    scopeId: string,
    cycleId: string,
    input: z.infer<typeof c.CompanyReviewAssignmentSchema>,
    key?: string,
  ) {
    const body = c.CompanyReviewAssignmentSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.review.assign',
      body.id,
      async (s) => {
        this.op.manage(s);
        const cycle = await this.cycle(s, cycleId);
        await this.op.member(s, body.subject);
        const reviewer = await this.op.member(s, body.reviewer);
        if (
          !(await this.op.access.staffReviewer(s, reviewer)) &&
          !(s.scopeId !== s.spaceId && reviewer.role === 'DEPT_MANAGER')
        )
          throw new ConflictException({ code: 'REVIEWER_AUTHORITY_REQUIRED' });
        const result = await this.op.once(
          s,
          'company.review.assign',
          key,
          { cycleId, ...body },
          async () => {
            if (cycle.state !== 'DRAFT') throw new ConflictException();
            await this.bound(s, 'companyPerformanceReview');
            await s.change();
            return s.tx.companyPerformanceReview.create({
              data: {
                ...this.op.where(s),
                id: body.id,
                cycleId,
                subjectAccessId: body.subject.accessId,
                subjectGeneration: body.subject.generation,
                reviewerAccessId: body.reviewer.accessId,
                reviewerGeneration: body.reviewer.generation,
              },
            });
          },
        );
        // Assignment response contains metadata only, never a private review body.
        const r = await s.tx.companyPerformanceReview.findFirstOrThrow({
          where: { ...this.op.where(s), id: result.id },
        });
        return this.reviewView(r, null);
      },
    );
  }
  private reviewView(r: Review, body: string | null) {
    return c.CompanyPerformanceReviewSchema.strip().parse({
      ...companyDates(r),
      subject: ref(r.subjectAccessId, r.subjectGeneration),
      reviewer: ref(r.reviewerAccessId, r.reviewerGeneration),
      redactedAt: r.redactedAt?.toISOString() ?? null,
      body: r.redactedAt ? null : body,
    });
  }
  private async participant(s: StaffContext, r: Review) {
    if (
      !this.op.self(s, ref(r.subjectAccessId, r.subjectGeneration)) &&
      !this.op.self(s, ref(r.reviewerAccessId, r.reviewerGeneration))
    )
      throw new NotFoundException();
    if (this.op.self(s, ref(r.reviewerAccessId, r.reviewerGeneration))) {
      const reviewer = await this.op.member(
        s,
        ref(r.reviewerAccessId, r.reviewerGeneration),
      );
      if (
        !(await this.op.access.staffReviewer(s, reviewer)) &&
        !(s.scopeId !== s.spaceId && reviewer.role === 'DEPT_MANAGER')
      )
        throw new NotFoundException();
    }
  }
  private async review(s: StaffContext, id: string) {
    const r = await s.tx.companyPerformanceReview.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!r) throw new NotFoundException();
    await this.participant(s, r);
    return r;
  }
  reviews(actor: RequestActor, id: string, scopeId: string, q: StaffPage) {
    return this.op.read(
      actor,
      id,
      scopeId,
      async (s) => {
        const rows = await s.tx.companyPerformanceReview.findMany({
          where: {
            ...this.op.where(s),
            OR: [
              {
                subjectAccessId: s.me.accessId,
                subjectGeneration: s.me.generation,
              },
              {
                reviewerAccessId: s.me.accessId,
                reviewerGeneration: s.me.generation,
              },
            ],
          },
          take: 1001,
        });
        const visible: z.infer<typeof c.CompanyPerformanceReviewSchema>[] = [];
        for (const r of rows) {
          try {
            await this.participant(s, r);
          } catch (e) {
            if (e instanceof NotFoundException) continue;
            throw e;
          }
          const body = await s.tx.companyReviewRevision.findFirst({
            where: { reviewId: r.id },
            orderBy: [{ revision: 'desc' }, { id: 'desc' }],
          });
          visible.push(this.reviewView(r, body?.body ?? null));
        }
        await this.op.audit(s, scopeId, 'company.performance.review.list');
        return this.op.page(
          s,
          'company.performance.reviews',
          q,
          async () => visible,
        );
      },
      false,
    );
  }
  reviewRead(
    actor: RequestActor,
    id: string,
    scopeId: string,
    reviewId: string,
  ) {
    return this.op.read(
      actor,
      id,
      scopeId,
      async (s) => {
        const r = await this.review(s, reviewId);
        await this.op.audit(s, reviewId, 'company.performance.review.read');
        const latest = await s.tx.companyReviewRevision.findFirst({
          where: { reviewId },
          orderBy: [{ revision: 'desc' }, { id: 'desc' }],
        });
        return this.reviewView(r, latest?.body ?? null);
      },
      false,
    );
  }
  submitReview(
    actor: RequestActor,
    id: string,
    scopeId: string,
    reviewId: string,
    revision: number,
    input: z.infer<typeof c.CompanyReviewSubmissionSchema>,
  ) {
    const body = c.CompanyReviewSubmissionSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.review.submit',
      reviewId,
      async (s) => {
        const r = await this.review(s, reviewId);
        this.op.match(r.revision, revision);
        if (!this.op.self(s, ref(r.reviewerAccessId, r.reviewerGeneration)))
          throw new NotFoundException();
        if (
          r.redactedAt ||
          r.state === 'COMPLETED' ||
          (await this.cycle(s, r.cycleId)).state !== 'OPEN'
        )
          throw new ConflictException();
        await s.change();
        const next = await s.tx.companyPerformanceReview.update({
          where: { id: reviewId },
          data: { state: 'SUBMITTED', ...this.op.changed(s) },
        });
        await s.tx.companyReviewRevision.create({
          data: {
            ...this.op.where(s),
            id: crypto.randomUUID(),
            reviewId,
            revision: next.revision,
            body: body.body,
            state: 'SUBMITTED',
            actorId: s.root.actorId,
          },
        });
        return this.reviewView(next, body.body);
      },
    );
  }
  completeReview(
    actor: RequestActor,
    id: string,
    scopeId: string,
    reviewId: string,
    revision: number,
  ) {
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.review.complete',
      reviewId,
      async (s) => {
        const r = await this.review(s, reviewId);
        this.op.match(r.revision, revision);
        if (!this.op.self(s, ref(r.subjectAccessId, r.subjectGeneration)))
          throw new NotFoundException();
        if (
          r.redactedAt ||
          r.state !== 'SUBMITTED' ||
          (await this.cycle(s, r.cycleId)).state !== 'OPEN'
        )
          throw new ConflictException();
        const latest = await s.tx.companyReviewRevision.findFirstOrThrow({
          where: { reviewId },
          orderBy: [{ revision: 'desc' }, { id: 'desc' }],
        });
        await s.change();
        const next = await s.tx.companyPerformanceReview.update({
          where: { id: reviewId },
          data: { state: 'COMPLETED', ...this.op.changed(s) },
        });
        await s.tx.companyReviewRevision.create({
          data: {
            ...this.op.where(s),
            id: crypto.randomUUID(),
            reviewId,
            revision: next.revision,
            body: latest.body,
            state: 'COMPLETED',
            actorId: s.root.actorId,
          },
        });
        return this.reviewView(next, latest.body);
      },
    );
  }
  reviewHistory(
    actor: RequestActor,
    id: string,
    scopeId: string,
    reviewId: string,
    q: StaffPage,
  ) {
    return this.op.read(
      actor,
      id,
      scopeId,
      async (s) => {
        await this.review(s, reviewId);
        await this.op.audit(s, reviewId, 'company.performance.review.history');
        return this.op.page(
          s,
          'company.review.history:' + reviewId,
          q,
          async () =>
            (
              await s.tx.companyReviewRevision.findMany({
                where: { ...this.op.where(s), reviewId },
                take: 1001,
              })
            ).map((r) =>
              c.CompanyPrivateRevisionSchema.strip().parse({
                ...companyDates(r),
                meetingAt: null,
                redactedAt: r.redactedAt?.toISOString() ?? null,
              }),
            ),
        );
      },
      false,
    );
  }
  private oneView(r: One) {
    return c.CompanyOneOnOneSchema.strip().parse({
      ...companyDates(r),
      manager: ref(r.managerAccessId, r.managerGeneration),
      employee: ref(r.employeeAccessId, r.employeeGeneration),
      meetingAt: r.meetingAt.toISOString(),
      redactedAt: r.redactedAt?.toISOString() ?? null,
    });
  }
  private async one(s: StaffContext, id: string) {
    const r = await s.tx.companyOneOnOne.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (
      !r ||
      (!this.op.self(s, ref(r.managerAccessId, r.managerGeneration)) &&
        !this.op.self(s, ref(r.employeeAccessId, r.employeeGeneration)))
    )
      throw new NotFoundException();
    if (this.op.self(s, ref(r.managerAccessId, r.managerGeneration)))
      this.op.manage(s);
    return r;
  }
  oneList(actor: RequestActor, id: string, scopeId: string, q: StaffPage) {
    return this.op.read(
      actor,
      id,
      scopeId,
      async (s) => {
        const rows = await s.tx.companyOneOnOne.findMany({
          where: {
            ...this.op.where(s),
            OR: [
              {
                managerAccessId: s.me.accessId,
                managerGeneration: s.me.generation,
              },
              {
                employeeAccessId: s.me.accessId,
                employeeGeneration: s.me.generation,
              },
            ],
          },
          take: 1001,
        });
        const visible: z.infer<typeof c.CompanyOneOnOneSchema>[] = [];
        for (const r of rows) {
          try {
            await this.one(s, r.id);
            visible.push(this.oneView(r));
          } catch (e) {
            if (
              e instanceof NotFoundException ||
              e instanceof ForbiddenException
            )
              continue;
            throw e;
          }
        }
        await this.op.audit(s, scopeId, 'company.one.on.one.list');
        return this.op.page(s, 'company.one.on.one', q, async () => visible);
      },
      false,
    );
  }
  createOne(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyOneOnOneCreateSchema>,
    key?: string,
  ) {
    const body = c.CompanyOneOnOneCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.one.on.one.create',
      body.id,
      async (s) => {
        this.op.manage(s);
        await this.op.member(s, body.employee);
        if (this.op.self(s, body.employee)) throw new ConflictException();
        const result = await this.op.once(
          s,
          'company.one.on.one.create',
          key,
          body,
          async () => {
            await this.bound(s, 'companyOneOnOne');
            await s.change();
            const r = await s.tx.companyOneOnOne.create({
              data: {
                ...this.op.where(s),
                id: body.id,
                employeeAccessId: body.employee.accessId,
                employeeGeneration: body.employee.generation,
                managerAccessId: s.me.accessId,
                managerGeneration: s.me.generation,
                meetingAt: body.meetingAt,
                notes: body.notes,
              },
            });
            await this.oneRevision(s, r);
            return r;
          },
        );
        return this.oneView(await this.one(s, result.id));
      },
    );
  }
  private oneRevision(s: StaffContext, r: One) {
    return s.tx.companyOneOnOneRevision.create({
      data: {
        ...this.op.where(s),
        id: crypto.randomUUID(),
        recordId: r.id,
        revision: r.revision,
        meetingAt: r.meetingAt,
        notes: r.notes,
        actorId: s.root.actorId,
      },
    });
  }
  readOne(actor: RequestActor, id: string, scopeId: string, recordId: string) {
    return this.op.read(
      actor,
      id,
      scopeId,
      async (s) => {
        const r = await this.one(s, recordId);
        await this.op.audit(s, recordId, 'company.one.on.one.read');
        return this.oneView(r);
      },
      false,
    );
  }
  patchOne(
    actor: RequestActor,
    id: string,
    scopeId: string,
    recordId: string,
    revision: number,
    input: z.infer<typeof c.CompanyOneOnOnePatchSchema>,
  ) {
    const body = c.CompanyOneOnOnePatchSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.one.on.one.update',
      recordId,
      async (s) => {
        const r = await this.one(s, recordId);
        this.op.match(r.revision, revision);
        if (r.redactedAt) throw new ConflictException();
        await s.change();
        const next = await s.tx.companyOneOnOne.update({
          where: { id: recordId },
          data: { ...body, ...this.op.changed(s) },
        });
        await this.oneRevision(s, next);
        return this.oneView(next);
      },
    );
  }
  oneHistory(
    actor: RequestActor,
    id: string,
    scopeId: string,
    recordId: string,
    q: StaffPage,
  ) {
    return this.op.read(
      actor,
      id,
      scopeId,
      async (s) => {
        await this.one(s, recordId);
        await this.op.audit(s, recordId, 'company.one.on.one.history');
        return this.op.page(
          s,
          'company.one.on.one.history:' + recordId,
          q,
          async () =>
            (
              await s.tx.companyOneOnOneRevision.findMany({
                where: { ...this.op.where(s), recordId },
                take: 1001,
              })
            ).map((r) =>
              c.CompanyPrivateRevisionSchema.strip().parse({
                ...companyDates(r),
                body: r.notes,
                state: null,
                meetingAt: r.meetingAt.toISOString(),
                redactedAt: r.redactedAt?.toISOString() ?? null,
              }),
            ),
        );
      },
      false,
    );
  }
  actions(
    actor: RequestActor,
    id: string,
    scopeId: string,
    recordId: string,
    q: StaffPage,
  ) {
    return this.op.read(
      actor,
      id,
      scopeId,
      async (s) => {
        await this.one(s, recordId);
        await this.op.audit(s, recordId, 'company.one.on.one.actions');
        return this.op.page(
          s,
          'company.one.on.one.actions:' + recordId,
          q,
          async () =>
            (
              await s.tx.companyOneOnOneAction.findMany({
                where: { ...this.op.where(s), recordId },
                take: 1001,
              })
            ).map((r) =>
              c.CompanyOneOnOneActionSchema.strip().parse(companyDates(r)),
            ),
        );
      },
      false,
    );
  }
  action(
    actor: RequestActor,
    id: string,
    scopeId: string,
    recordId: string,
    input: z.infer<typeof c.CompanyOneOnOneActionCreateSchema>,
    key?: string,
  ) {
    const body = c.CompanyOneOnOneActionCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.one.on.one.action',
      body.id,
      async (s) => {
        const r = await this.one(s, recordId);
        if (r.redactedAt) throw new ConflictException();
        const result = await this.op.once(
          s,
          'company.one.on.one.action',
          key,
          { recordId, ...body },
          async () => {
            await this.bound(s, 'companyOneOnOneAction');
            await s.change();
            return s.tx.companyOneOnOneAction.create({
              data: {
                ...this.op.where(s),
                ...body,
                recordId,
                actorId: s.root.actorId,
              },
            });
          },
        );
        return c.CompanyOneOnOneActionSchema.strip().parse(
          companyDates(
            await s.tx.companyOneOnOneAction.findFirstOrThrow({
              where: { ...this.op.where(s), id: result.id },
            }),
          ),
        );
      },
    );
  }
  changeAction(
    actor: RequestActor,
    id: string,
    scopeId: string,
    recordId: string,
    actionId: string,
    revision: number,
    input: z.infer<typeof c.CompanyOneOnOneActionChangeSchema>,
  ) {
    const body = c.CompanyOneOnOneActionChangeSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.one.on.one.action.change',
      actionId,
      async (s) => {
        const parent = await this.one(s, recordId);
        const r = await s.tx.companyOneOnOneAction.findFirst({
          where: { ...this.op.where(s), recordId, id: actionId },
        });
        if (!r) throw new NotFoundException();
        if (parent.redactedAt || r.redactedAt) throw new ConflictException();
        this.op.match(r.revision, revision);
        await s.change();
        return c.CompanyOneOnOneActionSchema.strip().parse(
          companyDates(
            await s.tx.companyOneOnOneAction.update({
              where: { id: actionId },
              data: { state: body.state, ...this.op.changed(s) },
            }),
          ),
        );
      },
    );
  }
}
