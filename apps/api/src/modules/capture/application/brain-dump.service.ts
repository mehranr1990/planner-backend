import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  BrainDumpLine,
  Prisma,
} from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { CaptureService } from './capture.service.js';
type Tx = Prisma.TransactionClient;
type Line = Pick<
  BrainDumpLine,
  'id' | 'text' | 'sortedTo' | 'sortedDay' | 'targetId' | 'struck'
> & { position: number };
const date = (v: string) => new Date(v + 'T00:00:00Z');
const day = (d: Date) => d.toISOString().slice(0, 10);
/**
 * B3 (owner-approved): Personal Brain Dump — one page per day of ordered
 * lines. Sorting records the destination the client created; "send to Inbox"
 * creates real untriaged capture items. No automatic classification.
 */
@Injectable()
export class BrainDumpService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CaptureService) private readonly captures: CaptureService,
  ) {}
  private run<T>(scope: AuthorizedSpace, work: (tx: Tx) => Promise<T>) {
    return this.db.client.$transaction(async (tx) => {
      await scope.fence(tx);
      return work(tx);
    });
  }
  private lineView(l: BrainDumpLine | Line) {
    return c.BrainDumpLineSchema.parse({
      id: l.id,
      text: l.text,
      sortedTo: l.sortedTo,
      sortedDay: l.sortedDay ? day(l.sortedDay) : null,
      targetId: l.targetId,
      struck: l.struck,
    });
  }
  private async page(tx: Tx, scope: AuthorizedSpace, value: string) {
    const page = await tx.brainDumpPage.findUnique({
      where: { spaceId_day: { spaceId: scope.spaceId, day: date(value) } },
    });
    const lines = page
      ? await tx.brainDumpLine.findMany({
          where: { spaceId: scope.spaceId, pageId: page.id },
          orderBy: { position: 'asc' },
        })
      : [];
    return { page, lines };
  }
  private async view(tx: Tx, scope: AuthorizedSpace, value: string) {
    const { page, lines } = await this.page(tx, scope, value);
    return c.BrainDumpPageSchema.parse({
      day: value,
      lines: lines.map((l) => this.lineView(l)),
      savedAt: page?.savedAt.toISOString() ?? null,
      revision: page?.revision ?? 0,
    });
  }
  /** Rewrites the page in the given order, preserving each known line's tags. */
  private async write(
    tx: Tx,
    scope: AuthorizedSpace,
    value: string,
    lines: Line[],
  ) {
    if (lines.length > 1000) throw new ConflictException({ code: 'PAGE_FULL' });
    if (new Set(lines.map((l) => l.id)).size !== lines.length)
      throw new BadRequestException();
    let { page } = await this.page(tx, scope, value);
    if (!page)
      page = await tx.brainDumpPage.create({
        data: { id: randomUUID(), spaceId: scope.spaceId, day: date(value) },
      });
    else
      page = await tx.brainDumpPage.update({
        where: { id: page.id },
        data: { revision: { increment: 1 }, savedAt: new Date() },
      });
    const foreign = await tx.brainDumpLine.findFirst({
      where: {
        id: { in: lines.map((l) => l.id) },
        NOT: { pageId: page.id },
      },
    });
    if (foreign) throw new ConflictException({ code: 'LINE_ID_IN_USE' });
    await tx.brainDumpLine.deleteMany({
      where: { spaceId: scope.spaceId, pageId: page.id },
    });
    if (lines.length)
      await tx.brainDumpLine.createMany({
        data: lines.map((l, position) => ({
          id: l.id,
          spaceId: scope.spaceId,
          pageId: page.id,
          position,
          text: l.text,
          sortedTo: l.sortedTo,
          sortedDay: l.sortedDay,
          targetId: l.targetId,
          struck: l.struck,
        })),
      });
  }
  private current(lines: BrainDumpLine[]): Line[] {
    return lines.map((l) => ({
      id: l.id,
      text: l.text,
      sortedTo: l.sortedTo,
      sortedDay: l.sortedDay,
      targetId: l.targetId,
      struck: l.struck,
      position: l.position,
    }));
  }
  private require(lines: Line[], ids: string[]) {
    const known = new Set(lines.map((l) => l.id));
    if (ids.some((id) => !known.has(id))) throw new NotFoundException();
  }
  pages(scope: AuthorizedSpace) {
    return this.run(scope, async (tx) => {
      const pages = await tx.brainDumpPage.findMany({
        where: { spaceId: scope.spaceId },
        orderBy: { day: 'desc' },
        take: 400,
      });
      const items = [];
      for (const p of pages) {
        const lines = await tx.brainDumpLine.findMany({
          where: { spaceId: scope.spaceId, pageId: p.id },
          select: { text: true, sortedTo: true, struck: true },
        });
        const written = lines.filter((l) => l.text.trim().length > 0);
        if (!written.length) continue;
        items.push({
          day: day(p.day),
          lineCount: written.length,
          unsortedCount: written.filter((l) => !l.sortedTo && !l.struck).length,
        });
      }
      return c.BrainDumpPageListSchema.parse({ items });
    });
  }
  read(scope: AuthorizedSpace, value: string) {
    return this.run(scope, (tx) => this.view(tx, scope, value));
  }
  save(
    scope: AuthorizedSpace,
    value: string,
    input: z.infer<typeof c.BrainDumpSaveSchema>,
  ) {
    const body = c.BrainDumpSaveSchema.parse(input);
    return this.run(scope, async (tx) => {
      const before = new Map(
        this.current((await this.page(tx, scope, value)).lines).map((l) => [
          l.id,
          l,
        ]),
      );
      const lines = [...body.lines];
      while (lines.length && !lines.at(-1)!.text.trim()) lines.pop();
      await this.write(
        tx,
        scope,
        value,
        lines.map((l, position) => {
          const old = before.get(l.id);
          return {
            id: l.id,
            text: l.text,
            sortedTo: old?.sortedTo ?? null,
            sortedDay: old?.sortedDay ?? null,
            targetId: old?.targetId ?? null,
            struck: old?.struck ?? false,
            position,
          };
        }),
      );
      return this.view(tx, scope, value);
    });
  }
  add(
    scope: AuthorizedSpace,
    value: string,
    input: z.infer<typeof c.BrainDumpAddSchema>,
  ) {
    const body = c.BrainDumpAddSchema.parse(input);
    return this.run(scope, async (tx) => {
      const lines = this.current((await this.page(tx, scope, value)).lines);
      const existing = lines.find((l) => l.id === body.id);
      if (existing) {
        if (existing.text !== body.text) throw new ConflictException();
        return this.lineView(existing);
      }
      const line = {
        id: body.id,
        text: body.text,
        sortedTo: null,
        sortedDay: null,
        targetId: null,
        struck: false,
        position: lines.length,
      };
      await this.write(tx, scope, value, [...lines, line]);
      return this.lineView(line);
    });
  }
  private update(
    scope: AuthorizedSpace,
    value: string,
    ids: string[],
    change: (l: Line) => Line,
  ) {
    return this.run(scope, async (tx) => {
      const lines = this.current((await this.page(tx, scope, value)).lines);
      this.require(lines, ids);
      await this.write(
        tx,
        scope,
        value,
        lines.map((l) => (ids.includes(l.id) ? change(l) : l)),
      );
      return this.view(tx, scope, value);
    });
  }
  sort(
    scope: AuthorizedSpace,
    value: string,
    input: z.infer<typeof c.BrainDumpSortSchema>,
  ) {
    const body = c.BrainDumpSortSchema.parse(input);
    return this.update(scope, value, body.ids, (l) => ({
      ...l,
      sortedTo: body.to,
      sortedDay: body.day ? date(body.day) : null,
      targetId: body.targetId,
      struck: false,
    }));
  }
  strike(
    scope: AuthorizedSpace,
    value: string,
    input: z.infer<typeof c.BrainDumpStrikeSchema>,
  ) {
    const body = c.BrainDumpStrikeSchema.parse(input);
    return this.update(scope, value, body.ids, (l) =>
      body.struck
        ? {
            ...l,
            struck: true,
            sortedTo: null,
            sortedDay: null,
            targetId: null,
          }
        : { ...l, struck: false },
    );
  }
  unsort(
    scope: AuthorizedSpace,
    value: string,
    input: z.infer<typeof c.BrainDumpIdsSchema>,
  ) {
    const body = c.BrainDumpIdsSchema.parse(input);
    return this.update(scope, value, body.ids, (l) => ({
      ...l,
      sortedTo: null,
      sortedDay: null,
      targetId: null,
    }));
  }
  /** Each line becomes an untriaged capture (idempotent per line), tagged → INBOX. */
  async sendToInbox(
    scope: AuthorizedSpace,
    value: string,
    input: z.infer<typeof c.BrainDumpIdsSchema>,
  ) {
    const body = c.BrainDumpIdsSchema.parse(input);
    const page = await this.read(scope, value);
    const lines = page.lines.filter((l) => body.ids.includes(l.id));
    if (lines.length !== body.ids.length) throw new NotFoundException();
    const created = new Map<string, string>();
    for (const l of lines) {
      if (l.sortedTo === 'INBOX' && l.targetId) continue;
      if (!l.text.trim()) throw new BadRequestException({ code: 'BLANK_LINE' });
      const capture = await this.captures.create(scope, 'brain-dump:' + l.id, {
        type: 'NOTE',
        text: l.text,
        voiceFileId: null,
      });
      created.set(l.id, capture.id);
    }
    if (!created.size) return this.read(scope, value);
    return this.update(scope, value, [...created.keys()], (l) => ({
      ...l,
      sortedTo: 'INBOX',
      sortedDay: null,
      targetId: created.get(l.id)!,
      struck: false,
    }));
  }
  remove(
    scope: AuthorizedSpace,
    value: string,
    input: z.infer<typeof c.BrainDumpIdsSchema>,
  ) {
    const body = c.BrainDumpIdsSchema.parse(input);
    return this.run(scope, async (tx) => {
      const lines = this.current((await this.page(tx, scope, value)).lines);
      this.require(lines, body.ids);
      const removed = lines.filter((l) => body.ids.includes(l.id));
      await this.write(
        tx,
        scope,
        value,
        lines.filter((l) => !body.ids.includes(l.id)),
      );
      return c.BrainDumpRemovalSchema.parse({
        page: await this.view(tx, scope, value),
        removed: removed.map((l) => ({
          ...this.lineView(l),
          position: l.position,
        })),
      });
    });
  }
  restore(
    scope: AuthorizedSpace,
    value: string,
    input: z.infer<typeof c.BrainDumpRestoreSchema>,
  ) {
    const body = c.BrainDumpRestoreSchema.parse(input);
    return this.run(scope, async (tx) => {
      const lines = this.current((await this.page(tx, scope, value)).lines);
      const next = [...lines];
      for (const l of [...body.lines].sort((a, b) => a.position - b.position)) {
        if (next.some((x) => x.id === l.id)) continue;
        next.splice(Math.min(l.position, next.length), 0, {
          id: l.id,
          text: l.text,
          sortedTo: l.sortedTo,
          sortedDay: l.sortedDay ? date(l.sortedDay) : null,
          targetId: l.targetId,
          struck: l.struck,
          position: l.position,
        });
      }
      await this.write(tx, scope, value, next);
      return this.view(tx, scope, value);
    });
  }
}
