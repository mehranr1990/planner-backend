import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as c from './project-execution.js';
it('rejects SQL-null characters before register or template publication', () => {
  const row = {
    kind: 'ISSUE',
    title: 'Unsafe\0title',
    description: '',
    severity: 'LOW',
    probability: null,
    owner: null,
    mitigation: '',
    status: 'OPEN',
  };
  expect(c.ProjectRegisterInputSchema.safeParse(row).success).toBe(false);
  expect(
    c.ProjectTemplateVersionInputSchema.safeParse({
      name: 'Unsafe\0name',
      definition: {
        schemaVersion: 1,
        phases: [],
        sections: [],
        milestones: [],
        dependencies: [],
        tasks: [
          {
            key: randomUUID(),
            title: 'Safe',
            description: null,
            priority: 'NONE',
            estimatedMinutes: null,
            sectionKey: null,
            milestoneKey: null,
          },
        ],
      },
    }).success,
  ).toBe(false);
});
it('requires typed risk probability and forbids issue probability or arbitrary owners', () => {
  const base = {
    id: randomUUID(),
    kind: 'RISK',
    title: 'A',
    description: '',
    severity: 'HIGH',
    probability: 20,
    owner: null,
    mitigation: '',
    status: 'OPEN',
  };
  expect(c.ProjectRegisterCreateSchema.safeParse(base).success).toBe(true);
  expect(
    c.ProjectRegisterCreateSchema.safeParse({ ...base, kind: 'ISSUE' }).success,
  ).toBe(false);
  expect(
    c.ProjectRegisterCreateSchema.safeParse({
      ...base,
      owner: { userId: randomUUID() },
    }).success,
  ).toBe(false);
});
it('preserves nullable estimates, source revisions and immutable plan input limits', () => {
  expect(
    c.SharedEstimateInputSchema.safeParse({ estimatedMinutes: null }).success,
  ).toBe(true);
  expect(
    c.SharedEstimateInputSchema.safeParse({ estimatedMinutes: 10081 }).success,
  ).toBe(false);
  expect(
    c.ProjectBulkPreviewSchema.safeParse({ id: randomUUID(), operations: [] })
      .success,
  ).toBe(false);
  expect(
    c.ProjectChangeApplySchema.safeParse({
      manifestHash: 'a'.repeat(64),
      spaceId: randomUUID(),
    }).success,
  ).toBe(false);
});
it('accepts only bounded second-precision explicit shared effort', () => {
  const base = {
    id: randomUUID(),
    startedAt: '2030-01-01T00:00:00Z',
    endedAt: '2030-01-01T01:00:00Z',
  };
  expect(c.SharedWorkLogCreateSchema.safeParse(base).success).toBe(true);
  expect(
    c.SharedWorkLogCreateSchema.safeParse({
      ...base,
      endedAt: '2030-01-03T00:00:00Z',
    }).success,
  ).toBe(false);
  expect(
    c.SharedWorkLogCreateSchema.safeParse({
      ...base,
      startedAt: '2030-01-01T00:00:00.123Z',
    }).success,
  ).toBe(false);
});
it('rejects Personal and member references in safe template definitions', () => {
  const definition = {
    schemaVersion: 1,
    phases: [],
    sections: [],
    milestones: [],
    dependencies: [],
    tasks: [
      {
        key: randomUUID(),
        title: 'Fresh',
        description: null,
        priority: 'NONE',
        estimatedMinutes: null,
        sectionKey: null,
        milestoneKey: null,
      },
    ],
  };
  expect(c.ProjectTemplateDefinitionSchema.safeParse(definition).success).toBe(
    true,
  );
  expect(
    c.ProjectTemplateDefinitionSchema.safeParse({
      ...definition,
      tasks: [{ ...definition.tasks[0], assigneeUserId: randomUUID() }],
    }).success,
  ).toBe(false);
});
