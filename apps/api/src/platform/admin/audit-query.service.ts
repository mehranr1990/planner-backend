import {
  Inject,
  Injectable,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { AdminAuditQuerySchema } from '@mehran/api-contracts';
import { DatabaseService } from '../database/database.service.js';
import {
  cursorPosition,
  cursorPage,
  afterCursor,
} from '../database/cursor-pagination.js';
import { permits } from './admin-policy.js';
import { csvCell } from './management-policy.js';

@Injectable()
export class AdminAuditQuery {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async list(
    actor: { id: string; role: string },
    q: z.infer<typeof AdminAuditQuerySchema>,
  ) {
    if (
      !permits(actor.role, 'admin.audit.read') ||
      !permits(actor.role, 'admin.audit.category.' + q.category.toLowerCase())
    )
      throw new ForbiddenException();
    if (q.from && q.until && Date.parse(q.from) >= Date.parse(q.until))
      throw new BadRequestException();
    const scope = {
      actor: { userId: actor.id, requestId: actor.id, correlationId: actor.id },
      spaceId: actor.id,
    };
    const filter = createHash('sha256')
      .update(JSON.stringify({ ...q, cursor: undefined, limit: undefined }))
      .digest('hex');
    const position = cursorPosition(scope, filter, q.cursor);
    const rows = await this.db.client.adminAuditEvidence.findMany({
      where: {
        category: q.category,
        ...(q.action
          ? { action: { contains: q.action, mode: 'insensitive' } }
          : {}),
        ...(q.actorId ? { actorId: q.actorId } : {}),
        ...(q.requestId ? { requestId: q.requestId } : {}),
        ...(q.outcome ? { outcome: q.outcome } : {}),
        AND: [
          afterCursor(position),
          ...(q.targetId
            ? [
                {
                  OR: [
                    { targetUserId: q.targetId },
                    { targetAdminId: q.targetId },
                    { targetSpaceId: q.targetId },
                  ],
                },
              ]
            : []),
        ],
        createdAt: {
          ...(q.from ? { gte: new Date(q.from) } : {}),
          ...(q.until ? { lt: new Date(q.until) } : {}),
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
    });
    const page = cursorPage(scope, filter, q.limit, rows);
    return {
      ...page,
      items: page.items.map((r) => ({
        ...r,
        reason: permits(actor.role, 'admin.audit.sensitive') ? r.reason : null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
  async csv(
    actor: { id: string; role: string },
    q: z.infer<typeof AdminAuditQuerySchema>,
  ) {
    if (!permits(actor.role, 'admin.audit.export'))
      throw new ForbiddenException();
    const page = await this.list(actor, q);
    const keys = [
      'id',
      'source',
      'eventId',
      'category',
      'action',
      'outcome',
      'actorId',
      'targetUserId',
      'targetSpaceId',
      'targetAdminId',
      'beforeRevision',
      'afterRevision',
      'requestId',
      'createdAt',
      'reason',
      'digest',
    ] as const;
    return {
      csv:
        keys.map(csvCell).join(',') +
        '\r\n' +
        page.items
          .map((r) => keys.map((k) => csvCell(r[k])).join(','))
          .join('\r\n') +
        '\r\n',
      nextCursor: page.nextCursor,
    };
  }
}
