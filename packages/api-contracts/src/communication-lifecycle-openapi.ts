import {
  MessageRecoveryPageSchema,
  DmContactBlockSchema,
  DmContactInputSchema,
  DmContactPageSchema,
  DmContactReplaySchema,
} from './communication-lifecycle.js';
import {
  ConversationPageQuerySchema,
  ConversationEmptySchema,
  ConversationMemberSchema,
} from './messaging.js';
import { MeetingMemberSchema } from './meetings.js';
import {
  messagingOperationPaths,
  type Operation,
} from './messaging-openapi.js';
import * as l from './project-lifecycle.js';
export const communicationLifecycleOperations: Operation[] = [
  {
    path: '/conversations/{id}/recovery',
    method: 'get',
    query: ConversationPageQuerySchema,
    output: MessageRecoveryPageSchema,
  },
  {
    path: '/conversations/{id}/restore-admission',
    method: 'post',
    input: ConversationEmptySchema,
    output: ConversationMemberSchema,
    revision: true,
    key: true,
    etag: true,
  },
  {
    path: '/meetings/{id}/restore-admission',
    method: 'post',
    input: ConversationEmptySchema,
    output: MeetingMemberSchema,
    revision: true,
    key: true,
  },
  {
    path: '/conversations/{id}/contact-block',
    method: 'get',
    output: DmContactBlockSchema,
    etag: true,
  },
  {
    path: '/messaging/blocks',
    method: 'get',
    query: ConversationPageQuerySchema,
    output: DmContactPageSchema,
  },
  {
    path: '/messaging/blocks',
    method: 'post',
    input: DmContactInputSchema,
    output: DmContactBlockSchema,
    key: true,
    revision: true,
    etag: true,
  },
  {
    path: '/messaging/blocks/replay',
    method: 'post',
    input: ConversationEmptySchema,
    output: DmContactReplaySchema,
  },
  ...['conversations', 'meetings'].flatMap((name): Operation[] => [
    {
      path: `/${name}/{projectId}/lifecycle-job`,
      method: 'get',
      output: l.ProjectLifecycleJobSchema,
      etag: true,
    },
    {
      path: `/${name}/{projectId}/lifecycle-job/recovery-proof`,
      method: 'post',
      input: l.ProjectLifecyclePasswordSchema,
      output: l.ProjectLifecycleProofSchema,
      revision: true,
      etag: true,
      status200: true,
    },
    {
      path: `/${name}/{projectId}/lifecycle-job/recover`,
      method: 'post',
      input: l.ProjectLifecycleRecoverSchema,
      output: l.ProjectLifecycleRecoverySchema,
      revision: true,
      etag: true,
      status200: true,
      recovery: true,
    },
  ]),
];
export function communicationLifecyclePaths() {
  const paths = messagingOperationPaths(communicationLifecycleOperations);
  for (const path of Object.values(paths))
    for (const op of Object.values(path)) {
      const operation = op as { responses: Record<string, unknown> };
      const response = operation.responses['429'] as { headers?: unknown };
      response.headers = {
        'Retry-After': { schema: { type: 'string', const: '60' } },
      };
    }
  return paths;
}
