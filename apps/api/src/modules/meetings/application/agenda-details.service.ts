import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import type { MeetingAgendaEntry } from '../../../generated/prisma/client.js';
import {
  MeetingKernel,
  meetingRevision,
  type MeetingOperation,
} from './meeting-kernel.js';
import { MeetingsService } from './meetings.service.js';
@Injectable()
export class AgendaDetailsService {
  constructor(
    @Inject(MeetingKernel) readonly op: MeetingKernel,
    @Inject(MeetingsService) readonly meetings: MeetingsService,
  ) {}
  private async entry(s: MeetingOperation, entryId: string) {
    const row = await s.tx.meetingAgendaEntry.findFirst({
      where: { id: entryId, meetingId: s.meeting.id },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  private async dto(s: MeetingOperation, row: MeetingAgendaEntry) {
    const last = await s.tx.meetingAgendaRevision.findFirst({
      where: { entryId: row.id },
      orderBy: { revision: 'desc' },
    });
    return c.AgendaDetailSchema.parse({
      id: row.id,
      meetingId: row.meetingId,
      revision: row.revision,
      plannedMinutes: row.plannedMinutes,
      completed: !!row.completedAt,
      completedAt: row.completedAt?.toISOString() ?? null,
      notes: row.notes,
      updatedByMemberId: last?.actorMemberId ?? null,
      updatedAt: last?.createdAt.toISOString() ?? null,
    });
  }
  get(actor: RequestActor, id: string, entryId: string) {
    return this.op.operation(
      actor,
      id,
      'meeting.agenda.details.read',
      async (s) => this.dto(s, await this.entry(s, entryId)),
    );
  }
  patch(
    actor: RequestActor,
    id: string,
    entryId: string,
    input: z.infer<typeof c.AgendaDetailPatchSchema>,
    expected: number | undefined,
    key: string | undefined,
  ) {
    const body = c.AgendaDetailPatchSchema.parse(input);
    return this.op.operation(
      actor,
      id,
      'meeting.agenda.details.update',
      async (s) => {
        const me = await this.op.writer(s);
        if (body.plannedMinutes !== undefined || body.completed !== undefined)
          await this.op.organizer(s);
        await this.op.once(
          s,
          key,
          { entryId, body, expected },
          'meeting.agenda.details.update',
          async () => {
            await this.meetings.active(s);
            if (
              await s.tx.meetingVersion.findFirst({
                where: {
                  meetingId: id,
                  state: { in: ['IN_REVIEW', 'APPROVED', 'FINAL'] },
                },
              })
            )
              throw new ConflictException({ code: 'AGENDA_LOCKED' });
            const row = await this.entry(s, entryId);
            meetingRevision(expected, row.revision);
            if (row.state === 'REJECTED')
              throw new ConflictException({ code: 'AGENDA_REJECTED' });
            // Proposals stay owner/organizer managed; shared accepted notes follow the current meeting audience.
            if (
              row.state === 'PROPOSED' &&
              row.memberId !== me.id &&
              !(await this.op.canOrganize(s))
            )
              throw new ForbiddenException();
            const updated = await s.tx.meetingAgendaEntry.update({
              where: { id: entryId },
              data: {
                ...(body.plannedMinutes !== undefined
                  ? { plannedMinutes: body.plannedMinutes }
                  : {}),
                ...(body.notes !== undefined ? { notes: body.notes } : {}),
                ...('completed' in body
                  ? {
                      completedAt: body.completed
                        ? (row.completedAt ?? s.now)
                        : null,
                    }
                  : {}),
                revision: { increment: 1 },
              },
            });
            await s.tx.meetingAgendaRevision.create({
              data: {
                id: randomUUID(),
                meetingId: id,
                entryId,
                revision: updated.revision,
                plannedMinutes: updated.plannedMinutes,
                completedAt: updated.completedAt,
                notes: updated.notes,
                actorMemberId: me.id,
                actorGeneration: me.generation,
              },
            });
            return entryId;
          },
        );
        return this.dto(s, await this.entry(s, entryId));
      },
    );
  }
  history(
    actor: RequestActor,
    id: string,
    entryId: string,
    q: z.infer<typeof c.MeetingPageQuerySchema>,
  ) {
    return this.op.operation(actor, id, 'meeting.agenda.history', async (s) => {
      await this.entry(s, entryId);
      const stamp = await this.op.stamp(s),
        context = 'agenda-history:' + id + ':' + entryId,
        after = this.op.after(actor, context, stamp, q.cursor);
      const rows = await s.tx.meetingAgendaRevision.findMany({
        where: {
          meetingId: id,
          entryId,
          ...(after ? { id: { gt: after } } : {}),
        },
        orderBy: { id: 'asc' },
        take: q.limit + 1,
      });
      return c.AgendaHistorySchema.parse(
        this.op.page(
          actor,
          context,
          stamp,
          rows.map((r) => ({
            id: r.id,
            entryId: r.entryId,
            meetingId: id,
            revision: r.revision,
            plannedMinutes: r.plannedMinutes,
            completed: !!r.completedAt,
            completedAt: r.completedAt?.toISOString() ?? null,
            notes: r.notes,
            updatedByMemberId: r.actorMemberId,
            updatedAt: r.createdAt.toISOString(),
          })),
          q.limit,
        ),
      );
    });
  }
  summary(actor: RequestActor, id: string) {
    return this.op.operation(actor, id, 'meeting.agenda.summary', async (s) => {
      const total = await s.tx.meetingAgendaEntry.aggregate({
          where: { meetingId: id, state: 'ACCEPTED' },
          _sum: { plannedMinutes: true },
        }),
        event = await this.meetings.event(s);
      const schedule = event.schedule;
      const meetingMinutes =
        schedule.startAt && schedule.endAt
          ? (new Date(schedule.endAt).getTime() -
              new Date(schedule.startAt).getTime()) /
            60000
          : null;
      const totalPlannedMinutes = total._sum.plannedMinutes ?? 0;
      return c.AgendaSummarySchema.parse({
        totalPlannedMinutes,
        meetingMinutes,
        exceedsMeetingLength:
          meetingMinutes !== null && totalPlannedMinutes > meetingMinutes,
      });
    });
  }
}
