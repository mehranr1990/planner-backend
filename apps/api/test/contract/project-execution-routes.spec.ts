import 'reflect-metadata';
import { it, expect } from 'vitest';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { ProjectExecutionController } from '../../src/modules/projects/http/project-execution.controller.js';
import { projectExecutionPaths } from '../../../../packages/api-contracts/src/project-execution-openapi.js';
it('matches all P2-06 OpenAPI operations to actual guarded Nest handlers', () => {
  const actual: string[] = [];
  for (const name of Object.getOwnPropertyNames(
    ProjectExecutionController.prototype,
  )) {
    const handler = Object.getOwnPropertyDescriptor(
      ProjectExecutionController.prototype,
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
          String(
            Reflect.getMetadata(PATH_METADATA, ProjectExecutionController),
          ) +
          '/' +
          String(Reflect.getMetadata(PATH_METADATA, handler))
        ).replace(/:([A-Za-z]+)/g, '{$1}'),
    );
  }
  const expected = Object.entries(projectExecutionPaths()).flatMap(
    ([path, ops]) => Object.keys(ops).map((method) => method + ' ' + path),
  );
  expect(actual.sort()).toEqual(expected.sort());
  expect(actual).toHaveLength(35);
});
