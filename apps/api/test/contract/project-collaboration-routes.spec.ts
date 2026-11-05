import 'reflect-metadata';
import { it, expect } from 'vitest';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { ProjectCollaborationController } from '../../src/modules/projects/http/project-collaboration.controller.js';
import { ProjectTransferController } from '../../src/modules/projects/http/project-transfer.controller.js';
import { ProjectLifecycleController } from '../../src/modules/projects/http/project-lifecycle.controller.js';
import { projectCollaborationPaths } from '../../../../packages/api-contracts/src/project-collaboration-openapi.js';
it('matches every P2-07 guarded route and documents binary, CSV and proof contracts', () => {
  const actual: string[] = [];
  for (const controller of [
    ProjectCollaborationController,
    ProjectTransferController,
    ProjectLifecycleController,
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
      const route = (
        '/api/v1/' +
        String(Reflect.getMetadata(PATH_METADATA, controller)) +
        '/' +
        String(Reflect.getMetadata(PATH_METADATA, handler))
      )
        .replace(/\/+$/, '')
        .replace(/:([A-Za-z]+)/g, '{$1}');
      actual.push(RequestMethod[method]!.toLowerCase() + ' ' + route);
    }
  const paths = projectCollaborationPaths();
  const expected = Object.entries(paths).flatMap(([route, ops]) =>
    Object.keys(ops).map((method) => method + ' ' + route),
  );
  expect(actual.sort()).toEqual(expected.sort());
  expect(actual).toHaveLength(30);
  const serialized = JSON.stringify(paths);
  for (const required of [
    'application/octet-stream',
    'text/csv',
    'X-Deletion-Recovery',
    'If-Match',
    'Idempotency-Key',
  ])
    expect(serialized).toContain(required);
});
