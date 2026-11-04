import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type {
  Prisma,
  TaskFieldValue,
} from '../../../generated/prisma/client.js';
import { SharedKernel } from '../../spaces/public/index.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
import type { TaskToolContext } from '../public/project-tools.js';
import {
  scope,
  source,
  revision,
  rule,
  event,
  participant,
  taskView,
} from './project-tool-common.js';
import { fieldDefinition, fieldValue } from '../domain/custom-fields.js';
import type {
  FieldDefinition,
  FieldValue,
  FieldKind,
} from '../domain/custom-fields.js';
const definition = (
  input: z.infer<typeof c.CustomFieldVersionInputSchema>,
): FieldDefinition => ({
  kind: input.kind,
  ...(input.limits.maxLength !== undefined
    ? { maxLength: input.limits.maxLength }
    : {}),
  ...(input.limits.minimum !== undefined
    ? { minimum: input.limits.minimum }
    : {}),
  ...(input.limits.maximum !== undefined
    ? { maximum: input.limits.maximum }
    : {}),
  ...(input.options ? { options: input.options } : {}),
  ...(input.defaultValue !== undefined
    ? { defaultValue: input.defaultValue }
    : {}),
});
const view = (r: { deprecatedAt: Date | null }) =>
  c.CustomFieldSchema.strip().parse({
    ...r,
    deprecatedAt: r.deprecatedAt?.toISOString() ?? null,
  });
@Injectable()
export class FieldTools {
  constructor(@Inject(SharedKernel) private readonly kernel: SharedKernel) {}
  async peopleHint(
    db: Prisma.TransactionClient,
    spaceId: string,
    scopeId: string,
    fieldId: string,
    version: number,
  ) {
    return (
      await db.taskFieldValue.findMany({
        where: {
          spaceId,
          scopeId,
          fieldId,
          fieldVersion: version,
          taskId: null,
          personAccessId: { not: null },
        },
        select: { personAccessId: true },
      })
    ).flatMap((r) => (r.personAccessId ? [r.personAccessId] : []));
  }
  async fields(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    after: string | undefined,
    limit: number,
  ) {
    a.require(tx, ctx.spaceId, 'task.read');
    return (
      await tx.taskField.findMany({
        where: { ...scope(ctx), ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: 'asc' },
        take: limit,
      })
    ).map(view);
  }
  async field(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    id: string,
    version: number,
  ) {
    a.require(tx, ctx.spaceId, 'task.read');
    return this.version(tx, ctx, id, version);
  }
  private async value(
    tx: Prisma.TransactionClient,
    r: TaskFieldValue,
  ): Promise<FieldValue> {
    switch (r.kind as FieldKind) {
      case 'TEXT':
        return r.textValue!;
      case 'NUMBER':
        return r.numberValue!.toString();
      case 'DATE':
        return r.dateValue!.toISOString().slice(0, 10);
      case 'BOOLEAN':
        return r.booleanValue!;
      case 'PERSON':
        return { accessId: r.personAccessId!, generation: r.personGeneration! };
      case 'CURRENCY':
        return { currency: r.currency!, amount: r.numberValue!.toString() };
      case 'SINGLE_SELECT':
      case 'MULTI_SELECT': {
        const ids = (
          await tx.taskFieldSelection.findMany({
            where: { valueId: r.id },
            orderBy: { optionId: 'asc' },
          })
        ).map((s) => s.optionId);
        return r.kind === 'SINGLE_SELECT' ? ids[0]! : ids;
      }
    }
  }
  private async version(
    tx: Prisma.TransactionClient,
    ctx: TaskToolContext,
    id: string,
    version: number,
  ) {
    const where = { ...scope(ctx), fieldId: id, version },
      r = await tx.taskFieldVersion.findFirst({ where });
    if (!r) throw new NotFoundException();
    const options = await tx.taskFieldOption.findMany({
        where,
        orderBy: { position: 'asc' },
      }),
      value = await tx.taskFieldValue.findFirst({
        where: {
          ...scope(ctx),
          fieldId: id,
          fieldVersion: version,
          taskId: null,
        },
      });
    return c.CustomFieldVersionSchema.parse({
      fieldId: id,
      version,
      kind: r.kind,
      name: r.name,
      limits: r.limits,
      publishedByActorId: r.publishedByActorId,
      createdAt: r.createdAt.toISOString(),
      ...(options.length
        ? { options: options.map(({ id, label }) => ({ id, label })) }
        : {}),
      ...(r.hasDefault
        ? { defaultValue: value ? await this.value(tx, value) : null }
        : {}),
    });
  }
  private async store(
    tx: Prisma.TransactionClient,
    ctx: TaskToolContext,
    fieldId: string,
    version: number,
    kind: FieldKind,
    value: Exclude<FieldValue, null>,
    taskId: string | null,
    nextRevision = 1,
  ) {
    const data: Prisma.TaskFieldValueUncheckedCreateInput = {
      ...scope(ctx),
      id: randomUUID(),
      fieldId,
      fieldVersion: version,
      kind,
      taskId,
      revision: nextRevision,
    };
    switch (kind) {
      case 'TEXT':
        data.textValue = value as string;
        break;
      case 'NUMBER':
        data.numberValue = value as string;
        break;
      case 'DATE':
        data.dateValue = new Date(value as string);
        break;
      case 'BOOLEAN':
        data.booleanValue = value as boolean;
        break;
      case 'PERSON': {
        const p = value as { accessId: string; generation: number };
        await participant(this.kernel, tx, ctx, p.accessId, p.generation, [
          'task.read',
        ]);
        data.personAccessId = p.accessId;
        data.personGeneration = p.generation;
        break;
      }
      case 'CURRENCY': {
        const p = value as { currency: string; amount: string };
        data.numberValue = p.amount;
        data.currency = p.currency;
        break;
      }
    }
    await tx.taskFieldValue.create({ data });
    if (kind === 'SINGLE_SELECT' || kind === 'MULTI_SELECT') {
      const ids =
        kind === 'SINGLE_SELECT'
          ? [value as string]
          : (value as readonly string[]);
      if (ids.length)
        await tx.taskFieldSelection.createMany({
          data: ids.map((optionId) => ({
            ...scope(ctx),
            valueId: data.id,
            fieldId,
            fieldVersion: version,
            optionId,
          })),
        });
    }
  }
  async publishField(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    id: string,
    expected: number,
    input: z.infer<typeof c.CustomFieldVersionInputSchema>,
    key: string,
    fingerprint: string,
  ) {
    const actor = a.require(tx, ctx.spaceId, 'work.manage'),
      def = definition(input);
    a.require(tx, ctx.spaceId, 'task.read');
    rule(() => fieldDefinition(def, c.financeCurrencyScales));
    const current = await tx.taskField.findFirst({
      where: { ...scope(ctx), id },
    });
    if (expected === 0) {
      const old = await tx.taskField.findFirst({
        where: { ...scope(ctx), creationKey: key },
      });
      if (old) {
        if (old.id !== id || old.fingerprint !== fingerprint)
          throw new ConflictException();
        return this.version(tx, ctx, id, 1);
      }
      if (current) throw new ConflictException();
      if ((await tx.taskField.count({ where: scope(ctx) })) >= 100)
        throw new ConflictException({ code: 'FIELD_LIMIT' });
    } else {
      if (!current) throw new NotFoundException();
      revision(current.revision, expected);
      if (current.deprecatedAt || current.kind !== input.kind)
        throw new ConflictException({ code: 'FIELD_KIND_IMMUTABLE' });
    }
    await this.kernel.featureGrowth(tx, ctx.spaceId, 'task.field-version');
    await ctx.begin?.();
    const version = (current?.currentVersion ?? 0) + 1;
    if (!current)
      await tx.taskField.create({
        data: {
          ...scope(ctx),
          id,
          name: input.name,
          kind: input.kind,
          createdByActorId: actor.actorId,
          creationKey: key,
          fingerprint,
        },
      });
    else
      await tx.taskField.update({
        where: { id },
        data: {
          name: input.name,
          currentVersion: version,
          revision: { increment: 1 },
        },
      });
    await tx.taskFieldVersion.create({
      data: {
        ...scope(ctx),
        fieldId: id,
        version,
        kind: input.kind,
        name: input.name,
        limits: input.limits,
        hasDefault: input.defaultValue !== undefined,
        publishedByActorId: actor.actorId,
      },
    });
    if (input.options?.length)
      await tx.taskFieldOption.createMany({
        data: input.options.map((o, position) => ({
          ...scope(ctx),
          fieldId: id,
          version,
          ...o,
          position,
        })),
      });
    if (input.defaultValue !== undefined && input.defaultValue !== null)
      await this.store(
        tx,
        ctx,
        id,
        version,
        input.kind,
        rule(() =>
          fieldValue(def, input.defaultValue, c.financeCurrencyScales),
        )!,
        null,
      );
    return this.version(tx, ctx, id, version);
  }
  async deprecateField(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    id: string,
    expected: number,
    now: Date,
  ) {
    a.require(tx, ctx.spaceId, 'work.manage');
    const row = await tx.taskField.findFirst({ where: { ...scope(ctx), id } });
    if (!row) throw new NotFoundException();
    if (row.deprecatedAt) return view(row);
    revision(row.revision, expected);
    await ctx.begin?.();
    return view(
      await tx.taskField.update({
        where: { id },
        data: { deprecatedAt: now, revision: { increment: 1 } },
      }),
    );
  }
  async values(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
  ) {
    const task = await source(tx, a, ctx, taskId),
      rows = await tx.taskFieldValue.findMany({
        where: { ...scope(ctx), taskId },
        orderBy: { fieldId: 'asc' },
      }),
      items = [];
    for (const r of rows)
      items.push({
        fieldId: r.fieldId,
        version: r.fieldVersion,
        kind: r.kind,
        value: await this.value(tx, r),
        revision: r.revision,
      });
    return c.CustomFieldValuesSchema.parse({
      taskId,
      sourceRevision: task.revision,
      items,
    });
  }
  async setValue(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    fieldId: string,
    expected: number,
    input: z.infer<typeof c.CustomFieldSetSchema>,
  ) {
    const task = await source(tx, a, ctx, taskId, 'task.update');
    revision(task.revision, expected);
    const registry = await tx.taskField.findFirst({
      where: { ...scope(ctx), id: fieldId },
    });
    if (!registry) throw new NotFoundException();
    if (registry.deprecatedAt)
      throw new ConflictException({ code: 'FIELD_DEPRECATED' });
    const v = await this.version(tx, ctx, fieldId, input.version),
      def = definition(v);
    if (input.useDefault && v.defaultValue === undefined)
      throw new BadRequestException({ code: 'NO_FIELD_DEFAULT' });
    const value = rule(() =>
      fieldValue(
        def,
        input.useDefault ? v.defaultValue : input.value,
        c.financeCurrencyScales,
      ),
    );
    const old = await tx.taskFieldValue.findFirst({
        where: { ...scope(ctx), taskId, fieldId },
      }),
      before = old
        ? { version: old.fieldVersion, value: await this.value(tx, old) }
        : null;
    await ctx.begin?.();
    if (old) await tx.taskFieldValue.delete({ where: { id: old.id } });
    if (value !== null)
      await this.store(
        tx,
        ctx,
        fieldId,
        input.version,
        v.kind,
        value,
        taskId,
        (old?.revision ?? 0) + 1,
      );
    const updated = await tx.task.update({
      where: { id: taskId },
      data: { revision: { increment: 1 } },
    });
    await event(tx, a, ctx, updated, 'FIELD_VALUE', before, {
      fieldId,
      version: input.version,
      value,
    });
    return this.values(tx, a, ctx, taskId);
  }
  async search(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    input: z.infer<typeof c.CustomFieldSearchSchema>,
    after: string | undefined,
    limit: number,
  ) {
    a.require(tx, ctx.spaceId, 'task.read');
    const registry = await tx.taskField.findFirst({
      where: { ...scope(ctx), id: input.fieldId },
    });
    if (!registry) throw new NotFoundException();
    if (registry.deprecatedAt)
      throw new ConflictException({ code: 'FIELD_DEPRECATED' });
    const v = await this.version(tx, ctx, input.fieldId, input.version),
      def = definition(v),
      value = rule(() => fieldValue(def, input.value, c.financeCurrencyScales)),
      op = input.operator,
      range = op === 'EQ' ? 'equals' : op.toLowerCase();
    if (value === null) throw new BadRequestException();
    const where: Prisma.TaskFieldValueWhereInput = {
      ...scope(ctx),
      fieldId: input.fieldId,
      fieldVersion: input.version,
      taskId: { not: null },
    };
    switch (v.kind) {
      case 'TEXT':
        if (op !== 'EQ') throw new BadRequestException();
        where.textValue = value as string;
        break;
      case 'NUMBER':
      case 'DATE': {
        if (op === 'HAS') throw new BadRequestException();
        if (v.kind === 'NUMBER')
          where.numberValue = { [range]: value as string };
        else where.dateValue = { [range]: new Date(value as string) };
        break;
      }
      case 'BOOLEAN':
        if (op !== 'EQ') throw new BadRequestException();
        where.booleanValue = value as boolean;
        break;
      case 'PERSON': {
        if (op !== 'EQ') throw new BadRequestException();
        const p = value as { accessId: string; generation: number };
        where.personAccessId = p.accessId;
        where.personGeneration = p.generation;
        break;
      }
      case 'CURRENCY': {
        if (op === 'HAS') throw new BadRequestException();
        const p = value as { currency: string; amount: string };
        where.currency = p.currency;
        where.numberValue = { [range]: p.amount };
        break;
      }
      case 'SINGLE_SELECT':
      case 'MULTI_SELECT': {
        if (op !== 'HAS' && op !== 'EQ') throw new BadRequestException();
        if (v.kind === 'MULTI_SELECT' && op !== 'HAS')
          throw new BadRequestException();
        const options =
          v.kind === 'SINGLE_SELECT'
            ? [value as string]
            : (value as readonly string[]);
        if (options.length !== 1) throw new BadRequestException();
        where.TaskFieldSelection = { some: { optionId: options[0]! } };
        break;
      }
    }
    const rows = await tx.task.findMany({
      where: {
        ...scope(ctx),
        deletedAt: null,
        ...(after ? { id: { gt: after } } : {}),
        TaskFieldValue: { some: where },
      },
      orderBy: { id: 'asc' },
      take: limit,
    });
    return rows.map(taskView);
  }
}
