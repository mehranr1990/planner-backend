import * as c from './social-goals.js';
import { SocialEmptySchema } from './social.js';
import { socialPathBuilder } from './social-activities-openapi.js';
const actions: Record<string, string[]> = {
  '/social-goals/{id}/actions/{action}': [...c.SocialGoalActionSchema.options],
  '/entries/{entryId}/actions/{action}': [
    ...c.SocialGoalEntryActionSchema.options,
  ],
};
/** P6-05 Social Goals and Challenges operations (no album operations). */
export function socialGoalPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  const add = socialPathBuilder(paths, 'socialGoals', actions, {
    success:
      'Authorized P6-05 result; progress is self-reported Social data, never ranked, verified or rewarded',
    absent:
      'Safe absence; goals, participants and entries outside the caller’s current Group or Activity are indistinguishable',
  });
  const empty = SocialEmptySchema,
    write = { key: true, etag: true },
    edit = { key: true, revision: true, etag: true },
    uuid = { type: 'string', format: 'uuid' },
    goal = '/social-goals/{id}',
    entry = goal + '/entries/{entryId}';
  add('/social-goals', 'get', c.SocialGoalPageSchema, undefined, {
    page: true,
    query: {
      groupId: uuid,
      activityId: uuid,
      kind: { type: 'string', enum: [...c.SocialGoalKindSchema.options] },
      state: { type: 'string', enum: [...c.SocialGoalStateSchema.options] },
      participation: { type: 'string', enum: ['ANY', 'JOINED', 'NOT_JOINED'] },
    },
  });
  add(
    '/social-goals',
    'post',
    c.SocialGoalSchema,
    c.SocialGoalCreateSchema,
    write,
  );
  add(goal, 'get', c.SocialGoalSchema, undefined, { etag: true });
  add(goal, 'patch', c.SocialGoalSchema, c.SocialGoalPatchSchema, edit);
  add(goal + '/actions/{action}', 'post', c.SocialGoalSchema, empty, edit);
  add(goal + '/join', 'post', c.SocialGoalParticipantSchema, empty, write);
  add(goal + '/withdraw', 'post', c.SocialGoalParticipantSchema, empty, edit);
  add(
    goal + '/participants',
    'get',
    c.SocialGoalParticipantPageSchema,
    undefined,
    { page: true },
  );
  add(goal + '/entries', 'get', c.SocialGoalEntryPageSchema, undefined, {
    page: true,
    query: {
      state: {
        type: 'string',
        enum: [...c.SocialGoalEntryStateSchema.options],
      },
      participantId: uuid,
    },
  });
  add(
    goal + '/entries',
    'post',
    c.SocialGoalEntrySchema,
    c.SocialGoalEntryCreateSchema,
    write,
  );
  add(
    entry + '/actions/{action}',
    'post',
    c.SocialGoalEntrySchema,
    c.SocialGoalEntryDecisionSchema,
    edit,
  );
  add(
    goal + '/corrections',
    'post',
    c.SocialGoalEntrySchema,
    c.SocialGoalCorrectionCreateSchema,
    edit,
  );
  add(goal + '/history', 'get', c.SocialGoalHistorySchema);
  return paths;
}
