import 'reflect-metadata';
import { it, expect } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import {
  METHOD_METADATA,
  PATH_METADATA,
  GUARDS_METADATA,
} from '@nestjs/common/constants.js';
import { VerifiedSessionGuard } from '../../src/platform/auth/session.guard.js';
import {
  ProjectsController,
  ProjectGuard,
} from '../../src/modules/projects/http/projects.controller.js';
import { WorkController } from '../../src/modules/projects/http/work.controller.js';
import { ProjectToolsController } from '../../src/modules/projects/http/project-tools.controller.js';
import { ProjectExecutionController } from '../../src/modules/projects/http/project-execution.controller.js';
import { ProjectCollaborationController } from '../../src/modules/projects/http/project-collaboration.controller.js';
import {
  SpaceCollaborationController,
  CollaborationGuard,
} from '../../src/modules/spaces/http/collaboration.controller.js';
import { projectGapOperations } from '../../../../packages/api-contracts/src/project-gap-closure-openapi.js';
import { createOpenApiDocument } from '../../../../packages/api-contracts/src/openapi.js';
it('matches all 36 Project gap operations to exactly one real verified, Shared-guarded handler', () => {
  const actual = new Map<string, unknown[]>();
  for (const controller of [
    ProjectsController,
    WorkController,
    ProjectToolsController,
    ProjectExecutionController,
    ProjectCollaborationController,
    SpaceCollaborationController,
  ]) {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      controller,
    ) as unknown[];
    expect(guards).toContain(VerifiedSessionGuard);
    expect(guards).toContain(
      controller === SpaceCollaborationController
        ? CollaborationGuard
        : ProjectGuard,
    );
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = Object.getOwnPropertyDescriptor(
        controller.prototype,
        name,
      )?.value as unknown;
      if (typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as
        number | undefined;
      if (method === undefined) continue;
      const path = (
        '/api/v1/' +
        String(Reflect.getMetadata(PATH_METADATA, controller)) +
        '/' +
        String(Reflect.getMetadata(PATH_METADATA, handler))
      )
        .replace(/\/+$/, '')
        .replace(/:([A-Za-z]+)/g, '{$1}');
      const key = RequestMethod[method]!.toLowerCase() + ' ' + path;
      actual.set(key, [...(actual.get(key) ?? []), handler]);
    }
  }
  const document = createOpenApiDocument();
  expect(projectGapOperations).toHaveLength(36);
  for (const operation of projectGapOperations) {
    const path = '/api/v1' + operation.path,
      key = operation.method + ' ' + path;
    expect(actual.get(key), key).toHaveLength(1);
    expect(
      (document.paths as Record<string, Record<string, unknown>>)[path]?.[
        operation.method
      ],
    ).toBeDefined();
  }
});
