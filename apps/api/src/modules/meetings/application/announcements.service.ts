import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  Announcement,
  AnnouncementVersion,
  AnnouncementTarget,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import {
  MeetingKernel,
  meetingKey,
  meetingHash,
  meetingRevision,
  meetingUnavailable,
  type SourceOperation as Op,
} from './meeting-kernel.js';
import { MeetingFiles } from './meeting-files.js';
type Page = z.infer<typeof c.MeetingPageQuerySchema>;
type Kind = 'PROJECT' | 'TEAM' | 'COMPANY';
@Injectable()
export class AnnouncementsService {
  constructor(
    @Inject(MeetingKernel) readonly op: MeetingKernel,
    @Inject(MeetingFiles) private readonly files: MeetingFiles,
  ) {}
  private async hints(scopeId: string) {
    return this.op.authority.hints(
      (await this.op.authority.sourceMembers(scopeId)).map((v) => v.actorId),
    );
  }
  async operation<T>(
    actor: RequestActor,
    id: string,
    action: string,
    work: (s: Op, a: Announcement) => Promise<T>,
    roster = false,
  ) {
    const row = await this.op.db.client.announcement.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException();
    return this.op.source(
      actor,
      row.scopeId,
      row.kind,
      action,
      id,
      async (s) => {
        const current = await s.tx.announcement.findUnique({ where: { id } });
        if (
          !current ||
          current.spaceId !== row.spaceId ||
          current.scopeId !== row.scopeId
        )
          throw new NotFoundException();
        return work(s, current);
      },
      roster ? await this.hints(row.scopeId) : [],
    );
  }
  private async manager(s: Op) {
    try {
      await this.op.sourceManager(s);
      return true;
    } catch (error) {
      if (meetingUnavailable(error)) return false;
      throw error;
    }
  }
  private async once(
    s: Op,
    a: Announcement,
    key: string | undefined,
    body: unknown,
    action: string,
    work: () => Promise<string>,
    feature?: 'announcement.version',
  ) {
    const p = s.proof!,
      identity = {
        announcementId: a.id,
        actorId: p.actorId,
        generation: p.generation,
        keyHash: meetingKey(key),
      },
      fingerprint = meetingHash({ action, body }),
      old = await s.tx.announcementMutation.findUnique({
        where: { announcementId_actorId_generation_keyHash: identity },
      });
    if (old) {
      if (old.fingerprint !== fingerprint)
        throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
      return old.resourceId;
    }
    const resourceId = await work();
    await s.tx.announcementMutation.create({
      data: {
        ...identity,
        spaceId: s.spaceId,
        accessId: p.accessId,
        fingerprint,
        resourceId,
        action,
      },
    });
    await this.op.effect(s, action, resourceId, feature);
    return resourceId;
  }
  private dto(a: Announcement) {
    return c.AnnouncementSchema.parse({
      id: a.id,
      kind: a.kind,
      sourceId: a.scopeId,
      revision: a.revision,
      createdAt: a.createdAt.toISOString(),
    });
  }
  private async target(s: Op, v: AnnouncementVersion) {
    return v.state === 'PUBLISHED'
      ? s.tx.announcementTarget
          .findUnique({
            where: {
              versionId_accessId: {
                versionId: v.id,
                accessId: s.proof!.accessId,
              },
            },
          })
          .then((row) =>
            row &&
            row.generation === s.proof!.generation &&
            row.restoreGeneration === s.proof!.restoreGeneration
              ? row
              : null,
          )
      : null;
  }
  private async version(s: Op, a: Announcement, id: string, manage = false) {
    const row = await s.tx.announcementVersion.findFirst({
      where: { id, announcementId: a.id },
    });
    if (!row) throw new NotFoundException();
    if (manage) await this.op.sourceManager(s);
    else if (!(await this.manager(s)) && !(await this.target(s, row)))
      throw new NotFoundException();
    return row;
  }
  private async versionDto(s: Op, v: AnnouncementVersion) {
    const links = await s.tx.announcementVersionAttachment.findMany({
        where: { versionId: v.id },
        orderBy: { attachmentId: 'asc' },
        take: 20,
      }),
      ack = await s.tx.announcementAcknowledgement.findUnique({
        where: {
          versionId_accessId: { versionId: v.id, accessId: s.proof!.accessId },
        },
      });
    return c.AnnouncementVersionSchema.parse({
      id: v.id,
      announcementId: v.announcementId,
      number: v.number,
      title: v.title,
      text: v.text,
      acknowledgement: v.acknowledgement,
      state: v.state,
      pinned: v.pinned,
      revision: v.revision,
      publishedAt: v.publishedAt?.toISOString() ?? null,
      createdAt: v.createdAt.toISOString(),
      attachments: links.map((x) => x.attachmentId),
      acknowledged: !!ack && ack.generation === s.proof!.generation,
    });
  }
  async create(
    actor: RequestActor,
    input: z.infer<typeof c.AnnouncementCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.AnnouncementCreateSchema.parse(input),
      digest = meetingKey(key),
      fingerprint = meetingHash(body);
    return this.op.source(
      actor,
      body.sourceId,
      body.kind,
      'announcement.create',
      body.id,
      async (s) => {
        await this.op.sourceManager(s);
        const old = await s.tx.announcement.findUnique({
          where: { id: body.id },
        });
        if (old) {
          if (
            old.spaceId !== s.spaceId ||
            old.scopeId !== s.scopeId ||
            old.createdByActorId !== s.proof!.actorId ||
            old.creationKeyHash !== digest ||
            old.creationFingerprint !== fingerprint
          )
            throw new ConflictException();
          return this.dto(old);
        }
        await s.begin();
        const row = await s.tx.announcement.create({
          data: {
            id: body.id,
            spaceId: s.spaceId,
            scopeId: s.scopeId,
            kind: body.kind,
            createdByActorId: s.proof!.actorId,
            creationKeyHash: digest,
            creationFingerprint: fingerprint,
            ...(body.kind === 'PROJECT'
              ? { projectId: s.scopeId }
              : body.kind === 'TEAM'
                ? { teamId: s.scopeId }
                : { companyId: s.spaceId }),
          },
        });
        await this.op.effect(
          s,
          'announcement.create',
          row.id,
          'announcement.resource',
        );
        return this.dto(row);
      },
    );
  }
  read(actor: RequestActor, id: string) {
    return this.operation(actor, id, 'announcement.read', async (s, a) => {
      if (!(await this.manager(s))) {
        const v = await s.tx.announcementVersion.findFirst({
          where: { announcementId: id, state: 'PUBLISHED' },
        });
        if (!v || !(await this.target(s, v))) throw new NotFoundException();
      }
      return this.dto(a);
    });
  }
  createVersion(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.AnnouncementVersionInputSchema>,
    key: string | undefined,
  ) {
    const body = c.AnnouncementVersionInputSchema.parse(input);
    return this.operation(
      actor,
      id,
      'announcement.version.create',
      async (s, a) => {
        await this.op.sourceManager(s);
        const result = await this.once(
          s,
          a,
          key,
          body,
          'announcement.version.create',
          async () => {
            const last = await s.tx.announcementVersion.findFirst({
              where: { announcementId: id },
              orderBy: { number: 'desc' },
            });
            if ((last?.number ?? 0) >= 1000)
              throw new PayloadTooLargeException();
            await s.tx.announcementVersion.create({
              data: {
                id: body.id,
                announcementId: id,
                number: (last?.number ?? 0) + 1,
                title: body.title,
                text: body.text,
                acknowledgement: body.acknowledgement,
                publisherActorId: s.proof!.actorId,
                publisherSpaceId: s.spaceId,
              },
            });
            await this.files.attachAnnouncementVersion(
              s,
              id,
              body.id,
              body.attachments,
            );
            return body.id;
          },
          'announcement.version',
        );
        return this.versionDto(s, await this.version(s, a, result, true));
      },
    );
  }
  getVersion(actor: RequestActor, id: string, versionId: string) {
    return this.operation(
      actor,
      id,
      'announcement.version.read',
      async (s, a) => this.versionDto(s, await this.version(s, a, versionId)),
    );
  }
  versions(actor: RequestActor, id: string, q: Page) {
    return this.operation(actor, id, 'announcement.versions', async (s, a) => {
      const manage = await this.manager(s),
        stamp = await this.op.authority.frame(s.tx, s.scopeId, actor.userId),
        context = 'announcement-versions:' + id,
        after = this.op.after(actor, context, stamp, q.cursor),
        p = s.proof!;
      const rows = await s.tx.announcementVersion.findMany({
          where: {
            announcementId: a.id,
            ...(!manage
              ? {
                  state: 'PUBLISHED',
                  AnnouncementTarget_version: {
                    some: {
                      accessId: p.accessId,
                      generation: p.generation,
                      restoreGeneration: p.restoreGeneration,
                    },
                  },
                }
              : {}),
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: q.limit + 1,
        }),
        items = [];
      for (const v of rows) items.push(await this.versionDto(s, v));
      return c.AnnouncementVersionPageSchema.parse(
        this.op.page(actor, context, stamp, items, q.limit),
      );
    });
  }
  list(actor: RequestActor, scopeId: string, kind: Kind, q: Page) {
    return this.op.source(
      actor,
      scopeId,
      kind,
      'announcements',
      scopeId,
      async (s) => {
        const manage = await this.manager(s),
          stamp = await this.op.authority.frame(s.tx, scopeId, actor.userId),
          context = 'announcements:' + scopeId,
          after = this.op.after(actor, context, stamp, q.cursor),
          p = s.proof!;
        const rows = await s.tx.announcementVersion.findMany({
            where: {
              announcement: { scopeId, spaceId: s.spaceId },
              ...(!manage
                ? {
                    state: 'PUBLISHED',
                    AnnouncementTarget_version: {
                      some: {
                        accessId: p.accessId,
                        generation: p.generation,
                        restoreGeneration: p.restoreGeneration,
                      },
                    },
                  }
                : {}),
              ...(after ? { id: { gt: after } } : {}),
            },
            orderBy: { id: 'asc' },
            take: q.limit + 1,
          }),
          items = [];
        for (const v of rows) items.push(await this.versionDto(s, v));
        return c.AnnouncementVersionPageSchema.parse(
          this.op.page(actor, context, stamp, items, q.limit),
        );
      },
    );
  }
  async eligible(s: Op, target: AnnouncementTarget, strict = false) {
    try {
      const userId = await this.op.authority.sourceMemberUser(
        s.tx,
        s.scopeId,
        target.accessId,
      );
      if (!userId) return null;
      if (strict && !s.locked.includes(userId))
        throw new ConflictException({ code: 'AUDIENCE_CHANGED_RESTART' });
      const p = await this.op.proof(s, userId);
      if (
        p.accessId !== target.accessId ||
        p.generation !== target.generation ||
        p.restoreGeneration !== target.restoreGeneration
      )
        return null;
      return p;
    } catch (error) {
      if (meetingUnavailable(error)) return null;
      throw error;
    }
  }
  publish(
    actor: RequestActor,
    id: string,
    versionId: string,
    input: z.infer<typeof c.AnnouncementPublishSchema>,
    expected: number | undefined,
    key: string | undefined,
  ) {
    const body = c.AnnouncementPublishSchema.parse(input);
    return this.operation(
      actor,
      id,
      'announcement.publish',
      async (s, a) => {
        await this.op.sourceManager(s);
        await this.once(
          s,
          a,
          key,
          { versionId, expected, body },
          'announcement.publish',
          async () => {
            const v = await this.version(s, a, versionId, true);
            meetingRevision(expected, v.revision);
            if (v.state !== 'DRAFT') throw new ConflictException();
            const all = await this.op.authority.sourceMembers(s.scopeId, s.tx);
            if (all.length > 1000) throw new PayloadTooLargeException();
            const selection =
              body.audience === 'ALL'
                ? all.map((x) => ({ accessId: x.id, generation: x.generation }))
                : body.members;
            const restoreGeneration = s.proof!.restoreGeneration,
              targets = [];
            for (const selected of selection) {
              const target = {
                ...selected,
                versionId,
                spaceId: s.spaceId,
                scopeId: s.scopeId,
                restoreGeneration,
              };
              if (await this.eligible(s, target, true)) targets.push(target);
              else if (body.audience === 'NAMED') throw new NotFoundException();
            }
            if (!targets.length)
              throw new ConflictException({ code: 'EMPTY_AUDIENCE' });
            await this.files.validateAnnouncementVersion(s, id, versionId);
            await s.tx.announcementVersion.updateMany({
              where: { announcementId: id, state: 'PUBLISHED' },
              data: {
                state: 'WITHDRAWN',
                pinned: false,
                revision: { increment: 1 },
              },
            });
            for (const target of targets)
              await s.tx.announcementTarget.create({ data: target });
            await s.tx.announcementVersion.update({
              where: { id: versionId },
              data: {
                state: 'PUBLISHED',
                publishedAt: s.now,
                revision: { increment: 1 },
              },
            });
            await s.tx.announcement.update({
              where: { id },
              data: { revision: { increment: 1 } },
            });
            return versionId;
          },
        );
        return this.versionDto(s, await this.version(s, a, versionId, true));
      },
      true,
    );
  }
  withdraw(
    actor: RequestActor,
    id: string,
    versionId: string,
    expected: number | undefined,
    key: string | undefined,
  ) {
    return this.operation(actor, id, 'announcement.withdraw', async (s, a) => {
      await this.op.sourceManager(s);
      await this.once(
        s,
        a,
        key,
        { versionId, expected },
        'announcement.withdraw',
        async () => {
          const v = await this.version(s, a, versionId, true);
          meetingRevision(expected, v.revision);
          if (v.state !== 'PUBLISHED') throw new ConflictException();
          await s.tx.announcementVersion.update({
            where: { id: versionId },
            data: {
              state: 'WITHDRAWN',
              pinned: false,
              revision: { increment: 1 },
            },
          });
          await s.tx.announcement.update({
            where: { id },
            data: { revision: { increment: 1 } },
          });
          return versionId;
        },
      );
      return this.versionDto(s, await this.version(s, a, versionId, true));
    });
  }
  pin(
    actor: RequestActor,
    id: string,
    versionId: string,
    pinned: boolean,
    expected: number | undefined,
    key: string | undefined,
  ) {
    return this.operation(actor, id, 'announcement.pin', async (s, a) => {
      await this.op.sourceManager(s);
      await this.once(
        s,
        a,
        key,
        { versionId, pinned, expected },
        'announcement.pin',
        async () => {
          const v = await this.version(s, a, versionId, true);
          meetingRevision(expected, v.revision);
          if (v.state !== 'PUBLISHED') throw new ConflictException();
          await s.tx.announcementVersion.update({
            where: { id: versionId },
            data: { pinned, revision: { increment: 1 } },
          });
          return versionId;
        },
      );
      return this.versionDto(s, await this.version(s, a, versionId, true));
    });
  }
  acknowledge(actor: RequestActor, id: string, versionId: string) {
    return this.operation(
      actor,
      id,
      'announcement.acknowledge',
      async (s, a) => {
        const v = await this.version(s, a, versionId);
        if (!v.acknowledgement)
          throw new ConflictException({ code: 'ACKNOWLEDGEMENT_DISABLED' });
        const target = await this.target(s, v);
        if (!target) throw new NotFoundException();
        const p = s.proof!,
          old = await s.tx.announcementAcknowledgement.findUnique({
            where: { versionId_accessId: { versionId, accessId: p.accessId } },
          });
        if (!old) {
          await s.tx.announcementAcknowledgement.create({
            data: {
              versionId,
              accessId: p.accessId,
              generation: p.generation,
              actorId: p.actorId,
              spaceId: s.spaceId,
            },
          });
          await writeAudit(s.tx, {
            action: 'NOTIFICATION_CHANGE',
            outcome: 'SUCCEEDED',
            actorUserId: actor.userId,
            requestId: actor.requestId,
            correlationId: actor.correlationId,
            resourceId: versionId,
          });
        }
        return c.AnnouncementAcknowledgementSchema.parse({
          versionId,
          acknowledged: true,
        });
      },
    );
  }
  summary(actor: RequestActor, id: string, versionId: string) {
    return this.operation(
      actor,
      id,
      'announcement.acknowledgements.summary',
      async (s, a) => {
        await this.op.sourceManager(s);
        const v = await this.version(s, a, versionId, true);
        if (v.state !== 'PUBLISHED' || !v.acknowledgement)
          throw new NotFoundException();
        const targets = await s.tx.announcementTarget.findMany({
          where: { versionId },
          orderBy: { accessId: 'asc' },
          take: 1001,
        });
        if (targets.length > 1000) throw new PayloadTooLargeException();
        let eligible = 0,
          acknowledged = 0;
        for (const target of targets) {
          if (!(await this.eligible(s, target))) continue;
          eligible++;
          if (
            await s.tx.announcementAcknowledgement.findFirst({
              where: {
                versionId,
                accessId: target.accessId,
                generation: target.generation,
              },
            })
          )
            acknowledged++;
        }
        return c.AnnouncementAcknowledgementSummarySchema.parse({
          versionId,
          eligible,
          acknowledged,
        });
      },
      true,
    );
  }
}
