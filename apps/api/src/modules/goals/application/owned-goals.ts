import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Goal, Prisma } from '../../../generated/prisma/client.js';
/**
 * Goal engine rows for owners whose authority is role-based rather than
 * capability-based (Company contexts). The caller has already authorized the
 * write; `verify` must reject use outside the issuing transaction.
 */
export type OwnedGoalScope = {
  spaceId: string;
  scopeId: string;
  actorId: string;
  verify: (tx: Prisma.TransactionClient) => void;
};
export type OwnedGoalInput = {
  id: string;
  title: string;
  description: string | null;
  startDate: string;
  targetDate: string;
  timezone: string;
};
export const ownedGoalStatuses = [
  'PLANNED',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'ABANDONED',
] as const;
const date = (v: string) => new Date(v + 'T00:00:00Z');
const horizon = (start: string, target: string) =>
  date(target).getTime() - date(start).getTime() <= 365 * 86400000
    ? 'SHORT_TERM'
    : 'LONG_TERM';
@Injectable()
export class OwnedGoals {
  async create(
    tx: Prisma.TransactionClient,
    s: OwnedGoalScope,
    input: OwnedGoalInput,
  ) {
    s.verify(tx);
    if (input.targetDate < input.startDate) throw new ConflictException();
    return tx.goal.create({
      data: {
        id: input.id,
        spaceId: s.spaceId,
        scopeId: s.scopeId,
        createdByActorId: s.actorId,
        title: input.title,
        description: input.description,
        horizon: horizon(input.startDate, input.targetDate),
        startDate: date(input.startDate),
        targetDate: date(input.targetDate),
        timezone: input.timezone,
      },
    });
  }
  async read(tx: Prisma.TransactionClient, s: OwnedGoalScope, id: string) {
    s.verify(tx);
    const row = await tx.goal.findFirst({
      where: { id, spaceId: s.spaceId, scopeId: s.scopeId },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  async update(
    tx: Prisma.TransactionClient,
    s: OwnedGoalScope,
    id: string,
    revision: number,
    patch: {
      title?: string | undefined;
      description?: string | null | undefined;
      status?: (typeof ownedGoalStatuses)[number] | undefined;
      startDate?: string | undefined;
      targetDate?: string | undefined;
    },
  ): Promise<Goal> {
    const before = await this.read(tx, s, id);
    if (before.revision !== revision)
      throw new ConflictException({ code: 'STALE_REVISION' });
    const start =
        patch.startDate ?? before.startDate!.toISOString().slice(0, 10),
      target =
        patch.targetDate ?? before.targetDate!.toISOString().slice(0, 10);
    if (target < start) throw new ConflictException();
    return tx.goal.update({
      where: { id },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        startDate: date(start),
        targetDate: date(target),
        horizon: horizon(start, target),
        revision: { increment: 1 },
      },
    });
  }
}
