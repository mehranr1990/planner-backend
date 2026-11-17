import {
  Inject,
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import type { AnnouncementSchedule } from '../../../generated/prisma/client.js';
import {
  MeetingKernel,
  meetingRevision,
  meetingUnavailable,
  type SourceOperation,
} from './meeting-kernel.js';
import { AnnouncementsService } from './announcements.service.js';
@Injectable()
export class AnnouncementSchedulesService {
  private after: string | undefined;
  constructor(
    @Inject(MeetingKernel) readonly op: MeetingKernel,
    @Inject(AnnouncementsService) readonly announcements: AnnouncementsService,
  ) {}
  private dto(row: AnnouncementSchedule) {
    return c.AnnouncementScheduleSchema.parse({
      versionId: row.versionId,
      revision: row.revision,
      status: row.status,
      audience: row.audience,
      timezone: row.timezone,
      scheduledAt: row.scheduledAt.toISOString(),
      publishedAt: row.publishedAt?.toISOString() ?? null,
    });
  }
  private async manager(s: SourceOperation) {
    try {
      await this.op.sourceManager(s);
    } catch (error) {
      if (meetingUnavailable(error)) throw new NotFoundException();
      throw error;
    }
  }
  read(actor: RequestActor, id: string, versionId: string) {
    return this.announcements.operation(
      actor,
      id,
      'announcement.schedule.read',
      async (s, a) => {
        await this.manager(s);
        await this.announcements.version(s, a, versionId, true);
        const row = await s.tx.announcementSchedule.findUnique({
          where: { versionId },
        });
        return row ? this.dto(row) : null;
      },
    );
  }
  schedule(
    actor: RequestActor,
    id: string,
    versionId: string,
    input: z.infer<typeof c.AnnouncementScheduleInputSchema>,
    expected: number | undefined,
    key: string | undefined,
  ) {
    const body = c.AnnouncementScheduleInputSchema.parse(input);
    return this.announcements.operation(
      actor,
      id,
      'announcement.schedule',
      async (s, a) => {
        await this.manager(s);
        await this.announcements.once(
          s,
          a,
          key,
          { versionId, expected, body },
          'announcement.schedule',
          async () => {
            const v = await this.announcements.version(s, a, versionId, true);
            meetingRevision(expected, v.revision);
            if (v.state !== 'DRAFT')
              throw new ConflictException({ code: 'ANNOUNCEMENT_NOT_DRAFT' });
            const scheduledAt = new Date(body.scheduledAt);
            if (scheduledAt <= s.now)
              throw new BadRequestException({
                code: 'SCHEDULE_MUST_BE_FUTURE',
              });
            if (body.audience.audience === 'NAMED')
              for (const t of body.audience.members) {
                if (
                  !(await this.announcements.eligible(s, {
                    ...t,
                    versionId,
                    spaceId: s.spaceId,
                    scopeId: s.scopeId,
                    restoreGeneration: s.proof!.restoreGeneration,
                  }))
                )
                  throw new NotFoundException();
              }
            const data = {
              scheduledAt,
              timezone: body.timezone,
              audience: body.audience,
              status: 'SCHEDULED',
              accessId: s.proof!.accessId,
              generation: s.proof!.generation,
              restoreGeneration: s.proof!.restoreGeneration,
              versionRevision: v.revision + 1,
              revision: v.revision + 1,
              publishedAt: null,
            };
            await s.tx.announcementVersion.update({
              where: { id: versionId },
              data: { revision: { increment: 1 } },
            });
            await s.tx.announcementSchedule.upsert({
              where: { versionId },
              create: { versionId, ...data },
              update: data,
            });
            return versionId;
          },
        );
        return this.dto(
          await s.tx.announcementSchedule.findUniqueOrThrow({
            where: { versionId },
          }),
        );
      },
      true,
    );
  }
  cancel(
    actor: RequestActor,
    id: string,
    versionId: string,
    expected: number | undefined,
    key: string | undefined,
  ) {
    return this.announcements.operation(
      actor,
      id,
      'announcement.schedule.cancel',
      async (s, a) => {
        await this.manager(s);
        await this.announcements.once(
          s,
          a,
          key,
          { versionId, expected },
          'announcement.schedule.cancel',
          async () => {
            const v = await this.announcements.version(s, a, versionId, true);
            meetingRevision(expected, v.revision);
            const row = await s.tx.announcementSchedule.findUnique({
              where: { versionId },
            });
            if (!row || row.status !== 'SCHEDULED' || v.state !== 'DRAFT')
              throw new ConflictException({ code: 'SCHEDULE_UNAVAILABLE' });
            await s.tx.announcementVersion.update({
              where: { id: versionId },
              data: { revision: { increment: 1 } },
            });
            await s.tx.announcementSchedule.update({
              where: { versionId },
              data: { status: 'CANCELED', revision: v.revision + 1 },
            });
            return versionId;
          },
        );
        return this.dto(
          await s.tx.announcementSchedule.findUniqueOrThrow({
            where: { versionId },
          }),
        );
      },
    );
  }
  /** Invoked by the existing pg-boss maintenance callback, not by HTTP/startup. */
  async consume() {
    try {
      this.op.shared.assertEnabled();
    } catch (e) {
      if (e instanceof ForbiddenException) return false;
      throw e;
    }
    const now = (
      await this.op.db.client.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp() now`
    )[0]!.now;
    const rows = await this.op.db.client.announcementSchedule.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { lte: now },
        ...(this.after ? { versionId: { gt: this.after } } : {}),
      },
      orderBy: { versionId: 'asc' },
      take: 25,
    });
    if (!rows.length) {
      this.after = undefined;
      return false;
    }
    let worked = false;
    for (const hint of rows) {
      this.after = hint.versionId;
      const v = await this.op.db.client.announcementVersion.findUnique({
        where: { id: hint.versionId },
        include: { announcement: true },
      });
      if (!v) continue;
      const users = await this.op.authority.hints(
        (await this.op.authority.sourceMembers(v.announcement.scopeId)).map(
          (m) => m.actorId,
        ),
      );
      try {
        worked =
          (await this.op.collaboration.signed(
            null,
            v.announcement.scopeId,
            users,
            'announcement.scheduled.publish',
            v.id,
            async (tx, now, locked, begin) => {
              const row = await tx.announcementSchedule.findUnique({
                where: { versionId: v.id },
              });
              if (!row || row.status !== 'SCHEDULED' || row.scheduledAt > now)
                return false;
              const a = await tx.announcement.findUniqueOrThrow({
                where: { id: v.announcementId },
              });
              const userId = await this.op.authority.sourceMemberUser(
                tx,
                a.scopeId,
                row.accessId,
              );
              if (!userId) throw new NotFoundException();
              const actor = { userId, requestId: v.id, correlationId: v.id };
              const proof = await this.op.authority.proof(
                tx,
                actor,
                a.scopeId,
                userId,
                locked,
                'work.manage',
              );
              if (
                proof.accessId !== row.accessId ||
                proof.generation !== row.generation ||
                proof.restoreGeneration !== row.restoreGeneration ||
                proof.spaceId !== a.spaceId ||
                proof.kind !== a.kind
              )
                throw new NotFoundException();
              const s: SourceOperation = {
                tx,
                actor,
                spaceId: a.spaceId,
                scopeId: a.scopeId,
                kind: a.kind,
                now,
                locked,
                begin,
                proof,
                open: true,
              };
              await this.announcements.publishWithin(
                s,
                a,
                v.id,
                c.AnnouncementPublishSchema.parse(row.audience),
                row.versionRevision,
              );
              await this.op.effect(s, 'announcement.scheduled.publish', v.id);
              return true;
            },
          )) || worked;
      } catch (e) {
        if (meetingUnavailable(e) || e instanceof ConflictException) continue;
        throw e;
      }
    }
    return worked;
  }
}
