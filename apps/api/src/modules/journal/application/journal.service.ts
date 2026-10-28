import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { JOURNAL_REPOSITORY } from './journal.port.js';
import type {
  JournalPort,
  JournalTransaction,
  PageQuery,
} from './journal.port.js';
import { localDate } from '../domain/dates.js';
@Injectable()
export class JournalService {
  constructor(@Inject(JOURNAL_REPOSITORY) private readonly repo: JournalPort) {}
  private key(k: string | undefined) {
    if (!k) throw new BadRequestException();
    return k;
  }
  private rev(v: { revision: number }, n: number) {
    if (v.revision !== n) throw new ConflictException();
  }
  private date(date: string, zone: string) {
    if (date > localDate(new Date(), zone)) throw new BadRequestException();
  }
  async createInside(
    tx: JournalTransaction,
    input: c.JournalCreate,
    kind: 'FREEFORM' | 'CHECK_IN' = 'FREEFORM',
  ) {
    const timezone = input.timezone ?? (await tx.timezone()),
      date = input.localDate ?? localDate(new Date(), timezone);
    this.date(date, timezone);
    const e = await tx.append({
      title: input.title,
      content: input.content,
      localDate: date,
      timezone,
      kind,
      deleted: false,
    });
    await tx.audit('JOURNAL_CREATE', e.id);
    return e;
  }
  create(
    scope: AuthorizedSpace,
    key: string | undefined,
    input: c.JournalCreate,
  ) {
    return this.repo.once(scope, 'post.journal', this.key(key), input, (tx) =>
      this.createInside(tx, input),
    );
  }
  async moodInside(tx: JournalTransaction, input: c.MoodCreate) {
    const parent = input.journalEntryId
      ? await tx.entry(input.journalEntryId)
      : null;
    if (parent?.deleted) throw new NotFoundException();
    const timezone =
        input.timezone ?? parent?.timezone ?? (await tx.timezone()),
      date =
        input.localDate ?? parent?.localDate ?? localDate(new Date(), timezone);
    if (parent && (parent.localDate !== date || parent.timezone !== timezone))
      throw new BadRequestException();
    this.date(date, timezone);
    const e = await tx.appendMood({
      mood: input.mood,
      energy: input.energy,
      note: input.note,
      localDate: date,
      timezone,
      journalEntryId: input.journalEntryId,
      state: 'RECORDED',
    });
    await tx.audit('MOOD_CREATE', e.id);
    return e;
  }
  createMood(
    scope: AuthorizedSpace,
    key: string | undefined,
    input: c.MoodCreate,
  ) {
    return this.repo.once(scope, 'post.moods', this.key(key), input, (tx) =>
      this.moodInside(tx, input),
    );
  }
  checkin(
    scope: AuthorizedSpace,
    key: string | undefined,
    input: c.DailyCheckinCreate,
  ) {
    return this.repo.once(
      scope,
      'post.daily-checkin',
      this.key(key),
      input,
      async (tx) => {
        const { mood, ...entryInput } = input,
          e = await this.createInside(tx, entryInput, 'CHECK_IN');
        const m = mood
          ? await this.moodInside(tx, {
              ...mood,
              localDate: e.localDate,
              timezone: e.timezone,
              journalEntryId: e.id,
            })
          : null;
        return { id: e.id, revision: e.revision, entry: e, mood: m };
      },
    );
  }
  getCheckin(scope: AuthorizedSpace, date: string) {
    return this.repo.run(scope, async (tx) => {
      const e = await tx.checkin(date);
      return {
        id: e.id,
        revision: e.revision,
        entry: e,
        mood: await tx.moodForJournal(e.id),
      };
    });
  }
  get(scope: AuthorizedSpace, id: string, includeDeleted = false) {
    return this.repo.run(scope, async (tx) => {
      const e = await tx.entry(id);
      if (e.deleted && !includeDeleted) throw new NotFoundException();
      return e;
    });
  }
  list(scope: AuthorizedSpace, q: z.infer<typeof c.JournalQuerySchema>) {
    return this.repo.run(scope, (tx) => tx.entries(q));
  }
  history(scope: AuthorizedSpace, id: string, q: PageQuery) {
    return this.repo.run(scope, async (tx) => {
      await tx.entry(id);
      return tx.history(id, q);
    });
  }
  patch(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    input: c.JournalPatch,
  ) {
    return this.repo.run(scope, async (tx) => {
      const e = await tx.entry(id);
      this.rev(e, revision);
      const result = await tx.append(
        {
          title: input.title === undefined ? e.title : input.title,
          content: input.content ?? e.content,
          localDate: e.localDate,
          timezone: e.timezone,
          kind: e.kind,
          deleted: input.deleted ?? e.deleted,
        },
        e,
      );
      await tx.audit('JOURNAL_UPDATE', id);
      return result;
    });
  }
  mood(scope: AuthorizedSpace, id: string) {
    return this.repo.run(scope, (tx) => tx.mood(id));
  }
  moods(scope: AuthorizedSpace, q: z.infer<typeof c.MoodQuerySchema>) {
    return this.repo.run(scope, (tx) => tx.moods(q));
  }
  moodHistory(scope: AuthorizedSpace, id: string, q: PageQuery) {
    return this.repo.run(scope, async (tx) => {
      await tx.mood(id);
      return tx.moodHistory(id, q);
    });
  }
  patchMood(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    input: c.MoodPatch,
  ) {
    return this.repo.run(scope, async (tx) => {
      const e = await tx.mood(id);
      this.rev(e, revision);
      const result = await tx.appendMood(
        {
          mood: input.mood ?? e.mood,
          energy: input.energy === undefined ? e.energy : input.energy,
          note: input.note === undefined ? e.note : input.note,
          localDate: e.localDate,
          timezone: e.timezone,
          journalEntryId: e.journalEntryId,
          state:
            input.void === undefined
              ? e.state
              : input.void
                ? 'VOID'
                : 'RECORDED',
        },
        e,
      );
      await tx.audit('MOOD_UPDATE', id);
      return result;
    });
  }
}
