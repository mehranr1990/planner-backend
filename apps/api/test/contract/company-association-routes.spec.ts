import 'reflect-metadata';
import { it, expect } from 'vitest';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { CompanyAssociationsController } from '../../src/modules/companies/http/company-associations.controller.js';
import { companyAssociationPaths } from '../../../../packages/api-contracts/src/company-associations-openapi.js';
it('matches every exported Company association operation to an actual compiled controller handler', () => {
  const actual: string[] = [];
  for (const controller of [CompanyAssociationsController])
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
  const expected = Object.entries(companyAssociationPaths()).flatMap(
    ([path, ops]) => Object.keys(ops).map((method) => method + ' ' + path),
  );
  expect(actual.sort()).toEqual(expected.sort());
  expect(actual).toHaveLength(8);
});
