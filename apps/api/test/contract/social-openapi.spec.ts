import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { SocialController } from '../../src/modules/social/http/social.controller.js';
import {
  SocialGroupsController,
  SocialGroupInvitationsController,
} from '../../src/modules/social/http/groups.controller.js';
import { socialPaths } from '../../../../packages/api-contracts/src/social-openapi.js';
describe('P6-01 implemented OpenAPI operation parity', () => {
  it('documents exactly registered Social routes with no invented future operations', () => {
    const actual: string[] = [];
    for (const controller of [
      SocialController,
      SocialGroupsController,
      SocialGroupInvitationsController,
    ]) {
      const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string;
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        if (name === 'constructor') continue;
        const handler = (
          controller.prototype as unknown as Record<string, unknown>
        )[name];
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        if (method === undefined) continue;
        const suffix = Reflect.getMetadata(PATH_METADATA, handler) as string;
        const route = (
          '/api/v1/' +
          prefix +
          '/' +
          (suffix === '/' ? '' : suffix)
        )
          .replace(/\/$/, '')
          .replace(/:(\w+)/g, '{$1}');
        actual.push(RequestMethod[method]!.toLowerCase() + ' ' + route);
      }
    }
    const documented = Object.entries(socialPaths()).flatMap(([path, verbs]) =>
      Object.keys(verbs).map((verb) => verb + ' ' + path),
    );
    expect(actual.sort()).toEqual(documented.sort());
  });
});
