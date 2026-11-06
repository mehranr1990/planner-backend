import {
  Inject,
  Injectable,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import {
  SharedKernel,
  SharedAuthority,
  CollaborationService,
} from '../../spaces/public/index.js';
import type {
  SharedRequest,
  SharedFeatureKey,
} from '../../spaces/public/index.js';
import { TeamsService } from './teams.service.js';
export type Member = { accessId: string; generation: number };
export type Interaction = {
  tx: Prisma.TransactionClient;
  a: SharedAuthority;
  actor: RequestActor;
  id: string;
  now: Date;
  locked: string[];
  begin: () => Promise<void>;
};
const req = (
  id: string,
  capability: SharedRequest['capability'] = 'task.read',
): SharedRequest => ({ spaceId: id, scopeId: id, capability });
@Injectable()
export class TeamInteractionContext {
  constructor(
    @Inject(SharedKernel) readonly kernel: SharedKernel,
    @Inject(TeamsService) private readonly teams: TeamsService,
    @Inject(CollaborationService)
    private readonly collaboration: CollaborationService,
  ) {}
  async read<T>(
    actor: RequestActor,
    id: string,
    work: (s: Interaction) => Promise<T>,
    members: Member[] = [],
  ) {
    await this.teams.hint(id);
    const hints = await Promise.all(
      members.map((m) => this.kernel.memberUserHint(id, m.accessId)),
    );
    const users = [...new Set(hints.filter((u): u is string => u !== null))];
    return this.kernel.run(
      actor,
      { userIds: users, spaceIds: [id] },
      [req(id)],
      async (tx, a) =>
        work({
          tx,
          a,
          actor,
          id,
          now: (
            await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
          )[0]!.now,
          locked: [...users, actor.userId],
          begin: async () => {
            throw new Error('Read context cannot mutate');
          },
        }),
    );
  }
  async write<T>(
    actor: RequestActor,
    id: string,
    cap: SharedRequest['capability'],
    members: Member[],
    action: string,
    resourceId: string,
    work: (s: Interaction) => Promise<T>,
    feature?: SharedFeatureKey,
  ) {
    await this.teams.hint(id);
    const hints = await Promise.all(
      members.map((m) => this.kernel.memberUserHint(id, m.accessId)),
    );
    return this.collaboration.signed(
      actor,
      id,
      hints.filter((u): u is string => u !== null),
      action,
      resourceId,
      async (tx, now, locked, begin) => {
        const read = await this.kernel.participantAuthority(
          tx,
          actor,
          actor.userId,
          req(id),
          locked,
        );
        const access =
          cap === 'task.read'
            ? read
            : await this.kernel.participantAuthority(
                tx,
                actor,
                actor.userId,
                req(id, cap),
                locked,
              );
        const a = new SharedAuthority(tx, [read, access]);
        let auditId: string | undefined;
        try {
          const s: Interaction = {
            tx,
            a,
            actor,
            id,
            now,
            locked,
            begin: async () => {
              auditId ??= await begin();
            },
          };
          const result = await work(s);
          if (auditId)
            await this.kernel.offerEffect(
              tx,
              actor,
              id,
              access.actorId,
              action,
              resourceId,
              auditId,
              feature
                ? { actorId: access.actorId, feature, delta: 1 }
                : undefined,
            );
          return result;
        } finally {
          a.close();
        }
      },
    );
  }
  async member(
    s: Interaction,
    m: Member,
    caps: SharedRequest['capability'][] = ['task.read'],
  ) {
    const user = await this.kernel.memberUserInTransaction(
      s.tx,
      s.id,
      m.accessId,
    );
    if (!user || !s.locked.includes(user)) throw new NotFoundException();
    return this.kernel.toolParticipant(
      s.tx,
      s.id,
      m.accessId,
      m.generation,
      user,
      caps,
    );
  }
  async eligible(s: Interaction, m: Member, admin: boolean | 'WORK' = false) {
    if (
      !(await this.kernel.visibleWorkMember(
        s.tx,
        s.a,
        s.id,
        m.accessId,
        m.generation,
      ))
    )
      return false;
    if (!admin) return true;
    const user = await this.kernel.memberUserInTransaction(
      s.tx,
      s.id,
      m.accessId,
    );
    try {
      await this.kernel.toolParticipant(
        s.tx,
        s.id,
        m.accessId,
        m.generation,
        user,
        [admin === 'WORK' ? 'work.manage' : 'settings.manage'],
      );
      return true;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof ConflictException
      )
        return false;
      throw error;
    }
  }
  access(s: Interaction) {
    return s.a.require(s.tx, s.id, 'task.read');
  }
  match(actual: number, expected: number) {
    if (actual !== expected)
      throw new ConflictException({ code: 'STALE_REVISION' });
  }
  async once(
    s: Interaction,
    operation: string,
    key: string | undefined,
    body: unknown,
    work: () => Promise<{ id: string }>,
  ) {
    if (!key || !/^[!-~]{1,128}$/.test(key)) throw new BadRequestException();
    return this.kernel.receipt(
      s.tx,
      s.a,
      req(s.id),
      {
        operation,
        key: this.access(s).generation + ':' + key,
        fingerprint: createHash('sha256')
          .update(JSON.stringify(body))
          .digest('hex'),
      },
      async () => ({ ...(await work()), statusCode: 201 }),
    );
  }
  page<T>(
    s: Interaction,
    context: string,
    q: { after?: string | undefined; limit: number },
    query: (after: string | undefined) => Promise<(T & { id: string })[]>,
  ) {
    const cursor = this.kernel.scopeCursor(s.tx, s.a, req(s.id), context);
    const after = this.kernel.cursorPosition(
      cursor.context,
      cursor.stamp,
      s.actor.userId,
      q.after,
    );
    return query(after).then((rows) =>
      this.kernel.cursorPage(cursor.context, cursor.stamp, s.actor.userId, {
        items: rows.slice(0, q.limit),
        nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
      }),
    );
  }
}
