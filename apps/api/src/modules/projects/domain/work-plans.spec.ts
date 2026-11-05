import { it, expect } from 'vitest';
import { validateOperations, validateTemplate } from './work-plans.js';
const base = () => ({
  phases: [{ key: 'p' }],
  sections: [{ key: 's', phaseKey: 'p' }],
  milestones: [],
  tasks: [
    { key: 'a', sectionKey: 's', milestoneKey: null },
    { key: 'b', sectionKey: null, milestoneKey: null },
  ],
  dependencies: [{ predecessorKey: 'a', successorKey: 'b', kind: 'FS' }],
});
it('validates independent safe template structure', () =>
  expect(() => validateTemplate(base())).not.toThrow());
it('rejects unknown/duplicate definition references', () => {
  expect(() => validateTemplate({ ...base(), phases: [{ key: 's' }] })).toThrow(
    'DUPLICATE',
  );
  expect(() => validateTemplate({ ...base(), phases: [] })).toThrow('LINK');
});
it('rejects mixed-kind cycles', () =>
  expect(() =>
    validateTemplate({
      ...base(),
      dependencies: [
        ...base().dependencies,
        { predecessorKey: 'b', successorKey: 'a', kind: 'SF' },
      ],
    }),
  ).toThrow('CYCLE'));
it('rejects duplicate source operations and mixed-scope dependency IDs', () => {
  expect(() =>
    validateOperations([
      { kind: 'UPDATE_TASK', taskId: 'a' },
      { kind: 'UPDATE_TASK', taskId: 'a' },
    ]),
  ).toThrow();
  expect(() =>
    validateOperations([
      { kind: 'CREATE_TASK', task: { id: 'a' } },
      {
        kind: 'CREATE_DEPENDENCY',
        id: 'edge',
        predecessorId: 'a',
        successorId: 'foreign',
      },
    ]),
  ).toThrow();
});
it('accepts explicit create/update batches and bounds source work', () => {
  expect(() =>
    validateOperations([
      { kind: 'CREATE_TASK', task: { id: 'a' } },
      { kind: 'UPDATE_TASK', taskId: 'b' },
    ]),
  ).not.toThrow();
  expect(() =>
    validateOperations(
      Array.from({ length: 101 }, (_, i) => ({
        kind: 'CREATE_TASK',
        task: { id: String(i) },
      })),
    ),
  ).toThrow('LIMIT');
});
