import { describe, expect, it } from 'vitest';
import {
  validateHierarchy,
  transition,
  requireRestorable,
  normalizeTitle,
  history,
  changedFields,
  TASK_RESTORE_MS,
  restoreExpired,
} from './tasks.js';
import type { TaskRecord, TaskNode } from './tasks.js';
import {
  TaskCreateSchema,
  TaskPatchSchema,
  TaskListQuerySchema,
} from '@mehran/api-contracts';

const now = new Date('2026-10-28T00:00:00Z');
const node = (id: string, parentTaskId: string | null = null): TaskNode => ({
  id,
  parentTaskId,
  status: 'OPEN',
  priority: 'NONE',
  revision: 1,
  updatedAt: now,
  deletedAt: null,
  restoreUntil: null,
  deletionBatchId: null,
});
const task = {
  ...node('root'),
  title: 'private',
  description: null,
  spaceId: 'space',
  createdByUserId: 'actor',
  plannedStartAt: null,
  dueAt: null,
  scheduledDate: null,
  completedAt: null,
  createdAt: now,
} satisfies TaskRecord;
describe('task domain and boundary invariants', () => {
  it('bounds full subtree height on reparent and rejects self and descendant cycles', () => {
    expect(() => validateHierarchy('root', [node('root')], [])).toThrow();
    const chain = Array.from({ length: 5 }, (_, i) => node(String(i)));
    expect(() => validateHierarchy('root', chain, [])).not.toThrow();
    expect(() =>
      validateHierarchy('root', [...chain, node('extra')], []),
    ).toThrow();
    expect(() =>
      validateHierarchy('root', chain, [node('root'), node('child', 'root')]),
    ).toThrow();
    expect(() =>
      validateHierarchy(
        'root',
        [],
        [node('a', 'root'), node('b', 'a'), node('a', 'b')],
      ),
    ).toThrow();
  });
  it('separates completion timestamp from reopen and preserves no-op revisions', () => {
    expect(transition(task, 'complete', now)).toEqual({
      status: 'DONE',
      completedAt: now,
    });
    const done = { ...task, status: 'DONE' as const, completedAt: now };
    expect(transition(done, 'complete', now)).toEqual({});
    expect(transition(done, 'reopen', now)).toEqual({
      status: 'OPEN',
      completedAt: null,
    });
    expect(transition(task, 'reopen', now)).toEqual({});
  });
  it('enforces the exact stored seven-day restore deadline', () => {
    expect(TASK_RESTORE_MS).toBe(7 * 86400000);
    const deletedAt = new Date(now.getTime() - TASK_RESTORE_MS + 1);
    const deleted = {
      ...task,
      deletedAt,
      restoreUntil: new Date(deletedAt.getTime() + TASK_RESTORE_MS),
    };
    expect(() => requireRestorable(deleted, now)).not.toThrow();
    expect(() =>
      requireRestorable({ ...deleted, restoreUntil: now }, now),
    ).toThrow();
    // A deletion recorded before ADR 0069 keeps its persisted 30-day deadline.
    const legacy = {
      ...task,
      deletedAt: new Date(now.getTime() - 20 * 86400000),
      restoreUntil: new Date(now.getTime() + 10 * 86400000),
    };
    expect(restoreExpired(legacy, now)).toBe(false);
    expect(() => requireRestorable(legacy, now)).not.toThrow();
    // Missing deadline fails closed.
    expect(restoreExpired({ deletedAt: now, restoreUntil: null }, now)).toBe(
      true,
    );
  });
  it('normalizes Unicode names without altering rich content and never copies text into history', () => {
    expect(normalizeTitle('  cafe\u0301  plan\nnext ')).toBe('café plan next');
    const after = { ...task, revision: 2, title: 'sensitive replacement' };
    expect(changedFields(task, { title: after.title })).toEqual(['title']);
    const evidence = history(task, after, 'UPDATED', ['title']);
    expect(JSON.stringify(evidence)).not.toMatch(
      /private|sensitive|replacement/,
    );
    expect(evidence.previousRevision).toBe(1);
  });
  it('strictly rejects overposting, recurrence, completion shortcuts, invalid date-only and UTF-16 inputs', () => {
    for (const body of [
      { title: 'x', spaceId: 'x' },
      { title: 'x', status: 'DONE' },
      { title: 'x', recurrence: {} },
      { title: 'x', scheduledDate: '2025-02-29' },
      { title: '\ud800' },
      { title: '\u0000' },
    ])
      expect(TaskCreateSchema.safeParse(body).success).toBe(false);
    expect(
      TaskCreateSchema.safeParse({
        title: 'سلام 😀',
        scheduledDate: '2028-02-29',
        description: {
          format: 'MARKDOWN',
          version: 1,
          content: '<script>private</script>',
        },
      }).success,
    ).toBe(true);
    expect(TaskPatchSchema.safeParse({}).success).toBe(false);
    expect(
      TaskListQuerySchema.safeParse({
        dueFrom: '2026-11-01T00:00:00Z',
        dueTo: '2026-01-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });
});
