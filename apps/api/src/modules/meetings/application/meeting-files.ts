import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  Prisma,
  MeetingAttachment,
  StoredFile,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import {
  SharedFiles,
  type SharedFileScope,
} from '../../../platform/storage/public/index.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import {
  MeetingKernel,
  meetingKey,
  meetingHash,
  meetingRevision,
  meetingUnavailable,
  type SourceOperation,
  type MeetingOperation,
} from './meeting-kernel.js';
import { MeetingsService } from './meetings.service.js';
export type MeetingFileParent = {
  kind: 'MEETING' | 'ANNOUNCEMENT';
  id: string;
};
type FileOp = SourceOperation & {
  parent: MeetingFileParent;
  meeting?: MeetingOperation['meeting'];
};
@Injectable()
export class MeetingFiles {
  private readonly proofs = new WeakSet<SourceOperation>();
  private afterFile: string | undefined;
  constructor(
    @Inject(MeetingKernel) readonly op: MeetingKernel,
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(SharedFiles) readonly files: SharedFiles,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  async operation<T>(
    actor: RequestActor,
    parent: MeetingFileParent,
    action: string,
    work: (s: FileOp) => Promise<T>,
  ) {
    if (parent.kind === 'MEETING')
      return this.op.operation(actor, parent.id, action, async (s) => {
        const file = { ...s, parent };
        try {
          return await work(file);
        } finally {
          file.open = false;
        }
      });
    const row = await this.op.db.client.announcement.findUnique({
      where: { id: parent.id },
    });
    if (!row) throw new NotFoundException();
    return this.op.source(
      actor,
      row.scopeId,
      row.kind,
      action,
      parent.id,
      async (s) => {
        const file = { ...s, parent };
        try {
          return await work(file);
        } finally {
          file.open = false;
        }
      },
    );
  }
  private meeting(s: FileOp): MeetingOperation {
    if (!s.meeting) throw new NotFoundException();
    return { ...s, meeting: s.meeting };
  }
  async fileProof(s: SourceOperation) {
    await this.op.proof(s, s.actor.userId, 'file.read');
    this.proofs.add(s);
  }
  scope(s: SourceOperation): SharedFileScope {
    return {
      spaceId: s.spaceId,
      scopeId: s.scopeId,
      actorId: s.proof!.actorId,
      verify: (tx) => {
        if (tx !== s.tx || !s.open || !this.proofs.has(s))
          throw new NotFoundException();
      },
    };
  }
  private async manager(s: FileOp) {
    try {
      if (s.parent.kind === 'MEETING')
        await this.op.organizer(this.meeting(s), true);
      else await this.op.sourceManager(s);
      return true;
    } catch (error) {
      if (meetingUnavailable(error) || error instanceof ConflictException)
        return false;
      throw error;
    }
  }
  private async writer(s: FileOp) {
    if (s.parent.kind === 'MEETING') {
      await this.op.writer(this.meeting(s));
      await this.meetings.active(this.meeting(s));
    } else await this.op.sourceManager(s);
    await this.fileProof(s);
  }
  private matches(row: MeetingAttachment, parent: MeetingFileParent) {
    return parent.kind === 'MEETING'
      ? row.meetingId === parent.id
      : row.announcementId === parent.id;
  }
  async allowed(s: FileOp, row: MeetingAttachment) {
    if (!this.matches(row, s.parent)) throw new NotFoundException();
    if (s.parent.kind === 'MEETING') {
      const m = await this.op.member(this.meeting(s));
      if (
        row.uploaderActorId === s.proof!.actorId &&
        row.memberId === m.id &&
        row.memberGeneration === m.generation
      )
        return;
      if (row.sharedAt) return;
      const links = await s.tx.meetingVersionAttachment.findMany({
        where: { meetingId: s.parent.id, attachmentId: row.id },
        include: { version: true },
        take: 1001,
      });
      if (links.length > 1000) throw new ConflictException();
      if (links.some((v) => v.version.state === 'FINAL')) return;
      if (links.length && (await this.manager(s))) return;
      if (s.proof?.role === 'VIEWER') throw new NotFoundException();
      for (const { version: v } of links) {
        if (
          (v.authorMemberId === m.id && v.authorGeneration === m.generation) ||
          (v.reviewerMemberId === m.id &&
            v.reviewerGeneration === m.generation) ||
          (await s.tx.meetingDraftContributor.findFirst({
            where: {
              versionId: v.id,
              memberId: m.id,
              generation: m.generation,
            },
          }))
        )
          return;
      }
    } else {
      if (
        row.uploaderActorId === s.proof!.actorId &&
        row.sourceAccessId === s.proof!.accessId &&
        row.sourceGeneration === s.proof!.generation &&
        row.restoreGeneration === s.proof!.restoreGeneration &&
        (await this.manager(s))
      )
        return;
      const links = await s.tx.announcementVersionAttachment.findMany({
        where: { announcementId: s.parent.id, attachmentId: row.id },
        include: { version: true },
        take: 1001,
      });
      if (links.length && (await this.manager(s))) return;
      for (const { version: v } of links) {
        if (
          v.state === 'PUBLISHED' &&
          (await s.tx.announcementTarget.findFirst({
            where: {
              versionId: v.id,
              accessId: s.proof!.accessId,
              generation: s.proof!.generation,
              restoreGeneration: s.proof!.restoreGeneration,
            },
          }))
        )
          return;
      }
    }
    throw new NotFoundException();
  }
  private async row(s: FileOp, id: string, upload = false) {
    const row = await s.tx.meetingAttachment.findFirst({
      where: { id, spaceId: s.spaceId, scopeId: s.scopeId },
    });
    if (!row || !this.matches(row, s.parent)) throw new NotFoundException();
    if (upload) {
      const member =
        s.parent.kind === 'MEETING'
          ? await this.op.member(this.meeting(s))
          : null;
      if (
        row.uploaderActorId !== s.proof!.actorId ||
        row.sourceAccessId !== s.proof!.accessId ||
        row.sourceGeneration !== s.proof!.generation ||
        row.restoreGeneration !== s.proof!.restoreGeneration ||
        (member &&
          (row.memberId !== member.id ||
            row.memberGeneration !== member.generation))
      )
        throw new NotFoundException();
      if (
        row.sharedAt ||
        (await s.tx.meetingVersionAttachment.findFirst({
          where: { attachmentId: id },
        })) ||
        (await s.tx.announcementVersionAttachment.findFirst({
          where: { attachmentId: id },
        }))
      )
        throw new ConflictException({ code: 'ATTACHMENT_LINKED' });
    } else await this.allowed(s, row);
    await this.fileProof(s);
    return { row, file: await this.files.row(s.tx, this.scope(s), id) };
  }
  dto(row: MeetingAttachment, file: StoredFile) {
    return c.MeetingFileSchema.parse({
      id: row.id,
      filename: file.filename,
      mimeType: file.mimeType,
      status: file.status,
      expectedSize: file.expectedSize,
      actualSize: file.actualSize,
      sha256: file.sha256,
      revision: row.revision,
      createdAt: row.createdAt.toISOString(),
      uploadExpiresAt: file.uploadExpiresAt.toISOString(),
      shared: !!row.sharedAt,
    });
  }
  async initiate(
    actor: RequestActor,
    parent: MeetingFileParent,
    input: z.infer<typeof c.MeetingFileUploadSchema>,
    key: string | undefined,
  ) {
    const body = c.MeetingFileUploadSchema.parse(input),
      digest = meetingKey(key),
      fingerprint = meetingHash(body);
    return this.operation(actor, parent, 'meeting.file.initiate', async (s) => {
      await this.writer(s);
      const member =
        s.parent.kind === 'MEETING'
          ? await this.op.member(this.meeting(s))
          : null;
      const old = await s.tx.meetingAttachment.findFirst({
        where: {
          ...(parent.kind === 'MEETING'
            ? {
                meetingId: parent.id,
                memberId: member!.id,
                memberGeneration: member!.generation,
              }
            : { announcementId: parent.id }),
          uploaderActorId: s.proof!.actorId,
          sourceGeneration: s.proof!.generation,
          keyHash: digest,
        },
      });
      if (old) {
        if (old.fingerprint !== fingerprint) throw new ConflictException();
        const item = await this.row(s, old.id);
        return this.dto(item.row, item.file);
      }
      const file = await this.files.initiate(
          s.tx,
          this.scope(s),
          body.id,
          body,
          s.now,
        ),
        row = await s.tx.meetingAttachment.create({
          data: {
            id: file.id,
            spaceId: s.spaceId,
            scopeId: s.scopeId,
            meetingId: parent.kind === 'MEETING' ? parent.id : null,
            announcementId: parent.kind === 'ANNOUNCEMENT' ? parent.id : null,
            uploaderActorId: s.proof!.actorId,
            sourceAccessId: s.proof!.accessId,
            sourceGeneration: s.proof!.generation,
            restoreGeneration: s.proof!.restoreGeneration,
            memberId: member?.id ?? null,
            memberGeneration: member?.generation ?? null,
            keyHash: digest,
            fingerprint,
          },
        });
      await this.op.effect(s, 'meeting.file.initiate', file.id, 'file.shared');
      return this.dto(row, file);
    });
  }
  status(actor: RequestActor, parent: MeetingFileParent, id: string) {
    return this.operation(actor, parent, 'meeting.file.read', async (s) => {
      const item = await this.row(s, id);
      return this.dto(item.row, item.file);
    });
  }
  list(
    actor: RequestActor,
    parent: MeetingFileParent,
    q: z.infer<typeof c.MeetingPageQuerySchema>,
  ) {
    return this.operation(actor, parent, 'meeting.files', async (s) => {
      await this.fileProof(s);
      const p = s.proof!,
        manage = await this.manager(s),
        context = 'meeting-files:' + parent.kind + ':' + parent.id,
        stamp =
          parent.kind === 'MEETING'
            ? await this.op.stamp(this.meeting(s))
            : await this.op.authority.frame(s.tx, s.scopeId, actor.userId),
        after = this.op.after(actor, context, stamp, q.cursor);
      const own: Prisma.MeetingAttachmentWhereInput = {
        uploaderActorId: p.actorId,
        sourceAccessId: p.accessId,
        sourceGeneration: p.generation,
        restoreGeneration: p.restoreGeneration,
      };
      let access: Prisma.MeetingAttachmentWhereInput;
      if (parent.kind === 'MEETING') {
        const m = await this.op.member(this.meeting(s));
        own.memberId = m.id;
        own.memberGeneration = m.generation;
        const version: Prisma.MeetingVersionWhereInput = manage
          ? {}
          : p.role === 'VIEWER'
            ? { state: 'FINAL' }
            : {
                OR: [
                  { state: 'FINAL' },
                  { authorMemberId: m.id, authorGeneration: m.generation },
                  { reviewerMemberId: m.id, reviewerGeneration: m.generation },
                  {
                    MeetingDraftContributor_version: {
                      some: { memberId: m.id, generation: m.generation },
                    },
                  },
                ],
              };
        access = {
          meetingId: parent.id,
          OR: [
            own,
            { sharedAt: { not: null } },
            { MeetingVersionAttachment_attachment: { some: { version } } },
          ],
        };
      } else
        access = {
          announcementId: parent.id,
          OR: [
            ...(manage ? [own] : []),
            {
              AnnouncementVersionAttachment_attachment: {
                some: {
                  version: manage
                    ? {}
                    : {
                        state: 'PUBLISHED',
                        AnnouncementTarget_version: {
                          some: {
                            accessId: p.accessId,
                            generation: p.generation,
                            restoreGeneration: p.restoreGeneration,
                          },
                        },
                      },
                },
              },
            },
          ],
        };
      const rows = await s.tx.meetingAttachment.findMany({
          where: { ...access, ...(after ? { id: { gt: after } } : {}) },
          orderBy: { id: 'asc' },
          take: q.limit + 1,
        }),
        items = [];
      for (const row of rows)
        items.push(
          this.dto(row, await this.files.row(s.tx, this.scope(s), row.id)),
        );
      return c.MeetingFilePageSchema.parse(
        this.op.page(actor, context, stamp, items, q.limit),
      );
    });
  }
  async complete(
    actor: RequestActor,
    parent: MeetingFileParent,
    id: string,
    source: Readable,
    length?: string,
  ) {
    const ticket = await this.operation(
      actor,
      parent,
      'meeting.file.claim',
      async (s) => {
        await this.writer(s);
        await this.row(s, id, true);
        const ticket = await this.files.claim(s.tx, this.scope(s), id, s.now);
        await this.op.effect(s, 'meeting.file.claim', id);
        return ticket;
      },
    );
    const abort = new AbortController(),
      timer = setTimeout(
        () => abort.abort(),
        this.config.FILE_UPLOAD_TIMEOUT_MS,
      ),
      disconnected = () => abort.abort();
    timer.unref();
    source.once('aborted', disconnected);
    try {
      const evidence = await this.files.write(
        ticket,
        source,
        length,
        abort.signal,
        { communication: true },
      );
      return await this.operation(
        actor,
        parent,
        'meeting.file.ready',
        async (s) => {
          await this.writer(s);
          await this.row(s, id, true);
          const file = await this.files.ready(
              s.tx,
              this.scope(s),
              ticket,
              evidence,
              s.now,
            ),
            row = await s.tx.meetingAttachment.update({
              where: { id },
              data: { revision: { increment: 1 } },
            });
          await this.op.effect(s, 'meeting.file.ready', id);
          return this.dto(row, file);
        },
      );
    } catch (error) {
      const rejected = await this.operation(
        actor,
        parent,
        'meeting.file.reject',
        async (s) => {
          await this.row(s, id, true);
          const file = await this.files.reject(
            s.tx,
            this.scope(s),
            id,
            ticket.attempt,
          );
          if (file) await this.op.effect(s, 'meeting.file.reject', id);
          return file;
        },
      ).catch(() => null);
      if (rejected)
        try {
          await this.files.remove(rejected);
          await this.operation(
            actor,
            parent,
            'meeting.file.cleanup',
            async (s) => {
              await this.row(s, id, true);
              await this.files.cleanupFinished(
                s.tx,
                this.scope(s),
                id,
                ticket.attempt,
              );
              await s.tx.meetingAttachment.update({
                where: { id },
                data: { retiredAt: s.now },
              });
              await this.op.effect(s, 'meeting.file.cleanup', id);
            },
          );
        } catch {
          /* Durable attempt markers are reconciled after their safe deadline. */
        }
      throw error;
    } finally {
      clearTimeout(timer);
      source.off('aborted', disconnected);
    }
  }
  async cancel(
    actor: RequestActor,
    parent: MeetingFileParent,
    id: string,
    expected: number | undefined,
  ) {
    const file = await this.operation(
      actor,
      parent,
      'meeting.file.cancel',
      async (s) => {
        const item = await this.row(s, id, true);
        meetingRevision(expected, item.row.revision);
        const file = await this.files.deleted(
          s.tx,
          this.scope(s),
          id,
          item.file.revision,
          s.now,
        );
        await s.tx.meetingAttachment.update({
          where: { id },
          data: { revision: { increment: 1 } },
        });
        await this.op.effect(s, 'meeting.file.cancel', id);
        return file;
      },
    );
    if (!file.uploadAttemptId) {
      await this.files.remove(file);
      await this.operation(actor, parent, 'meeting.file.cleanup', async (s) => {
        await this.row(s, id, true);
        await this.files.cleanupFinished(s.tx, this.scope(s), id, null);
        await s.tx.meetingAttachment.update({
          where: { id },
          data: { retiredAt: s.now },
        });
        await this.op.effect(s, 'meeting.file.cleanup', id);
      });
    }
    return this.status(actor, parent, id);
  }
  async share(
    actor: RequestActor,
    meetingId: string,
    id: string,
    expected: number | undefined,
    key: string | undefined,
  ) {
    const parent: MeetingFileParent = { kind: 'MEETING', id: meetingId };
    return this.operation(actor, parent, 'meeting.file.share', async (s) => {
      const m = this.meeting(s);
      await this.op.organizer(m);
      await this.meetings.active(m);
      await this.op.once(
        m,
        key,
        { id, expected },
        'meeting.file.share',
        async () => {
          const item = await this.row(s, id, true);
          meetingRevision(expected, item.row.revision);
          if (item.file.status !== 'READY') throw new ConflictException();
          await s.tx.meetingAttachment.update({
            where: { id },
            data: { sharedAt: s.now, revision: { increment: 1 } },
          });
          return id;
        },
      );
      const item = await this.row(s, id);
      return this.dto(item.row, item.file);
    });
  }
  async attachMeetingVersion(
    s: MeetingOperation,
    versionId: string,
    ids: string[],
  ) {
    const f: FileOp = { ...s, parent: { kind: 'MEETING', id: s.meeting.id } };
    for (const id of ids) {
      const item = await this.row(f, id);
      if (item.file.status !== 'READY')
        throw new ConflictException({ code: 'ATTACHMENT_NOT_READY' });
      await s.tx.meetingVersionAttachment.create({
        data: { meetingId: s.meeting.id, versionId, attachmentId: id },
      });
    }
  }
  async validateMeetingVersion(s: MeetingOperation, versionId: string) {
    const f: FileOp = { ...s, parent: { kind: 'MEETING', id: s.meeting.id } },
      links = await s.tx.meetingVersionAttachment.findMany({
        where: { meetingId: s.meeting.id, versionId },
        take: 21,
      });
    if (links.length > 20) throw new ConflictException();
    for (const link of links) {
      const item = await this.row(f, link.attachmentId);
      if (item.file.status !== 'READY')
        throw new ConflictException({ code: 'ATTACHMENT_NOT_READY' });
    }
  }
  async attachAnnouncementVersion(
    s: SourceOperation,
    announcementId: string,
    versionId: string,
    ids: string[],
  ) {
    const f: FileOp = {
      ...s,
      parent: { kind: 'ANNOUNCEMENT', id: announcementId },
    };
    for (const id of ids) {
      const item = await this.row(f, id);
      if (item.file.status !== 'READY')
        throw new ConflictException({ code: 'ATTACHMENT_NOT_READY' });
      await s.tx.announcementVersionAttachment.create({
        data: { announcementId, versionId, attachmentId: id },
      });
    }
  }
  async validateAnnouncementVersion(
    s: SourceOperation,
    announcementId: string,
    versionId: string,
  ) {
    const f: FileOp = {
        ...s,
        parent: { kind: 'ANNOUNCEMENT', id: announcementId },
      },
      links = await s.tx.announcementVersionAttachment.findMany({
        where: { announcementId, versionId },
        take: 21,
      });
    if (links.length > 20) throw new ConflictException();
    for (const link of links) {
      const item = await this.row(f, link.attachmentId);
      if (item.file.status !== 'READY')
        throw new ConflictException({ code: 'ATTACHMENT_NOT_READY' });
    }
  }
  async download(actor: RequestActor, parent: MeetingFileParent, id: string) {
    const locate = () =>
        this.operation(actor, parent, 'meeting.file.download', (s) =>
          this.row(s, id),
        ),
      before = await locate();
    if (before.file.status !== 'READY') throw new NotFoundException();
    const stream = await this.files.open(before.file, true);
    try {
      const after = await locate();
      if (
        after.file.status !== 'READY' ||
        after.row.revision !== before.row.revision ||
        after.file.revision !== before.file.revision
      )
        throw new NotFoundException();
      return { stream, file: this.dto(after.row, after.file) };
    } catch (error) {
      stream.destroy();
      throw error;
    }
  }
  async consume() {
    const cutoff = new Date(
        Date.now() -
          this.config.FILE_UPLOAD_TTL_SECONDS * 1000 -
          this.config.FILE_UPLOAD_TIMEOUT_MS -
          30000,
      ),
      rows = await this.op.db.client.meetingAttachment.findMany({
        where: {
          sharedAt: null,
          retiredAt: null,
          createdAt: { lt: cutoff },
          MeetingVersionAttachment_attachment: { none: {} },
          AnnouncementVersionAttachment_attachment: { none: {} },
          ...(this.afterFile ? { id: { gt: this.afterFile } } : {}),
        },
        orderBy: { id: 'asc' },
        take: 25,
      });
    if (!rows.length) {
      this.afterFile = undefined;
      return false;
    }
    for (const row of rows) {
      this.afterFile = row.id;
      const userId = await this.op.authority.operator(row.scopeId);
      if (!userId) continue;
      const perform = <T>(work: (s: SourceOperation) => Promise<T>) =>
        this.op.shared.messagingMaintenance(
          [userId],
          [row.scopeId],
          async (tx, now, locked) => {
            const actor = {
                userId,
                requestId: randomUUID(),
                correlationId: randomUUID(),
              },
              proof = await this.op.authority.proof(
                tx,
                actor,
                row.scopeId,
                userId,
                locked,
                'file.read',
              ),
              s: SourceOperation = {
                tx,
                actor,
                proof,
                spaceId: row.spaceId,
                scopeId: row.scopeId,
                kind: proof.kind,
                now,
                locked,
                open: true,
                begin: async () => randomUUID(),
              };
            this.proofs.add(s);
            try {
              return await work(s);
            } finally {
              s.open = false;
            }
          },
        );
      try {
        const file = await perform(async (s) => {
          const current = await s.tx.meetingAttachment.findUniqueOrThrow({
            where: { id: row.id },
          });
          if (
            current.sharedAt ||
            current.retiredAt ||
            (await s.tx.meetingVersionAttachment.findFirst({
              where: { attachmentId: row.id },
            })) ||
            (await s.tx.announcementVersionAttachment.findFirst({
              where: { attachmentId: row.id },
            }))
          )
            return null;
          const file = await this.files.row(s.tx, this.scope(s), row.id);
          if (file.status === 'READY')
            await this.files.deleted(
              s.tx,
              this.scope(s),
              file.id,
              file.revision,
              s.now,
            );
          const candidates = await this.files.reconcile(
            s.tx,
            this.scope(s),
            s.now,
            true,
            [row.id],
          );
          return candidates[0] ?? null;
        });
        if (!file) continue;
        await this.files.remove(file);
        await perform(async (s) => {
          await this.files.cleanupFinished(
            s.tx,
            this.scope(s),
            row.id,
            file.uploadAttemptId,
          );
          await s.tx.meetingAttachment.update({
            where: { id: row.id },
            data: { retiredAt: s.now },
          });
          await writeAudit(s.tx, {
            action: 'FILE_CLEANUP',
            outcome: 'SUCCEEDED',
            actorUserId: null,
            requestId: s.actor.requestId,
            correlationId: s.actor.correlationId,
            resourceId: row.id,
          });
        });
        return true;
      } catch (error) {
        if (!meetingUnavailable(error)) throw error;
      }
    }
    return rows.length === 25;
  }
}
