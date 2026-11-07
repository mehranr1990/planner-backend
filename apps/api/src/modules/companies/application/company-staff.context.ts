import {
  Inject,
  Injectable,
  ConflictException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { CompanyAccess, SharedAuthority } from '../../spaces/public/index.js';
import type {
  CompanyTransaction,
  SharedFeatureKey,
} from '../../spaces/public/index.js';
import type { SharedAccess } from '../../spaces/public/shared-authority.js';
import { CompaniesService } from './companies.service.js';
export type StaffMember = { accessId: string; generation: number };
export type StaffContext = CompanyTransaction & {
  scopeId: string;
  me: SharedAccess;
  change: () => Promise<void>;
};
export type StaffPage = { limit: number; after?: string | undefined };
@Injectable()
export class CompanyStaffContext {
  constructor(
    @Inject(CompanyAccess) readonly access: CompanyAccess,
    @Inject(CompaniesService) private readonly companies: CompaniesService,
  ) {}
  async read<T>(
    actor: RequestActor,
    id: string,
    scopeId: string,
    work: (s: StaffContext) => Promise<T>,
    ordinary = true,
  ) {
    await this.companies.hint(id);
    const users = await this.access.staffHints(id);
    return this.access.read(
      actor,
      id,
      async (ctx) => {
        await this.companies.staffVisibility(ctx, scopeId, ordinary);
        const me = await this.access.seat(ctx, scopeId);
        return work({
          ...ctx,
          scopeId,
          me,
          change: async () => {
            throw new Error('Read cannot mutate');
          },
        });
      },
      users,
    );
  }
  async write<T>(
    actor: RequestActor,
    id: string,
    scopeId: string,
    action: string,
    target: string,
    work: (s: StaffContext) => Promise<T>,
    feature?: SharedFeatureKey,
  ) {
    await this.companies.hint(id);
    const users = await this.access.staffHints(id);
    return this.access.write(
      actor,
      id,
      action,
      target,
      async (ctx) => {
        await this.companies.staffVisibility(ctx, scopeId, false);
        const me = await this.access.seat(ctx, scopeId);
        let audit: string | undefined;
        const s: StaffContext = {
          ...ctx,
          scopeId,
          me,
          change: async () => {
            audit ??= await ctx.begin();
          },
        };
        let result: T;
        try {
          result = await work(s);
        } catch (error) {
          // Known constraint/uniqueness failures rolled back with a terminal abort record.
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            ['P2002', 'P2003'].includes(String(error.code))
          )
            throw new ConflictException();
          throw error;
        }
        if (audit)
          await this.access.effect(
            ctx,
            action,
            target,
            audit,
            feature as Parameters<CompanyAccess['effect']>[4],
          );
        return result;
      },
      users,
    );
  }
  manage(s: StaffContext) {
    if (
      !this.access.isAdmin(s) &&
      !(s.scopeId !== s.spaceId && s.me.role === 'DEPT_MANAGER')
    )
      throw new ForbiddenException();
  }
  self(s: StaffContext, m: StaffMember) {
    return s.me.accessId === m.accessId && s.me.generation === m.generation;
  }
  match(actual: number, expected: number) {
    if (actual !== expected)
      throw new ConflictException({ code: 'STALE_REVISION' });
  }
  member(s: StaffContext, m: StaffMember) {
    return this.access.staffMember(s, s.scopeId, m);
  }
  async growth(s: StaffContext, feature: SharedFeatureKey, count: number) {
    if (count >= 1000) throw new PayloadTooLargeException();
    await this.access.kernel.featureGrowth(s.tx, s.spaceId, feature);
  }
  once(
    s: StaffContext,
    action: string,
    key: string | undefined,
    body: unknown,
    work: () => Promise<{ id: string }>,
  ) {
    return this.access.once(s, s.scopeId, action, key, body, work);
  }
  async audit(
    s: StaffContext,
    id: string,
    action = 'company.employee.case.read',
  ) {
    const authority = new SharedAuthority(s.tx, [s.root]);
    try {
      await this.access.kernel.recordAccess(
        s.tx,
        authority,
        s.actor,
        s.spaceId,
        id,
        action,
      );
    } finally {
      authority.close();
    }
  }
  async page<T extends { id: string }>(
    s: StaffContext,
    operation: string,
    q: StaffPage,
    load: () => Promise<T[]>,
    maximum = 1000,
  ) {
    const authority = new SharedAuthority(s.tx, [s.root]);
    try {
      const cursor = this.access.kernel.scopeCursor(
        s.tx,
        authority,
        { spaceId: s.spaceId, scopeId: s.spaceId, capability: 'task.read' },
        operation + ':' + s.scopeId + ':' + s.me.generation,
      );
      const after = this.access.kernel.cursorPosition(
        cursor.context,
        cursor.stamp,
        s.actor.userId,
        q.after,
      );
      const loaded = await load();
      if (loaded.length > maximum) throw new PayloadTooLargeException();
      const rows = loaded
        .filter((r) => !after || r.id > after)
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      return this.access.kernel.cursorPage(
        cursor.context,
        cursor.stamp,
        s.actor.userId,
        {
          items: rows.slice(0, q.limit),
          nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
        },
      );
    } finally {
      authority.close();
    }
  }
  async live(s: StaffContext) {
    return new Map(
      (await this.access.staffMembers(s, s.scopeId)).map((m) => [
        m.accessId,
        m,
      ]),
    );
  }
  where(s: StaffContext) {
    return { spaceId: s.spaceId, scopeId: s.scopeId };
  }
  changed(s: StaffContext) {
    return { revision: { increment: 1 }, updatedAt: s.now };
  }
  async erasureAllowed(tx: Prisma.TransactionClient, spaceId: string) {
    await this.access.staffErasureAllowed(tx, spaceId);
  }
}
