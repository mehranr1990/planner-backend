import 'reflect-metadata';
import { it, expect } from 'vitest';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { ProjectToolsController } from '../../src/modules/projects/http/project-tools.controller.js';
import { projectToolPaths } from '../../../../packages/api-contracts/src/project-tools-openapi.js';
it('matches every P2-05 OpenAPI operation to a real guarded Nest handler', () => {
  const actual: string[] = [];
  for (const name of Object.getOwnPropertyNames(
    ProjectToolsController.prototype,
  )) {
    const handler = Object.getOwnPropertyDescriptor(
      ProjectToolsController.prototype,
      name,
    )?.value as object | undefined;
    if (typeof handler !== 'function') continue;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as
      number | undefined;
    if (method === undefined) continue;
    actual.push(
      RequestMethod[method]!.toLowerCase() +
        ' ' +
        (
          '/api/v1/' +
          String(Reflect.getMetadata(PATH_METADATA, ProjectToolsController)) +
          '/' +
          String(Reflect.getMetadata(PATH_METADATA, handler))
        ).replace(/:([A-Za-z]+)/g, '{$1}'),
    );
  }
  const expected = Object.entries(projectToolPaths()).flatMap(([p, ops]) =>
    Object.keys(ops).map((m) => m + ' ' + p),
  );
  expect(actual.sort()).toEqual(expected.sort());
  expect(actual).toHaveLength(26);
});
