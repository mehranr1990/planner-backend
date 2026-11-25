import { z } from 'zod';
import { teamCompletionPaths } from './team-completion-openapi.js';
import {
  InvitationNotificationQuerySchema,
  InvitationNotificationPageSchema,
  InvitationFeedFields,
} from './client-invitations.js';
export function clientInvitationPaths() {
  const paths = teamCompletionPaths(
    [
      {
        path: '/invitation-notifications',
        method: 'get',
        query: InvitationNotificationQuerySchema,
        output: InvitationNotificationPageSchema,
      },
      {
        path: '/invitation-notifications/{kind}/{id}/read',
        method: 'post',
        input: z.strictObject({}),
        output: z.strictObject({
          invitationId: z.uuid(),
          readAt: z.iso.datetime(),
        }),
        status: 200,
      },
    ],
    {
      prefix: 'clientInvitations',
      tag: 'invitations',
      description:
        'Verified recipient invitation notifications; resolved offers leave the pending feed',
    },
  );
  const operation = paths['/api/v1/invitation-notifications/{kind}/{id}/read']
    ?.post as { parameters?: { name: string; schema: unknown }[] } | undefined;
  const kind = operation?.parameters?.find((p) => p.name === 'kind');
  if (kind) kind.schema = z.toJSONSchema(InvitationFeedFields.kind);
  return paths;
}
