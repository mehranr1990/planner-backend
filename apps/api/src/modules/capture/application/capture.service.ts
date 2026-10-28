import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { CAPTURE_REPOSITORY } from './capture.port.js';
import type { CapturePort, CaptureWrite } from './capture.port.js';
import { suggestions, localDate } from '../domain/parse.js';
import { searchFilter, decodeSearch, encodeSearch } from './search-cursor.js';
@Injectable()
export class CaptureService {
  constructor(@Inject(CAPTURE_REPOSITORY) private readonly repo: CapturePort) {}
  private key(k: string | undefined) {
    if (!k) throw new BadRequestException();
    return k;
  }
  private rev(v: { revision: number }, r: number) {
    if (v.revision !== r) throw new ConflictException();
  }
  create(
    scope: AuthorizedSpace,
    key: string | undefined,
    input: c.CaptureCreate,
  ) {
    return this.repo.once(
      scope,
      'post.capture',
      this.key(key),
      input,
      async (tx) => {
        if (input.voiceFileId) await tx.voice(input.voiceFileId);
        const result = await tx.create(input);
        await tx.audit('CAPTURE_CREATE', result.id);
        return result;
      },
    );
  }
  get(scope: AuthorizedSpace, id: string) {
    return this.repo.run(scope, (tx) => tx.capture(id));
  }
  list(scope: AuthorizedSpace, q: z.infer<typeof c.CaptureQuerySchema>) {
    return this.repo.run(scope, (tx) => tx.captures(q));
  }
  patch(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    input: c.CapturePatch,
  ) {
    return this.repo.run(scope, async (tx) => {
      const before = await tx.capture(id);
      this.rev(before, revision);
      if (
        before.state === 'TRIAGED' ||
        (before.state === 'ARCHIVED' && input.archive !== false)
      )
        throw new ConflictException();
      const type = input.type ?? before.type,
        text = input.text ?? before.text,
        voiceFileId =
          input.voiceFileId === undefined
            ? before.voiceFileId
            : input.voiceFileId;
      if (!c.CaptureCreateSchema.safeParse({ type, text, voiceFileId }).success)
        throw new BadRequestException();
      if (voiceFileId && voiceFileId !== before.voiceFileId)
        await tx.voice(voiceFileId);
      const result = await tx.update(before, {
        type,
        text,
        voiceFileId,
        state: input.archive === true ? 'ARCHIVED' : 'INBOX',
        targetTaskId: null,
        targetNoteId: null,
        targetJournalId: null,
        targetHabitEntryId: null,
        targetHabitId: null,
      });
      await tx.audit('CAPTURE_UPDATE', id);
      return result;
    });
  }
  triage(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    key: string | undefined,
    input: c.CaptureTriage,
  ) {
    return this.repo.once(
      scope,
      'post.capture.triage',
      this.key(key),
      { id, revision, input },
      async (tx) => {
        const before = await tx.capture(id);
        this.rev(before, revision);
        if (before.state !== 'INBOX') throw new ConflictException();
        const data: CaptureWrite = {
          type: before.type,
          text: before.text,
          voiceFileId: before.voiceFileId,
          state: input.action === 'ARCHIVE' ? 'ARCHIVED' : 'TRIAGED',
          targetTaskId: null,
          targetNoteId: null,
          targetJournalId: null,
          targetHabitEntryId: null,
          targetHabitId: null,
        };
        switch (input.action) {
          case 'CREATE_TASK':
            data.targetTaskId = (await tx.createTask(input.task)).id;
            break;
          case 'CREATE_NOTE':
            data.targetNoteId = (await tx.createNote(input.note)).id;
            break;
          case 'CREATE_JOURNAL':
            data.targetJournalId = (await tx.createJournal(input.journal)).id;
            break;
          case 'RECORD_HABIT': {
            const e = await tx.recordHabit(input.habitId, input.entry);
            data.targetHabitEntryId = e.id;
            data.targetHabitId = e.habitId;
            break;
          }
        }
        const result = await tx.update(before, data);
        await tx.audit('CAPTURE_TRIAGE', id);
        if (input.action !== 'ARCHIVE') await tx.event(id);
        return result;
      },
    );
  }
  parse(scope: AuthorizedSpace, input: c.CaptureParse) {
    return this.repo.run(scope, async (tx) => {
      const now = new Date(),
        timezone = input.timezone ?? (await tx.timezone());
      return c.CaptureParseResultSchema.parse({
        version: 1,
        ...suggestions(input.text, localDate(now, timezone)),
        timezone,
        serverNow: now.toISOString(),
      });
    });
  }
  search(scope: AuthorizedSpace, q: c.PersonalSearchQuery) {
    return this.repo.run(scope, async (tx) => {
      const defaults: c.PersonalSearchHit['kind'][] = [
        'NOTE',
        'TASK',
        'GOAL',
        'CAPTURE',
      ];
      const types = q.types
        ? q.types.split(',').map((k) => c.PersonalSearchKindSchema.parse(k))
        : [
            ...defaults,
            ...(q.includeJournal === 'true' ? ['JOURNAL' as const] : []),
            ...(q.includeMood === 'true' ? ['MOOD' as const] : []),
          ];
      if (
        new Set(types).size !== types.length ||
        types.length > 6 ||
        (types.includes('JOURNAL') && q.includeJournal !== 'true') ||
        (types.includes('MOOD') && q.includeMood !== 'true')
      )
        throw new BadRequestException();
      const sources = types.toSorted(),
        filter = searchFilter({ q: q.q, sources }),
        after = decodeSearch(scope, filter, q.cursor),
        limit = Number(q.limit ?? 25);
      const all = (
        await Promise.all(
          sources.map((kind) =>
            tx.search(kind, { q: q.q, after, limit: limit + 1 }),
          ),
        )
      )
        .flat()
        .sort((a, b) =>
          a.createdAt < b.createdAt
            ? -1
            : a.createdAt > b.createdAt
              ? 1
              : a.id < b.id
                ? -1
                : a.id > b.id
                  ? 1
                  : a.kind < b.kind
                    ? -1
                    : a.kind > b.kind
                      ? 1
                      : 0,
        );
      const items = all.slice(0, limit),
        last = items.at(-1);
      return c.PersonalSearchPageSchema.parse({
        items,
        nextCursor:
          all.length > limit && last
            ? encodeSearch(scope, filter, {
                createdAt: last.createdAt,
                id: last.id,
                kind: last.kind,
              })
            : null,
        sources,
      });
    });
  }
}
