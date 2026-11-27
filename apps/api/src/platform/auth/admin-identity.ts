import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { cursorPage, cursorPosition } from '../database/cursor-pagination.js';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type {
  AdminPageSchema,
  AdminUserQuerySchema,
} from '@mehran/api-contracts';

const selection = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  image: true,
  createdAt: true,
  updatedAt: true,
} as const;
export type AdminPage = z.infer<typeof AdminPageSchema>;
export function adminPageContext(
  actorId: string,
  context: string,
  q: AdminPage,
) {
  const scope = {
    actor: { userId: actorId, requestId: actorId, correlationId: actorId },
    spaceId: actorId,
  };
  const filter = createHash('sha256')
    .update(
      context + JSON.stringify({ ...q, cursor: undefined, limit: undefined }),
    )
    .digest('hex');
  return { scope, filter, position: cursorPosition(scope, filter, q.cursor) };
}
@Injectable()
export class AdminIdentity {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async list(actorId: string, q: z.infer<typeof AdminUserQuerySchema>) {
    const { scope, filter, position } = adminPageContext(actorId, 'users', q);
    const desc = q.sort === 'createdAt_desc';
    const suspended = {
      suspendedAt: { not: null },
      OR: [
        { suspensionExpiresAt: null },
        { suspensionExpiresAt: { gt: new Date() } },
      ],
    };
    const rows = await this.db.client.user.findMany({
      where: {
        AND: [
          ...(q.verificationStatus
            ? [{ emailVerified: q.verificationStatus === 'VERIFIED' }]
            : []),
          ...(q.loginStatus
            ? [
                {
                  settings: {
                    lastRecordedLoginAt:
                      q.loginStatus === 'RECORDED_SUCCESS'
                        ? { not: null }
                        : null,
                  },
                },
              ]
            : []),
          ...(q.loginHistory
            ? [
                {
                  settings:
                    q.loginHistory === 'COMPLETE'
                      ? { signInHistoryComplete: true }
                      : q.loginHistory === 'PARTIAL'
                        ? {
                            signInHistoryComplete: false,
                            lastRecordedLoginAt: { not: null },
                          }
                        : {
                            signInHistoryComplete: false,
                            lastRecordedLoginAt: null,
                          },
                },
              ]
            : []),
          ...(q.status === 'SUSPENDED'
            ? [{ settings: suspended }]
            : q.status === 'ACTIVE'
              ? [{ emailVerified: true, NOT: { settings: suspended } }]
              : q.status === 'INACTIVE'
                ? [{ emailVerified: false, NOT: { settings: suspended } }]
                : []),
          ...(q.search
            ? [
                {
                  OR: [
                    {
                      email: {
                        contains: q.search,
                        mode: 'insensitive' as const,
                      },
                    },
                    {
                      name: {
                        contains: q.search,
                        mode: 'insensitive' as const,
                      },
                    },
                  ],
                },
              ]
            : []),
          {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.until ? { lt: new Date(q.until) } : {}),
            },
          },
          ...(position
            ? [
                {
                  OR: [
                    { createdAt: { [desc ? 'lt' : 'gt']: position.createdAt } },
                    {
                      createdAt: position.createdAt,
                      id: { [desc ? 'lt' : 'gt']: position.id },
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      select: selection,
      orderBy: [
        { createdAt: desc ? 'desc' : 'asc' },
        { id: desc ? 'desc' : 'asc' },
      ],
      take: q.limit + 1,
    });
    return cursorPage(scope, filter, q.limit, rows);
  }
  async detail(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.user.findUnique({ where: { id }, select: selection });
    if (!row) throw new NotFoundException();
    return row;
  }
  async lock(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id}::uuid FOR UPDATE`;
    return this.detail(tx, id);
  }
  async update(
    tx: Prisma.TransactionClient,
    id: string,
    operation: string,
    input: { name?: string | undefined; email?: string | undefined },
  ) {
    if (operation === 'update')
      return tx.user.update({
        where: { id },
        data: { name: input.name! },
        select: selection,
      });
    if (operation === 'verify-email') {
      const row = await this.detail(tx, id);
      if (row.email !== input.email) throw new ConflictException();
      return tx.user.update({
        where: { id, email: input.email },
        data: { emailVerified: true },
        select: selection,
      });
    }
    throw new ConflictException();
  }
  async metrics(from: Date, until: Date) {
    const [total, registrations] = await Promise.all([
      this.db.client.user.count(),
      this.db.client.$queryRaw<
        { day: string; count: number }[]
      >`SELECT to_char("createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD') AS "day", count(*)::int count FROM "User" WHERE "createdAt">=${from} AND "createdAt"<${until} GROUP BY 1 ORDER BY 1`,
    ]);
    return { total, registrations };
  }
}
