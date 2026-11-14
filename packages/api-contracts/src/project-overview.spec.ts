import { it, expect } from 'vitest';
import {
  ProjectMetadataPatchSchema,
  ProjectMetadataSchema,
  ProjectMemberDisplaySchema,
} from './project-overview.js';

it('accepts only bounded display metadata; status and identity are not writable', () => {
  expect(
    ProjectMetadataPatchSchema.parse({
      key: 'APP-1',
      color: '#12aBef',
      summary: null,
    }),
  ).toEqual({ key: 'APP-1', color: '#12aBef', summary: null });
  for (const input of [
    {},
    { key: '' },
    { key: 'a'.repeat(33) },
    { key: 'a b' },
    { color: 'red' },
    { color: '#fff' },
    { summary: 'a'.repeat(10001) },
    { status: 'DONE' },
    { spaceId: 'other' },
  ])
    expect(ProjectMetadataPatchSchema.safeParse(input).success).toBe(false);
  expect(
    ProjectMetadataPatchSchema.safeParse({ key: null, color: null }).success,
  ).toBe(true);
  expect(ProjectMetadataSchema.shape.status.options).toContain('ARCHIVED');
});

it('keeps contact and account fields outside the member display response', () => {
  expect(Object.keys(ProjectMemberDisplaySchema.shape).sort()).toEqual(
    [
      'actorId',
      'displayName',
      'generation',
      'id',
      'memberRole',
      'revision',
      'role',
      'scopeId',
      'spaceId',
      'state',
    ].sort(),
  );
});
