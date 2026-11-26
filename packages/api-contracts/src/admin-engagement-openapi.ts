import { ordinaryEngagementRoutes } from './admin-engagement.js';
import { teamCompletionPaths } from './team-completion-openapi.js';
export function engagementPaths() {
  const paths = teamCompletionPaths(
    Object.entries(ordinaryEngagementRoutes).map(([route, spec]) => {
      const [method, path] = route.split(' ');
      return {
        path: '/' + path!.replace(':id', '{id}'),
        method: method!.toLowerCase() as 'get' | 'post' | 'patch',
        ...(method === 'GET' ? { query: spec.schema } : { input: spec.schema }),
        output: spec.response,
        idempotency: method !== 'GET',
        status: 200,
      };
    }),
    {
      prefix: 'engagement',
      tag: 'support-and-moderation',
      description:
        'Registered-user support, case reports and preference-aware communication inbox. Exact ownership, revision and Idempotency-Key checks apply. Private evidence is streamed with no-store headers.',
    },
  );
  for (const [path, methods] of Object.entries(paths)) {
    if (path.endsWith('/evidence')) {
      const operation = methods.get as
        { responses?: Record<string, { content: unknown }> } | undefined;
      if (operation?.responses?.['200'])
        operation.responses['200'].content = {
          'application/octet-stream': {
            schema: { type: 'string', format: 'binary' },
          },
        };
    }
  }
  return paths;
}
