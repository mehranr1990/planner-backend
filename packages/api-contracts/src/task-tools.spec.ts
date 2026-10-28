import { describe, it, expect } from 'vitest';
import {
  RecurrenceDefinitionSchema,
  RecurrenceRuleSchema,
  TaskTemplateCreateSchema,
  SavedTaskQuerySchema,
  normalizeSavedTaskQuery,
  BulkTaskItemSchema,
} from './index.js';
describe('P1-02 strict boundaries', () => {
  it('rejects invalid timezones, invalid dates, impossible yearly patterns and unsafe ranges', () => {
    const def = {
      startDate: '2024-01-01',
      endDate: null,
      localTime: '00:00',
      timezone: 'UTC',
      rule: { kind: 'DAILY', interval: 1 },
      exclusionDates: [],
    };
    for (const patch of [
      { timezone: 'invalid/zone' },
      { localTime: '24:00' },
      { startDate: '2025-02-29' },
      { endDate: '2023-12-31' },
      { ownerId: 'x' },
      { exclusionDates: ['2024-01-01', '2024-01-01'] },
    ])
      expect(
        RecurrenceDefinitionSchema.safeParse({ ...def, ...patch }).success,
      ).toBe(false);
    expect(
      RecurrenceRuleSchema.safeParse({
        kind: 'YEARLY',
        interval: 1,
        month: 2,
        day: 30,
      }).success,
    ).toBe(false);
    expect(
      RecurrenceRuleSchema.safeParse({
        kind: 'WEEKDAYS',
        interval: 1,
        weekdays: [1, 1],
      }).success,
    ).toBe(false);
  });
  it('templates accept copied values and reject lifecycle/ownership and reference IDs', () => {
    const template = {
      name: 'Daily',
      values: {
        version: 1,
        task: { title: 'Read' },
        checklist: [{ title: 'one' }],
      },
    };
    expect(TaskTemplateCreateSchema.safeParse(template).success).toBe(true);
    for (const patch of [
      { status: 'DONE' },
      { parentTaskId: 'e9130314-064f-486b-810a-c4d7e70c66ed' },
      { attachments: ['private'] },
      { spaceId: 'x' },
    ])
      expect(
        TaskTemplateCreateSchema.safeParse({
          ...template,
          values: {
            ...template.values,
            task: { ...template.values.task, ...patch },
          },
        }).success,
      ).toBe(false);
  });
  it('normalizes and rejects arbitrary SQL, operators, cursors and contradictory predicates', () => {
    expect(
      normalizeSavedTaskQuery({
        version: 1,
        where: {
          rootOnly: 'false',
          deleted: 'false',
          status: 'OPEN',
          dueFrom: '2024-01-01T00:00:00Z',
        },
      }),
    ).toEqual({
      version: 1,
      where: { dueFrom: '2024-01-01T00:00:00.000Z', status: 'OPEN' },
    });
    for (const where of [
      { sql: 'SELECT *' },
      { OR: [] },
      { cursor: 'xx' },
      { dueFrom: '2025-01-01T00:00:00Z', dueTo: '2024-01-01T00:00:00Z' },
      {
        parentTaskId: 'e9130314-064f-486b-810a-c4d7e70c66ed',
        rootOnly: 'true',
      },
    ])
      expect(
        SavedTaskQuerySchema.safeParse({ version: 1, where }).success,
      ).toBe(false);
  });
  it('bulk items reject missing revisions and overposting independently', () => {
    expect(
      BulkTaskItemSchema.safeParse({
        id: 'e9130314-064f-486b-810a-c4d7e70c66ed',
        action: 'COMPLETE',
      }).success,
    ).toBe(false);
    expect(
      BulkTaskItemSchema.safeParse({
        id: 'e9130314-064f-486b-810a-c4d7e70c66ed',
        revision: 1,
        action: 'PATCH',
        patch: { spaceId: 'x' },
      }).success,
    ).toBe(false);
  });
});
