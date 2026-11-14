import { gapClosureOperations } from '../../../../packages/api-contracts/src/gap-closure-openapi.js';
import { finalClosureOperations } from '../../../../packages/api-contracts/src/final-closure-openapi.js';
import { TaskProductivityController } from '../../src/modules/tasks/http/productivity.controller.js';
import { TeamWorkToolsController } from '../../src/modules/teams/http/team-work-tools.controller.js';
import { MessagingExtensionsController } from '../../src/modules/messaging/http/messaging-extensions.controller.js';
import { MeetingExtensionsController } from '../../src/modules/meetings/http/meeting-extensions.controller.js';
import {
  CompanyGapContextController,
  CompanyGapController,
} from '../../src/modules/companies/http/company-gap.controller.js';
import { BrainDumpController } from '../../src/modules/capture/http/brain-dump.controller.js';
import { InsightPatternsController } from '../../src/modules/insights/http/insight-patterns.controller.js';
import { teamFileOperations } from '../../../../packages/api-contracts/src/team-files-openapi.js';
import { TeamFilesController } from '../../src/modules/teams/http/team-files.controller.js';
import 'reflect-metadata';
import { expect, it } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { backendCompletionOperations } from '../../../../packages/api-contracts/src/backend-completion-openapi.js';
import { TeamOperationsController } from '../../src/modules/teams/http/team-operations.controller.js';
import { TeamInvitationProofController } from '../../src/modules/teams/http/teams.controller.js';
import { CompanySettingsController } from '../../src/modules/companies/http/company-completion.controller.js';
import { CompanyFinanceRequestsController } from '../../src/modules/companies/http/company-finance-requests.controller.js';
import { CompanyInvitationProofController } from '../../src/modules/companies/http/companies.controller.js';
import { RetentionController } from '../../src/modules/spaces/http/retention.controller.js';
import {
  InvitationProofController,
  ProjectInvitationListController,
} from '../../src/modules/spaces/http/collaboration.controller.js';

function routes(controllers: (abstract new (...args: never[]) => unknown)[]) {
  const actual: string[] = [];
  for (const controller of controllers)
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = Object.getOwnPropertyDescriptor(
        controller.prototype,
        name,
      )?.value as object | undefined;
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
        .replace(/\/+/g, '/')
        .replace(/\/$/, '')
        .replace(/:([A-Za-z]+)/g, '{$1}');
      actual.push(RequestMethod[method]!.toLowerCase() + ' ' + path);
    }
  return actual;
}

it('maps each of the 50 backend completion operations to exactly one compiled handler', () => {
  const expected = backendCompletionOperations.map(
    (op) => op.method + ' /api/v1' + op.path,
  );
  const dedicated = routes([
    TeamOperationsController,
    TeamInvitationProofController,
    CompanyFinanceRequestsController,
    CompanyInvitationProofController,
    RetentionController,
    ProjectInvitationListController,
    InvitationProofController,
  ]);
  const settings = routes([CompanySettingsController]).filter((r) =>
    r.endsWith('/settings/legal'),
  );
  const actual = [...dedicated, ...settings];
  expect(actual.sort()).toEqual([...expected].sort());
  expect(new Set(actual).size).toBe(50);
});

it('maps each of the 13 TM-11 Team file operations to exactly one compiled handler', () => {
  const expected = teamFileOperations.map(
    (op) => op.method + ' /api/v1' + op.path,
  );
  const actual = routes([TeamFilesController]);
  expect(actual.sort()).toEqual([...expected].sort());
});

it('maps each of the 5 final-closure operations to exactly one compiled handler', () => {
  const expected = finalClosureOperations.map(
    (op) => op.method + ' /api/v1' + op.path,
  );
  const actual = routes([
    CompanyGapController,
    CompanyGapContextController,
    TaskProductivityController,
  ]);
  for (const route of expected)
    expect(actual.filter((r) => r === route)).toHaveLength(1);
  expect(expected).toHaveLength(5);
});

it('maps each of the 67 gap-closure operations to exactly one compiled handler', () => {
  const expected = [...gapClosureOperations, ...finalClosureOperations]
    .filter((op) => !op.path.startsWith('/tasks/'))
    .map((op) => op.method + ' /api/v1' + op.path);
  const actual = routes([
    TeamWorkToolsController,
    MessagingExtensionsController,
    MeetingExtensionsController,
    CompanyGapContextController,
    CompanyGapController,
    BrainDumpController,
    InsightPatternsController,
  ]);
  expect(actual.sort()).toEqual([...expected].sort());
});
