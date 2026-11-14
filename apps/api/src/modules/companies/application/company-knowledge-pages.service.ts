import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { CompanyKnowledgeService } from './company-knowledge.service.js';
import type { StaffContext, StaffPage } from './company-staff.context.js';
/**
 * OD-6 (owner-approved): Markdown pages on existing knowledge documents.
 * Managers save immutable text versions and publish one; readers see only the
 * published version (same visibility rules as file versions), acknowledge it
 * when required, and receive in-app reminders.
 */
@Injectable()
export class CompanyKnowledgePagesService {
  constructor(
    @Inject(CompanyKnowledgeService)
    private readonly knowledge: CompanyKnowledgeService,
  ) {}
  private get op() {
    return this.knowledge.op;
  }
  private async setting(s: StaffContext, documentId: string) {
    return s.tx.companyKnowledgeSetting.findUnique({ where: { documentId } });
  }
  /** Same folder/archive rules as the file model; a published page also publishes the document. */
  private async document(s: StaffContext, documentId: string, mutable = false) {
    const manager = this.knowledge.manager(s);
    const d = await s.tx.companyKnowledgeDocument.findFirst({
      where: { ...this.op.where(s), id: documentId },
    });
    if (!d) throw new NotFoundException();
    await this.knowledge.ancestors(s, d.folderId, mutable ? false : manager);
    if ((mutable || !manager) && d.archived) throw new NotFoundException();
    const setting = await this.setting(s, documentId);
    if (!manager && !d.publishedVersionId && !setting?.publishedNumber)
      throw new NotFoundException();
    return { d, setting, manager };
  }
  private async view(s: StaffContext, documentId: string, number?: number) {
    const { d, setting, manager } = await this.document(s, documentId);
    const versions = await s.tx.companyKnowledgeText.findMany({
      where: { documentId },
      orderBy: { number: 'desc' },
      take: 500,
    });
    const published = setting?.publishedNumber ?? null,
      served =
        number !== undefined
          ? versions.find(
              (v) =>
                v.number === number &&
                (manager || (published !== null && number <= published)),
            )
          : manager
            ? versions[0]
            : versions.find((v) => v.number === published);
    if (number !== undefined && !served) throw new NotFoundException();
    const ack =
      published &&
      (await s.tx.companyKnowledgeAck.findUnique({
        where: {
          documentId_number_accessId_generation: {
            documentId,
            number: published,
            accessId: s.me.accessId,
            generation: s.me.generation,
          },
        },
      }));
    return c.KnowledgePageSchema.parse({
      documentId,
      title: d.title,
      number: served?.number ?? null,
      body: served?.body ?? null,
      note: served?.note ?? null,
      publishedNumber: published,
      versions: (manager
        ? versions
        : versions.filter((v) => published !== null && v.number <= published)
      ).map((v) => ({
        number: v.number,
        at: v.createdAt.toISOString(),
        author: { accessId: v.authorAccessId, generation: v.authorGeneration },
        note: v.note,
      })),
      ackRequired: setting?.ackRequired ?? false,
      acknowledged: Boolean(ack),
      remindedNumber: setting?.remindedNumber ?? null,
      canEdit: manager,
      revision: setting?.revision ?? 1,
    });
  }
  page(
    actor: RequestActor,
    id: string,
    scopeId: string,
    documentId: string,
    number?: number,
  ) {
    return this.knowledge.read(actor, id, scopeId, (s) =>
      this.view(s, documentId, number),
    );
  }
  private async touch(
    s: StaffContext,
    documentId: string,
    revision: number,
    data: {
      ackRequired?: boolean;
      publishedNumber?: number;
      remindedNumber?: number;
    },
  ) {
    const before = await this.setting(s, documentId);
    this.op.match(before?.revision ?? 1, revision);
    if (before)
      await s.tx.companyKnowledgeSetting.update({
        where: { documentId },
        data: { ...data, updatedAt: s.now, revision: { increment: 1 } },
      });
    else
      await s.tx.companyKnowledgeSetting.create({
        data: { documentId, spaceId: s.spaceId, scopeId: s.scopeId, ...data },
      });
  }
  save(
    actor: RequestActor,
    id: string,
    scopeId: string,
    documentId: string,
    revision: number,
    input: z.infer<typeof c.KnowledgePageSaveSchema>,
  ) {
    const body = c.KnowledgePageSaveSchema.parse(input);
    return this.knowledge.write(
      actor,
      id,
      scopeId,
      'page.save',
      documentId,
      async (s) => {
        await this.document(s, documentId, true);
        const last = await s.tx.companyKnowledgeText.findFirst({
          where: { documentId },
          orderBy: { number: 'desc' },
        });
        if ((last?.number ?? 0) >= 500)
          throw new ConflictException({ code: 'PAGE_VERSION_LIMIT' });
        await s.change();
        await s.tx.companyKnowledgeText.create({
          data: {
            id: randomUUID(),
            spaceId: s.spaceId,
            scopeId: s.scopeId,
            documentId,
            number: (last?.number ?? 0) + 1,
            body: body.body,
            note: body.note,
            authorAccessId: s.me.accessId,
            authorGeneration: s.me.generation,
          },
        });
        await this.touch(s, documentId, revision, {});
        return this.view(s, documentId);
      },
    );
  }
  publish(
    actor: RequestActor,
    id: string,
    scopeId: string,
    documentId: string,
    revision: number,
    input: z.infer<typeof c.KnowledgePagePublishSchema>,
  ) {
    const body = c.KnowledgePagePublishSchema.parse(input);
    return this.knowledge.write(
      actor,
      id,
      scopeId,
      'page.publish',
      documentId,
      async (s) => {
        await this.document(s, documentId, true);
        if (
          !(await s.tx.companyKnowledgeText.findUnique({
            where: { documentId_number: { documentId, number: body.number } },
          }))
        )
          throw new NotFoundException();
        await s.change();
        await this.touch(s, documentId, revision, {
          publishedNumber: body.number,
          ackRequired: body.ackRequired,
        });
        return this.view(s, documentId);
      },
    );
  }
  acknowledge(
    actor: RequestActor,
    id: string,
    scopeId: string,
    documentId: string,
  ) {
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.knowledge.page.ack',
      documentId,
      async (s) => {
        const { setting } = await this.document(s, documentId);
        if (!setting?.ackRequired || !setting.publishedNumber)
          throw new ConflictException({ code: 'ACKNOWLEDGEMENT_NOT_REQUIRED' });
        await s.tx.companyKnowledgeAck.createMany({
          data: [
            {
              id: randomUUID(),
              spaceId: s.spaceId,
              scopeId: s.scopeId,
              documentId,
              number: setting.publishedNumber,
              accessId: s.me.accessId,
              generation: s.me.generation,
            },
          ],
          skipDuplicates: true,
        });
        await s.change();
        return this.view(s, documentId);
      },
    );
  }
  private async audience(s: StaffContext) {
    return (await this.op.access.staffMembers(s, s.scopeId)).map((m) => ({
      accessId: m.accessId,
      generation: m.generation,
    }));
  }
  acknowledgements(
    actor: RequestActor,
    id: string,
    scopeId: string,
    documentId: string,
  ) {
    return this.knowledge.read(actor, id, scopeId, async (s) => {
      this.op.manage(s);
      const { setting } = await this.document(s, documentId);
      if (!setting?.publishedNumber) throw new NotFoundException();
      const audience = await this.audience(s);
      const acks = await s.tx.companyKnowledgeAck.findMany({
        where: { documentId, number: setting.publishedNumber },
      });
      const members = audience.map((m) => {
        const ack = acks.find(
          (a) => a.accessId === m.accessId && a.generation === m.generation,
        );
        return {
          member: m,
          acknowledgedAt: ack?.createdAt.toISOString() ?? null,
        };
      });
      return c.KnowledgeAcknowledgementReportSchema.parse({
        documentId,
        number: setting.publishedNumber,
        audience: members.length,
        acknowledged: members.filter((m) => m.acknowledgedAt).length,
        members,
      });
    });
  }
  /** One in-app reminder per member per published version (idempotent). */
  remind(actor: RequestActor, id: string, scopeId: string, documentId: string) {
    return this.knowledge.write(
      actor,
      id,
      scopeId,
      'page.remind',
      documentId,
      async (s) => {
        const { setting } = await this.document(s, documentId, true);
        if (!setting?.ackRequired || !setting.publishedNumber)
          throw new ConflictException({ code: 'ACKNOWLEDGEMENT_NOT_REQUIRED' });
        const acks = await s.tx.companyKnowledgeAck.findMany({
          where: { documentId, number: setting.publishedNumber },
        });
        const pending = (await this.audience(s)).filter(
          (m) =>
            !(
              m.accessId === s.me.accessId && m.generation === s.me.generation
            ) &&
            !acks.some(
              (a) => a.accessId === m.accessId && a.generation === m.generation,
            ),
        );
        await s.change();
        const delivered = pending.length
          ? (
              await s.tx.companyNotification.createMany({
                data: pending.map((m) => ({
                  id: randomUUID(),
                  spaceId: s.spaceId,
                  scopeId: s.scopeId,
                  recipientAccessId: m.accessId,
                  recipientGeneration: m.generation,
                  kind: 'KNOWLEDGE_ACK_REMINDER',
                  subjectId: documentId,
                  dedupeKey: 'kb:' + documentId + ':' + setting.publishedNumber,
                })),
                skipDuplicates: true,
              })
            ).count
          : 0;
        await s.tx.companyKnowledgeSetting.update({
          where: { documentId },
          data: { remindedNumber: setting.publishedNumber, updatedAt: s.now },
        });
        return c.CompanyRemindResultSchema.parse({ delivered });
      },
    );
  }
  notifications(
    actor: RequestActor,
    id: string,
    scopeId: string,
    q: StaffPage,
  ) {
    return this.op.read(actor, id, scopeId, (s) =>
      this.op.page(s, 'company.notifications', q, async () =>
        (
          await s.tx.companyNotification.findMany({
            where: {
              spaceId: s.spaceId,
              scopeId: s.scopeId,
              recipientAccessId: s.me.accessId,
              recipientGeneration: s.me.generation,
            },
            take: 1001,
          })
        ).map((r) => ({
          id: r.id,
          kind: r.kind,
          subjectId: r.subjectId,
          createdAt: r.createdAt.toISOString(),
          readAt: r.readAt?.toISOString() ?? null,
        })),
      ),
    );
  }
  readNotification(
    actor: RequestActor,
    id: string,
    scopeId: string,
    notificationId: string,
  ) {
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.notification.read',
      notificationId,
      async (s) => {
        const row = await s.tx.companyNotification.findFirst({
          where: {
            id: notificationId,
            spaceId: s.spaceId,
            scopeId: s.scopeId,
            recipientAccessId: s.me.accessId,
            recipientGeneration: s.me.generation,
          },
        });
        if (!row) throw new NotFoundException();
        const updated = row.readAt
          ? row
          : await s.tx.companyNotification.update({
              where: { id: row.id },
              data: { readAt: s.now },
            });
        return c.CompanyNotificationSchema.parse({
          id: updated.id,
          kind: updated.kind,
          subjectId: updated.subjectId,
          createdAt: updated.createdAt.toISOString(),
          readAt: updated.readAt?.toISOString() ?? null,
        });
      },
    );
  }
}
