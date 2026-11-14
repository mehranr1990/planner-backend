import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  CompanyGoal,
  CompanyKeyResult,
  Goal,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import {
  OwnedGoals,
  goalProgress,
  keyResultProgress,
  periodProgress,
} from '../../goals/public/index.js';
import type { OwnedGoalScope } from '../../goals/public/index.js';
import { CompanyStaffContext } from './company-staff.context.js';
import type { StaffContext, StaffPage } from './company-staff.context.js';
const day = (d: Date) => d.toISOString().slice(0, 10);
const localDay = (at: Date, timezone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
const number = (v: { toString(): string }) => String(Number(v.toString()));
/**
 * OD-2 (owner-approved): Company and department goals stored in the shared
 * Goal engine; numeric key results with check-in history. Context members
 * read; context managers write; the goal owner also records check-ins.
 */
@Injectable()
export class CompanyGoalsService {
  constructor(
    @Inject(CompanyStaffContext) readonly op: CompanyStaffContext,
    @Inject(OwnedGoals) private readonly goals: OwnedGoals,
  ) {}
  private scope(s: StaffContext): OwnedGoalScope {
    return {
      spaceId: s.spaceId,
      scopeId: s.scopeId,
      actorId: s.me.actorId,
      verify: (tx) => {
        if (tx !== s.tx) throw new ForbiddenException();
      },
    };
  }
  private async keyResultView(s: StaffContext, r: CompanyKeyResult) {
    const latest = await s.tx.companyKeyResultCheckin.findFirst({
      where: { spaceId: s.spaceId, keyResultId: r.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const current = latest ? number(latest.value) : null;
    return c.CompanyKeyResultSchema.parse({
      id: r.id,
      title: r.title,
      unit: r.unit,
      startValue: number(r.startValue),
      targetValue: number(r.targetValue),
      currentValue: current,
      progress: keyResultProgress(
        r.startValue.toString(),
        r.targetValue.toString(),
        current,
      ),
      archived: r.archivedAt !== null,
      revision: r.revision,
      updatedAt: r.updatedAt.toISOString(),
    });
  }
  private async view(s: StaffContext, link: CompanyGoal, g: Goal) {
    const rows = await s.tx.companyKeyResult.findMany({
      where: { spaceId: s.spaceId, goalId: g.id },
      orderBy: { id: 'asc' },
      take: 50,
    });
    const keyResults = await Promise.all(
      rows.map((r) => this.keyResultView(s, r)),
    );
    const progress = goalProgress(
        keyResults.filter((k) => !k.archived).map((k) => k.progress),
      ),
      expected = periodProgress(
        day(g.startDate!),
        day(g.targetDate!),
        localDay(s.now, g.timezone),
      );
    return c.CompanyGoalSchema.parse({
      id: g.id,
      scopeId: g.scopeId,
      parentId: link.parentGoalId,
      title: g.title,
      description: g.description,
      status: g.status,
      startDate: day(g.startDate!),
      targetDate: day(g.targetDate!),
      owner: { accessId: link.ownerAccessId, generation: link.ownerGeneration },
      progress,
      expectedProgress: expected,
      pace:
        progress === null ? null : progress >= expected ? 'ON_TRACK' : 'BEHIND',
      keyResults,
      revision: g.revision,
      createdAt: g.createdAt.toISOString(),
    });
  }
  private async link(s: StaffContext, goalId: string) {
    const link = await s.tx.companyGoal.findFirst({
      where: { goalId, spaceId: s.spaceId, scopeId: s.scopeId },
    });
    if (!link) throw new NotFoundException();
    return { link, goal: await this.goals.read(s.tx, this.scope(s), goalId) };
  }
  private manager(s: StaffContext) {
    try {
      this.op.manage(s);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }
  list(actor: RequestActor, id: string, scopeId: string, q: StaffPage) {
    return this.op.read(actor, id, scopeId, async (s) =>
      this.op.page(s, 'company.goals', q, async () => {
        const out = [];
        for (const link of await s.tx.companyGoal.findMany({
          where: { spaceId: s.spaceId, scopeId },
          take: 1001,
        })) {
          const goal = await this.goals.read(s.tx, this.scope(s), link.goalId);
          out.push({ ...(await this.view(s, link, goal)), id: link.goalId });
        }
        return out;
      }),
    );
  }
  read(actor: RequestActor, id: string, scopeId: string, goalId: string) {
    return this.op.read(actor, id, scopeId, async (s) => {
      const { link, goal } = await this.link(s, goalId);
      return this.view(s, link, goal);
    });
  }
  private async insertKeyResult(
    s: StaffContext,
    goalId: string,
    kr: {
      id: string;
      title: string;
      unit: string | null;
      startValue: string;
      targetValue: string;
    },
  ) {
    if (Number(kr.startValue) === Number(kr.targetValue))
      throw new BadRequestException();
    if (
      (await s.tx.companyKeyResult.count({
        where: { spaceId: s.spaceId, goalId },
      })) >= 50
    )
      throw new ConflictException({ code: 'KEY_RESULT_LIMIT' });
    await s.tx.companyKeyResult.create({
      data: {
        id: kr.id,
        spaceId: s.spaceId,
        scopeId: s.scopeId,
        goalId,
        title: kr.title,
        unit: kr.unit,
        startValue: kr.startValue,
        targetValue: kr.targetValue,
        createdByActorId: s.me.actorId,
        updatedAt: s.now,
      },
    });
  }
  create(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyGoalCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.CompanyGoalCreateSchema.parse(input);
    try {
      localDay(new Date(), body.timezone);
    } catch {
      throw new BadRequestException({ code: 'INVALID_TIMEZONE' });
    }
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.goal.create',
      body.id,
      async (s) => {
        this.op.manage(s);
        const owner = body.owner ?? {
          accessId: s.me.accessId,
          generation: s.me.generation,
        };
        await this.op.member(s, owner);
        if (body.parentId) await this.link(s, body.parentId);
        await this.op.once(s, 'company.goal.create', key, body, async () => {
          await s.change();
          await this.goals.create(s.tx, this.scope(s), {
            id: body.id,
            title: body.title,
            description: body.description,
            startDate: body.startDate,
            targetDate: body.targetDate,
            timezone: body.timezone,
          });
          await s.tx.companyGoal.create({
            data: {
              goalId: body.id,
              spaceId: s.spaceId,
              scopeId,
              parentGoalId: body.parentId,
              ownerAccessId: owner.accessId,
              ownerGeneration: owner.generation,
            },
          });
          if (body.keyResult)
            await this.insertKeyResult(s, body.id, body.keyResult);
          return { id: body.id };
        });
        const { link, goal } = await this.link(s, body.id);
        return this.view(s, link, goal);
      },
    );
  }
  patch(
    actor: RequestActor,
    id: string,
    scopeId: string,
    goalId: string,
    revision: number,
    input: z.infer<typeof c.CompanyGoalPatchSchema>,
  ) {
    const body = c.CompanyGoalPatchSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.goal.update',
      goalId,
      async (s) => {
        this.op.manage(s);
        const { link } = await this.link(s, goalId);
        await s.change();
        const goal = await this.goals.update(
          s.tx,
          this.scope(s),
          goalId,
          revision,
          body,
        );
        return this.view(s, link, goal);
      },
    );
  }
  addKeyResult(
    actor: RequestActor,
    id: string,
    scopeId: string,
    goalId: string,
    input: z.infer<typeof c.CompanyKeyResultCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.CompanyKeyResultCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.goal.keyresult.create',
      body.id,
      async (s) => {
        this.op.manage(s);
        await this.link(s, goalId);
        await this.op.once(
          s,
          'company.goal.keyresult.create',
          key,
          { ...body, goalId },
          async () => {
            await s.change();
            await this.insertKeyResult(s, goalId, body);
            return { id: body.id };
          },
        );
        const { link, goal } = await this.link(s, goalId);
        return this.view(s, link, goal);
      },
    );
  }
  private async keyResult(
    s: StaffContext,
    goalId: string,
    keyResultId: string,
  ) {
    const row = await s.tx.companyKeyResult.findFirst({
      where: {
        id: keyResultId,
        goalId,
        spaceId: s.spaceId,
        scopeId: s.scopeId,
      },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  patchKeyResult(
    actor: RequestActor,
    id: string,
    scopeId: string,
    goalId: string,
    keyResultId: string,
    revision: number,
    input: z.infer<typeof c.CompanyKeyResultPatchSchema>,
  ) {
    const body = c.CompanyKeyResultPatchSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.goal.keyresult.update',
      keyResultId,
      async (s) => {
        this.op.manage(s);
        const row = await this.keyResult(s, goalId, keyResultId);
        this.op.match(row.revision, revision);
        if (
          body.targetValue !== undefined &&
          Number(body.targetValue) === Number(row.startValue)
        )
          throw new BadRequestException();
        await s.change();
        const updated = await s.tx.companyKeyResult.update({
          where: { id: row.id, revision: row.revision },
          data: {
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.unit !== undefined ? { unit: body.unit } : {}),
            ...(body.targetValue !== undefined
              ? { targetValue: body.targetValue }
              : {}),
            ...(body.archived !== undefined
              ? { archivedAt: body.archived ? (row.archivedAt ?? s.now) : null }
              : {}),
            updatedAt: s.now,
            revision: { increment: 1 },
          },
        });
        return this.keyResultView(s, updated);
      },
    );
  }
  record(
    actor: RequestActor,
    id: string,
    scopeId: string,
    goalId: string,
    keyResultId: string,
    input: z.infer<typeof c.CompanyKeyResultCheckinCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.CompanyKeyResultCheckinCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.goal.keyresult.checkin',
      body.id,
      async (s) => {
        const { link } = await this.link(s, goalId);
        const owner = this.op.self(s, {
          accessId: link.ownerAccessId,
          generation: link.ownerGeneration,
        });
        if (!owner && !this.manager(s)) throw new ForbiddenException();
        const row = await this.keyResult(s, goalId, keyResultId);
        if (row.archivedAt)
          throw new ConflictException({ code: 'KEY_RESULT_ARCHIVED' });
        await this.op.once(
          s,
          'company.goal.keyresult.checkin',
          key,
          { ...body, keyResultId },
          async () => {
            await s.change();
            await s.tx.companyKeyResultCheckin.create({
              data: {
                id: body.id,
                spaceId: s.spaceId,
                keyResultId,
                value: body.value,
                note: body.note,
                actorId: s.me.actorId,
              },
            });
            return { id: body.id };
          },
        );
        const checkin = await s.tx.companyKeyResultCheckin.findFirst({
          where: { id: body.id, spaceId: s.spaceId, keyResultId },
        });
        if (!checkin) throw new NotFoundException();
        return c.CompanyKeyResultCheckinSchema.parse({
          id: checkin.id,
          keyResultId,
          value: number(checkin.value),
          note: checkin.note,
          createdAt: checkin.createdAt.toISOString(),
        });
      },
    );
  }
  checkins(
    actor: RequestActor,
    id: string,
    scopeId: string,
    goalId: string,
    keyResultId: string,
    q: StaffPage,
  ) {
    return this.op.read(actor, id, scopeId, async (s) => {
      await this.keyResult(s, goalId, keyResultId);
      return this.op.page(
        s,
        'company.goal.checkins:' + keyResultId,
        q,
        async () =>
          (
            await s.tx.companyKeyResultCheckin.findMany({
              where: { spaceId: s.spaceId, keyResultId },
              take: 1001,
            })
          ).map((r) => ({
            id: r.id,
            keyResultId,
            value: number(r.value),
            note: r.note,
            createdAt: r.createdAt.toISOString(),
          })),
      );
    });
  }
  /** KPI linkage: measured goal progress for the context (no inferred values). */
  async kpi(s: StaffContext) {
    const links = await s.tx.companyGoal.findMany({
      where: { spaceId: s.spaceId, scopeId: s.scopeId },
      take: 1001,
    });
    let measured = 0,
      sum = 0;
    for (const link of links) {
      const goal = await this.goals.read(s.tx, this.scope(s), link.goalId);
      if (goal.status === 'ABANDONED') continue;
      const v = await this.view(s, link, goal);
      if (v.progress === null) continue;
      measured++;
      sum += v.progress;
    }
    return {
      goalCount: links.length,
      measuredGoals: measured,
      averageProgress: measured ? Math.round(sum / measured) : null,
    };
  }
}
