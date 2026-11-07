import 'reflect-metadata';
import { it, expect } from 'vitest';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { CompanyStaffController } from '../../src/modules/companies/http/company-staff.controller.js';
import { companyStaffPaths } from '../../../../packages/api-contracts/src/company-staff-openapi.js';
it('matches all 25 Company staff handlers to published schemas and required auth headers', () => {
  const actual: string[] = [];
  for (const name of Object.getOwnPropertyNames(
    CompanyStaffController.prototype,
  )) {
    const handler = Object.getOwnPropertyDescriptor(
      CompanyStaffController.prototype,
      name,
    )?.value as object | undefined;
    if (typeof handler !== 'function') continue;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as
      number | undefined;
    if (method === undefined) continue;
    const path =
      '/api/v1/' +
      String(Reflect.getMetadata(PATH_METADATA, CompanyStaffController)) +
      '/' +
      String(Reflect.getMetadata(PATH_METADATA, handler));
    actual.push(
      RequestMethod[method]!.toLowerCase() +
        ' ' +
        path.replace(/:(\w+)/g, '{$1}'),
    );
  }
  const paths = companyStaffPaths();
  expect(actual.sort()).toEqual(
    Object.entries(paths)
      .flatMap(([p, ops]) => Object.keys(ops).map((m) => m + ' ' + p))
      .sort(),
  );
  expect(actual).toHaveLength(25);
  for (const ops of Object.values(paths))
    for (const [method, raw] of Object.entries(ops)) {
      const op = raw as {
        security: unknown[];
        parameters: { name: string; required: boolean }[];
      };
      expect(op.security).toEqual([{ sessionCookie: [] }]);
      expect(
        (raw as { responses: Record<string, unknown> }).responses,
      ).toHaveProperty('413');
      if (method !== 'get')
        expect(op.parameters).toContainEqual(
          expect.objectContaining({ name: 'Origin', required: true }),
        );
    }
});
