import {
  Inject,
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { TeamMeetingInvitation } from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedCalendar } from '../../calendar/public/index.js';
import { TeamInteractionContext } from './team-interaction.context.js';
import type { Interaction } from './team-interaction.context.js';
type Page = z.infer<typeof c.ProjectPageQuerySchema>;
@Injectable()
export class TeamMeetingsService {
  constructor(
    @Inject(TeamInteractionContext) private readonly op: TeamInteractionContext,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedCalendar) private readonly calendar: SharedCalendar,
  ) {}
  private async row(s: Interaction, meetingId: string, active = false) {
    const row = await s.tx.teamMeeting.findFirst({
      where: { id: meetingId, spaceId: s.id },
    });
    if (!row) throw new NotFoundException();
    const event = c.TeamCalendarEventSchema.parse(
      await this.calendar.run(s.tx, s.a, s.actor, s.id, {
        kind: 'READ',
        id: row.eventId,
      }),
    );
    if (event.deletedAt || (active && event.status !== 'ACTIVE'))
      throw new NotFoundException();
    return c.TeamMeetingSchema.parse({
      id: row.id,
      teamId: s.id,
      event,
      agenda: row.agenda,
      revision: row.revision,
      createdByActorId: row.createdByActorId,
    });
  }
  async create(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.TeamMeetingCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.TeamMeetingCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'work.manage',
      [],
      'team.meeting.create',
      body.id,
      async (s) => {
        await this.op.once(s, 'team.meeting.create', key, body, async () => {
          if (
            (await s.tx.teamMeeting.count({ where: { spaceId: id } })) >= 10000
          )
            throw new PayloadTooLargeException();
          await this.op.kernel.featureGrowth(s.tx, id, 'team.meeting');
          const event = c.TeamCalendarEventSchema.parse(
            await this.calendar.run(s.tx, s.a, actor, id, {
              kind: 'CREATE',
              key: key!,
              input: body.event,
            }),
          );
          await s.begin();
          return s.tx.teamMeeting.create({
            data: {
              id: body.id,
              spaceId: id,
              eventId: event.id,
              agenda: body.agenda,
              createdByActorId: this.op.access(s).actorId,
            },
          });
        });
        return this.row(s, body.id);
      },
      'team.meeting',
    );
  }
  read(actor: RequestActor, id: string, meetingId: string) {
    return this.op.read(actor, id, (s) => this.row(s, meetingId));
  }
  list(actor: RequestActor, id: string, q: Page) {
    return this.op.read(actor, id, (s) =>
      this.op.page(s, 'team-meetings', q, async (after) =>
        Promise.all(
          (
            await s.tx.teamMeeting.findMany({
              where: {
                spaceId: id,
                Event: { deletedAt: null },
                ...(after ? { id: { gt: after } } : {}),
              },
              orderBy: { id: 'asc' },
              take: q.limit + 1,
            })
          ).map((r) => this.row(s, r.id)),
        ),
      ),
    );
  }
  patch(
    actor: RequestActor,
    id: string,
    meetingId: string,
    revision: number,
    input: z.infer<typeof c.TeamMeetingPatchSchema>,
  ) {
    const body = c.TeamMeetingPatchSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'work.manage',
      [],
      'team.meeting.agenda',
      meetingId,
      async (s) => {
        const row = await this.row(s, meetingId, true);
        this.op.match(row.revision, revision);
        await s.begin();
        await s.tx.teamMeeting.update({
          where: { id: meetingId },
          data: { agenda: body.agenda, revision: { increment: 1 } },
        });
        return this.row(s, meetingId);
      },
    );
  }
  private async inviteView(s: Interaction, row: TeamMeetingInvitation) {
    let state: string = row.state;
    if (state !== 'REVOKED') {
      if (row.expiresAt <= s.now && state === 'PENDING') state = 'EXPIRED';
      else if (
        row.restoreGeneration !==
          (await this.op.kernel.restoreGeneration(s.tx, s.a, s.id)) ||
        !(await this.op.eligible(
          s,
          { accessId: row.inviterAccessId, generation: row.inviterGeneration },
          'WORK',
        )) ||
        !(await this.op.eligible(s, {
          accessId: row.recipientAccessId,
          generation: row.recipientGeneration,
        }))
      )
        state = 'UNAVAILABLE';
    }
    return c.TeamMeetingInvitationSchema.parse({
      id: row.id,
      meetingId: row.meetingId,
      member: {
        accessId: row.recipientAccessId,
        generation: row.recipientGeneration,
      },
      expiresAt: row.expiresAt.toISOString(),
      revision: row.revision,
      state,
    });
  }
  async invite(
    actor: RequestActor,
    id: string,
    meetingId: string,
    revision: number,
    input: z.infer<typeof c.TeamMeetingInvitationCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.TeamMeetingInvitationCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'work.manage',
      [body.member],
      'team.meeting.invite',
      body.id,
      async (s) => {
        await this.op.member(s, body.member);
        await this.op.once(
          s,
          'team.meeting.invite',
          key,
          { meetingId, revision, body },
          async () => {
            const meeting = await this.row(s, meetingId, true);
            this.op.match(meeting.revision, revision);
            const expiry = Date.parse(body.expiresAt);
            if (expiry <= +s.now || expiry > +s.now + 7 * 86400000)
              throw new ConflictException({
                code: 'INVALID_INVITATION_EXPIRY',
              });
            if (
              (await s.tx.teamMeetingInvitation.count({
                where: { spaceId: id, meetingId },
              })) >= 1000
            )
              throw new PayloadTooLargeException();
            await this.op.kernel.featureGrowth(
              s.tx,
              id,
              'team.meeting-invitation',
            );
            const epoch = await this.op.kernel.restoreGeneration(s.tx, s.a, id);
            await s.begin();
            const me = this.op.access(s);
            return s.tx.teamMeetingInvitation.create({
              data: {
                id: body.id,
                spaceId: id,
                scopeId: id,
                meetingId,
                recipientAccessId: body.member.accessId,
                recipientGeneration: body.member.generation,
                inviterAccessId: me.accessId,
                inviterGeneration: me.generation,
                expiresAt: new Date(body.expiresAt),
                restoreGeneration: epoch,
              },
            });
          },
        );
        return this.inviteView(
          s,
          await s.tx.teamMeetingInvitation.findUniqueOrThrow({
            where: { id: body.id },
          }),
        );
      },
      'team.meeting-invitation',
    );
  }
  invitations(actor: RequestActor, id: string, meetingId: string, q: Page) {
    return this.op.read(actor, id, async (s) => {
      await this.row(s, meetingId);
      const me = this.op.access(s);
      const manager = ['OWNER', 'ADMIN', 'LEAD'].includes(me.role ?? '');
      return this.op.page(
        s,
        'team-meeting-invites:' + meetingId,
        q,
        async (after) =>
          Promise.all(
            (
              await s.tx.teamMeetingInvitation.findMany({
                where: {
                  spaceId: id,
                  meetingId,
                  ...(!manager
                    ? {
                        recipientAccessId: me.accessId,
                        recipientGeneration: me.generation,
                      }
                    : {}),
                  ...(after ? { id: { gt: after } } : {}),
                },
                orderBy: { id: 'asc' },
                take: q.limit + 1,
              })
            ).map((r) => this.inviteView(s, r)),
          ),
      );
    });
  }
  async respond(
    actor: RequestActor,
    id: string,
    meetingId: string,
    invitationId: string,
    revision: number,
    decision: 'ACCEPTED' | 'DECLINED' | 'REVOKED',
  ) {
    this.op.kernel.assertEnabled();
    const hint = await this.db.client.teamMeetingInvitation.findFirst({
      where: { spaceId: id, meetingId, id: invitationId },
    });
    if (!hint) throw new NotFoundException();
    return this.op.write(
      actor,
      id,
      decision === 'REVOKED' ? 'work.manage' : 'task.read',
      [
        { accessId: hint.inviterAccessId, generation: hint.inviterGeneration },
        {
          accessId: hint.recipientAccessId,
          generation: hint.recipientGeneration,
        },
      ],
      'team.meeting.invitation.' + decision.toLowerCase(),
      invitationId,
      async (s) => {
        const row = await s.tx.teamMeetingInvitation.findFirstOrThrow({
          where: { spaceId: id, meetingId, id: invitationId },
        });
        this.op.match(row.revision, revision);
        if (
          row.state === 'REVOKED' ||
          (decision !== 'REVOKED' && row.state !== 'PENDING')
        )
          throw new ConflictException();
        if (decision !== 'REVOKED') {
          const me = this.op.access(s);
          if (
            me.accessId !== row.recipientAccessId ||
            me.generation !== row.recipientGeneration
          )
            throw new ForbiddenException();
          if (
            row.expiresAt <= s.now ||
            row.restoreGeneration !==
              (await this.op.kernel.restoreGeneration(s.tx, s.a, id))
          )
            throw new ConflictException();
          await this.op.member(
            s,
            {
              accessId: row.inviterAccessId,
              generation: row.inviterGeneration,
            },
            ['work.manage'],
          );
          await this.row(s, meetingId, true);
        }
        await s.begin();
        return this.inviteView(
          s,
          await s.tx.teamMeetingInvitation.update({
            where: { id: invitationId },
            data: { state: decision, revision: { increment: 1 } },
          }),
        );
      },
    );
  }
}
