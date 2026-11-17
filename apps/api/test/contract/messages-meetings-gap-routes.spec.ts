import 'reflect-metadata';
import { it, expect } from 'vitest';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { MessagesMeetingsGapController } from '../../src/modules/meetings/http/messages-meetings-gap.controller.js';
import { messagesMeetingsGapPaths } from '../../../../packages/api-contracts/src/messages-meetings-gap-openapi.js';
it('matches all eight additive Messages/Meetings handlers to generated contracts', () => {
  const actual: string[] = [];
  for (const name of Object.getOwnPropertyNames(
    MessagesMeetingsGapController.prototype,
  )) {
    const fn = Object.getOwnPropertyDescriptor(
      MessagesMeetingsGapController.prototype,
      name,
    )?.value as object | undefined;
    if (typeof fn !== 'function') continue;
    const method = Reflect.getMetadata(METHOD_METADATA, fn) as
      number | undefined;
    if (method === undefined) continue;
    actual.push(
      RequestMethod[method]!.toLowerCase() +
        ' /api/v1/' +
        String(Reflect.getMetadata(PATH_METADATA, fn)).replace(
          /:([A-Za-z]+)/g,
          '{$1}',
        ),
    );
  }
  const expected = Object.entries(messagesMeetingsGapPaths()).flatMap(
    ([path, ops]) => Object.keys(ops).map((method) => method + ' ' + path),
  );
  expect(actual.sort()).toEqual(expected.sort());
  expect(actual).toHaveLength(8);
});
