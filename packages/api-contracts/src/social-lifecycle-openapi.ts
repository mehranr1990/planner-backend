import * as c from './social-lifecycle.js';
import { socialPathBuilder } from './social-activities-openapi.js';
/** P6-06 Social Group deletion, 30-day recovery and departure check (ADR 0066). */
export function socialLifecyclePaths(): Record<
  string,
  Record<string, unknown>
> {
  const paths: Record<string, Record<string, unknown>> = {};
  const add = socialPathBuilder(
    paths,
    'socialGroupLifecycle',
    {},
    {
      success:
        'Authorized P6-06 result; recovery restores only the primary Owner seat',
      absent:
        'Safe absence; departed, revoked and non-members cannot distinguish deleted Groups',
    },
  );
  const group = '/social-groups/{id}',
    edit = { revision: true, etag: true };
  add(group + '/exit-check', 'get', c.SocialGroupExitCheckSchema);
  add(
    group + '/delete',
    'post',
    c.SocialGroupLifecycleChangeSchema,
    c.SocialGroupDeleteSchema,
    edit,
  );
  add(
    group + '/lifecycle-job',
    'get',
    c.SocialGroupLifecycleJobSchema,
    undefined,
    {
      etag: true,
    },
  );
  add(
    group + '/lifecycle-job/recovery-proof',
    'post',
    c.SocialGroupLifecycleProofSchema,
    c.SocialGroupLifecyclePasswordSchema,
    edit,
  );
  add(
    group + '/lifecycle-job/recover',
    'post',
    c.SocialGroupLifecycleRecoverySchema,
    c.SocialGroupLifecycleRecoverSchema,
    edit,
  );
  const recover = paths['/api/v1' + group + '/lifecycle-job/recover']!.post as {
    parameters: unknown[];
  };
  recover.parameters.push({
    in: 'header',
    name: 'X-Deletion-Recovery',
    required: true,
    schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$', maxLength: 43 },
  });
  return paths;
}
