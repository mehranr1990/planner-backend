import 'reflect-metadata';
import { it, expect } from 'vitest';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { CompanyLifecycleController } from '../../src/modules/companies/http/company-lifecycle.controller.js';
import { companyLifecyclePaths } from '../../../../packages/api-contracts/src/company-lifecycle-openapi.js';
it('matches every exported Company lifecycle operation to an actual compiled controller handler', () => {
  const actual: string[] = [];
  for (const controller of [CompanyLifecycleController])
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
  const expected = Object.entries(companyLifecyclePaths()).flatMap(
    ([path, ops]) => Object.keys(ops).map((method) => method + ' ' + path),
  );
  expect(actual.sort()).toEqual(expected.sort());
  expect(actual).toHaveLength(12);
});
