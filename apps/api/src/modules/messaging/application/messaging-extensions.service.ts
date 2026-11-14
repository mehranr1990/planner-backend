import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { MessagingAuthority } from '../../spaces/public/index.js';
import { MessagingService } from './messaging.service.js';
import type { MessageOperation } from './messaging.service.js';
import { AdvancedMessagingService } from './advanced-messaging.service.js';
const forbidden = (e: unknown) =>
  e instanceof ForbiddenException || e instanceof NotFoundException;
/**
 * OD-10 channel settings and conversation reports, OD-11 global search.
 * Built on MessagingService operations: every read and write re-checks the
 * caller's current admission; global search re-runs the per-conversation
 * projection so history windows, hidden and deleted messages stay enforced.
 */
@Injectable()
export class MessagingExtensionsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(MessagingService) private readonly base: MessagingService,
    @Inject(AdvancedMessagingService)
    private readonly advanced: AdvancedMessagingService,
    @Inject(MessagingAuthority) private readonly authority: MessagingAuthority,
  ) {}
  private async manages(s: MessageOperation) {
    try {
      await this.base.administer(s);
      return true;
    } catch (error) {
      if (forbidden(error)) return false;
      throw error;
    }
  }
  private async view(s: MessageOperation) {
    const member = await this.base.currentMember(s);
    const setting = await s.tx.conversationSetting.findUnique({
      where: { conversationId: s.conv.id },
    });
    const mine = await s.tx.conversationMemberSetting.findUnique({
      where: {
        memberId_generation: {
          memberId: member.id,
          generation: member.generation,
        },
      },
    });
    return c.ConversationSettingsSchema.parse({
      conversationId: s.conv.id,
      linkPreviews: setting?.linkPreviews ?? null,
      newcomerHistory: setting?.newcomerHistory ?? null,
      membersCanPin: setting?.membersCanPin ?? null,
      revision: setting?.revision ?? 1,
      canManage: await this.manages(s),
      me: {
        linkPreviews: mine?.linkPreviews ?? null,
        collapseBlocked: mine?.collapseBlocked ?? false,
        revision: mine?.revision ?? 1,
      },
    });
  }
  settings(actor: RequestActor, id: string) {
    return this.base.operation(actor, id, 'messaging.settings.read', (s) =>
      this.view(s),
    );
  }
  updateSettings(
    actor: RequestActor,
    id: string,
    revision: number,
    input: z.infer<typeof c.ConversationSettingsPatchSchema>,
  ) {
    const body = c.ConversationSettingsPatchSchema.parse(input);
    return this.base.operation(
      actor,
      id,
      'messaging.settings.update',
      async (s) => {
        const member = await this.base.currentMember(s);
        if (!(await this.manages(s))) throw new ForbiddenException();
        if (s.conv.kind === 'DM')
          throw new ConflictException({ code: 'DIRECT_SETTINGS_FIXED' });
        const before = await s.tx.conversationSetting.findUnique({
          where: { conversationId: id },
        });
        if ((before?.revision ?? 1) !== revision)
          throw new ConflictException({ code: 'REVISION_CONFLICT' });
        const data = {
          ...(body.linkPreviews !== undefined
            ? { linkPreviews: body.linkPreviews }
            : {}),
          ...(body.newcomerHistory !== undefined
            ? { newcomerHistory: body.newcomerHistory }
            : {}),
          ...(body.membersCanPin !== undefined
            ? { membersCanPin: body.membersCanPin }
            : {}),
          updatedByMemberId: member.id,
          updatedAt: s.now,
        };
        await this.base.effect(s, 'messaging.settings.update', id);
        if (before)
          await s.tx.conversationSetting.update({
            where: { conversationId: id },
            data: { ...data, revision: { increment: 1 } },
          });
        else
          await s.tx.conversationSetting.create({
            data: { conversationId: id, ...data },
          });
        return this.view(s);
      },
    );
  }
  updatePreferences(
    actor: RequestActor,
    id: string,
    revision: number,
    input: z.infer<typeof c.ConversationPreferencesPatchSchema>,
  ) {
    const body = c.ConversationPreferencesPatchSchema.parse(input);
    return this.base.operation(
      actor,
      id,
      'messaging.preferences.update',
      async (s) => {
        const member = await this.base.currentMember(s);
        const key = {
          memberId: member.id,
          generation: member.generation,
        };
        const before = await s.tx.conversationMemberSetting.findUnique({
          where: { memberId_generation: key },
        });
        if ((before?.revision ?? 1) !== revision)
          throw new ConflictException({ code: 'REVISION_CONFLICT' });
        const data = {
          ...(body.linkPreviews !== undefined
            ? { linkPreviews: body.linkPreviews }
            : {}),
          ...(body.collapseBlocked !== undefined
            ? { collapseBlocked: body.collapseBlocked }
            : {}),
          updatedAt: s.now,
        };
        if (before)
          await s.tx.conversationMemberSetting.update({
            where: { memberId_generation: key },
            data: { ...data, revision: { increment: 1 } },
          });
        else
          await s.tx.conversationMemberSetting.create({
            data: { ...key, conversationId: id, ...data },
          });
        return this.view(s);
      },
    );
  }
  private reportView(r: {
    id: string;
    conversationId: string;
    memberId: string;
    reason: string | null;
    state: string;
    resolution: string | null;
    revision: number;
    createdAt: Date;
    resolvedAt: Date | null;
  }) {
    return c.ConversationReportSchema.parse({
      id: r.id,
      conversationId: r.conversationId,
      memberId: r.memberId,
      reason: r.reason,
      state: r.state,
      resolution: r.resolution,
      revision: r.revision,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    });
  }
  report(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.ConversationReportCreateSchema>,
  ) {
    const body = c.ConversationReportCreateSchema.parse(input);
    return this.base.operation(
      actor,
      id,
      'messaging.conversation.report',
      async (s) => {
        const member = await this.base.currentMember(s);
        const existing = await s.tx.conversationReport.findUnique({
          where: { id: body.id },
        });
        if (existing) {
          if (existing.conversationId !== id || existing.memberId !== member.id)
            throw new ConflictException();
          return this.reportView(existing);
        }
        if (
          (await s.tx.conversationReport.count({
            where: { conversationId: id, memberId: member.id, state: 'OPEN' },
          })) >= 5
        )
          throw new ConflictException({ code: 'REPORT_LIMIT' });
        await this.base.effect(s, 'messaging.conversation.report', body.id);
        return this.reportView(
          await s.tx.conversationReport.create({
            data: {
              id: body.id,
              conversationId: id,
              memberId: member.id,
              generation: member.generation,
              reason: body.reason,
            },
          }),
        );
      },
    );
  }
  reports(actor: RequestActor, id: string) {
    return this.base.operation(
      actor,
      id,
      'messaging.conversation.reports',
      async (s) => {
        await this.base.currentMember(s);
        if (!(await this.manages(s))) throw new ForbiddenException();
        const rows = await s.tx.conversationReport.findMany({
          where: { conversationId: id },
          orderBy: { id: 'asc' },
          take: 200,
        });
        return c.ConversationReportListSchema.parse({
          items: rows.map((r) => this.reportView(r)),
        });
      },
    );
  }
  resolveReport(
    actor: RequestActor,
    id: string,
    reportId: string,
    revision: number,
    input: z.infer<typeof c.ConversationReportResolveSchema>,
  ) {
    const body = c.ConversationReportResolveSchema.parse(input);
    return this.base.operation(
      actor,
      id,
      'messaging.conversation.report.resolve',
      async (s) => {
        const member = await this.base.currentMember(s);
        if (!(await this.manages(s))) throw new ForbiddenException();
        const row = await s.tx.conversationReport.findFirst({
          where: { id: reportId, conversationId: id },
        });
        if (!row) throw new NotFoundException();
        if (row.revision !== revision)
          throw new ConflictException({ code: 'REVISION_CONFLICT' });
        if (row.state !== 'OPEN') throw new ConflictException();
        await this.base.effect(
          s,
          'messaging.conversation.report.resolve',
          reportId,
        );
        return this.reportView(
          await s.tx.conversationReport.update({
            where: { id: reportId },
            data: {
              state: 'RESOLVED',
              resolution: body.resolution,
              reviewerId: member.id,
              resolvedAt: s.now,
              revision: { increment: 1 },
            },
          }),
        );
      },
    );
  }
  /**
   * OD-11: newest matches across the caller's active conversations. Each
   * conversation is searched in its own authorized operation through the
   * same projection as the timeline; unauthorized conversations are skipped
   * without disclosing counts or metadata.
   */
  async search(
    actor: RequestActor,
    query: z.infer<typeof c.GlobalMessageSearchQuerySchema>,
  ) {
    const q = c.GlobalMessageSearchQuerySchema.parse(query);
    const before = q.cursor
      ? (() => {
          const at = Date.parse(Buffer.from(q.cursor, 'base64url').toString());
          if (Number.isNaN(at)) throw new BadRequestException();
          return new Date(at);
        })()
      : null;
    const actors = await this.authority.actors(actor);
    const conversations = await this.db.client.conversation.findMany({
      where: {
        Members: { some: { state: 'ACTIVE', actorId: { in: actors } } },
        ...(q.conversationId ? { id: q.conversationId } : {}),
      },
      orderBy: { id: 'asc' },
      select: { id: true },
      take: 101,
    });
    if (conversations.length > 100)
      throw new ConflictException({ code: 'SEARCH_SCOPE_TOO_LARGE' });
    const hits: z.infer<typeof c.GlobalMessageSearchHitSchema>[] = [];
    for (const { id } of conversations) {
      try {
        hits.push(
          ...(await this.advanced.searchWindow(actor, id, {
            text: q.q,
            limit: q.limit,
            before,
            after: q.after ? new Date(q.after + 'T00:00:00Z') : null,
            until: q.before
              ? new Date(Date.parse(q.before + 'T00:00:00Z') + 86400000)
              : null,
            link: q.has === 'link',
            fromMemberId: q.fromMemberId ?? null,
          })),
        );
      } catch (error) {
        if (!forbidden(error)) throw error;
      }
    }
    hits.sort((a, b) =>
      a.message.createdAt === b.message.createdAt
        ? a.message.id < b.message.id
          ? 1
          : -1
        : a.message.createdAt < b.message.createdAt
          ? 1
          : -1,
    );
    const items = hits.slice(0, q.limit);
    return c.GlobalMessageSearchPageSchema.parse({
      items,
      nextCursor:
        hits.length > q.limit
          ? Buffer.from(items.at(-1)!.message.createdAt).toString('base64url')
          : null,
    });
  }
}
