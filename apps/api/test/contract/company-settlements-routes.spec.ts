import 'reflect-metadata';
import { it, expect } from 'vitest';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { CompanySettlementsController } from '../../src/modules/companies/http/company-settlements.controller.js';
import { companySettlementPaths } from '../../../../packages/api-contracts/src/company-settlements-openapi.js';
it('matches all 34 Company staff handlers to published schemas and required auth headers', () => {
  const actual: string[] = [];
  for (const name of Object.getOwnPropertyNames(
    CompanySettlementsController.prototype,
  )) {
    const handler = Object.getOwnPropertyDescriptor(
      CompanySettlementsController.prototype,
      name,
    )?.value as object | undefined;
    if (typeof handler !== 'function') continue;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as
      number | undefined;
    if (method === undefined) continue;
    const path =
      '/api/v1/' +
      String(Reflect.getMetadata(PATH_METADATA, CompanySettlementsController)) +
      '/' +
      String(Reflect.getMetadata(PATH_METADATA, handler));
    actual.push(
      RequestMethod[method]!.toLowerCase() +
        ' ' +
        path.replace(/:(\w+)/g, '{$1}'),
    );
  }
  const paths = companySettlementPaths();
  expect(actual.sort()).toEqual(
    Object.entries(paths)
      .flatMap(([p, ops]) => Object.keys(ops).map((m) => m + ' ' + p))
      .sort(),
  );
  expect(actual).toHaveLength(34);
  for (const ops of Object.values(paths))
    for (const [method, raw] of Object.entries(ops)) {
      const op = raw as {
        security: unknown[];
        parameters: { name: string; required: boolean }[];
      };
      expect(op.security).toEqual([{ sessionCookie: [] }]);
      for (const status of [
        '400',
        '401',
        '403',
        '404',
        '409',
        '413',
        '422',
        '429',
        '500',
        '503',
      ])
        expect(
          (raw as { responses: Record<string, unknown> }).responses[status],
        ).toEqual(
          expect.objectContaining({
            content: expect.objectContaining({
              'application/json': expect.objectContaining({
                schema: { $ref: '#/components/schemas/ApiError' },
              }),
            }),
          }),
        );
      if (method !== 'get')
        expect(op.parameters).toContainEqual(
          expect.objectContaining({ name: 'Origin', required: true }),
        );
    }
});
