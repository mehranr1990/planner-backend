import 'reflect-metadata';
import { it, expect } from 'vitest';
import {
  METHOD_METADATA,
  PATH_METADATA,
  GUARDS_METADATA,
} from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import {
  ProjectsController,
  ResourceInvitationController,
  ProjectGuard,
} from '../../src/modules/projects/http/projects.controller.js';
import { VerifiedSessionGuard } from '../../src/platform/auth/session.guard.js';
import { projectPaths } from '../../../../packages/api-contracts/src/projects-openapi.js';
import { executableProjectAssociation } from '../../src/modules/projects/public/index.js';
import { ProjectOverviewController } from '../../src/modules/projects/http/project-overview.controller.js';
it('retains session verification and Shared activation guards on all overview routes', () => {
  expect(
    Reflect.getMetadata(GUARDS_METADATA, ProjectOverviewController),
  ).toEqual([VerifiedSessionGuard, ProjectGuard]);
});
it('matches every exported Project operation to an actual compiled controller handler', () => {
  const actual: string[] = [];
  for (const controller of [
    ProjectsController,
    ResourceInvitationController,
    ProjectOverviewController,
  ])
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = Object.getOwnPropertyDescriptor(
        controller.prototype,
        name,
      )?.value as object | undefined;
      if (typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as
        number | undefined;
      if (method === undefined) continue;
      const path =
        '/api/v1/' +
        String(Reflect.getMetadata(PATH_METADATA, controller)) +
        '/' +
        String(Reflect.getMetadata(PATH_METADATA, handler));
      actual.push(
        RequestMethod[method]!.toLowerCase() +
          ' ' +
          path.replace(/\/+$/, '').replace(/:([A-Za-z]+)/g, '{$1}'),
      );
    }
  const expected = Object.entries(projectPaths()).flatMap(([path, ops]) =>
    Object.keys(ops).map((method) => method + ' ' + path),
  );
  expect(actual.sort()).toEqual(expected.sort());
  expect(actual).toHaveLength(44);
});
it('leaves future Team/Company association intents non-executable', () => {
  expect(executableProjectAssociation({ kind: 'INDEPENDENT' })).toBe(true);
  expect(executableProjectAssociation({ kind: 'TEAM', teamId: 'future' })).toBe(
    false,
  );
  expect(
    executableProjectAssociation({
      kind: 'COMPANY',
      companyId: 'future',
      scopeId: 'future',
    }),
  ).toBe(false);
});
