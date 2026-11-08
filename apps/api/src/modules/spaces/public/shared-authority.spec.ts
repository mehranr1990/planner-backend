import { it, expect } from 'vitest';
import type { Prisma } from '../../../generated/prisma/client.js';
import { SharedAuthority } from './shared-authority.js';
import type { SharedAccess } from './shared-authority.js';

const tx = {} as Prisma.TransactionClient;
const proof = (scopeId: string): SharedAccess => ({
  spaceId: 'company',
  scopeId,
  actorId: 'actor',
  accessId: 'admission',
  generation: 1,
  role: 'MEMBER',
  capability: 'task.read',
  authorizationVersion: 1n,
});

it('matches the complete scope identity and never substitutes root or sibling authority', () => {
  const root = new SharedAuthority(tx, [proof('company')]);
  expect(() =>
    root.require(tx, 'company', 'task.read', undefined, 'project-a'),
  ).toThrow();
  const all = new SharedAuthority(tx, [
    proof('company'),
    proof('project-a'),
    proof('project-b'),
  ]);
  const child = all.forScope(tx, 'company', 'project-a');
  expect(child.require(tx, 'company', 'task.read').scopeId).toBe('project-a');
  expect(child.require(tx, 'project-a', 'task.read').spaceId).toBe('company');
  expect(child.space(tx, 'project-a')).toBe('company');
  expect(child.scope(tx, 'project-a')).toBe('project-a');
  expect(child.has(tx, 'project-b', 'task.read')).toBe(false);
  expect(() => child.space(tx, 'project-b')).toThrow();
  expect(child.has(tx, 'company', 'task.read', undefined, 'project-b')).toBe(
    false,
  );
  expect(child.has(tx, 'company', 'task.read', undefined, 'company')).toBe(
    false,
  );
  expect(all.require(tx, 'company', 'task.read').scopeId).toBe('company');
});

it('bounds a derived scope authority to its transaction and parent lifetime', () => {
  const parent = new SharedAuthority(tx, [proof('project-a')]);
  const child = parent.forScope(tx, 'company', 'project-a');
  expect(() =>
    child.require({} as Prisma.TransactionClient, 'company', 'task.read'),
  ).toThrow();
  parent.close();
  expect(() => child.require(tx, 'company', 'task.read')).toThrow();
  expect(() => parent.forScope(tx, 'company', 'project-a')).toThrow();
});
