import {
  ordinaryConfigurationRoutes,
  publicConfigurationRoutes,
} from './admin-configuration.js';
import { teamCompletionPaths } from './team-completion-openapi.js';
export function configurationPaths() {
  const paths = teamCompletionPaths(
    Object.entries({
      ...ordinaryConfigurationRoutes,
      ...publicConfigurationRoutes,
    }).map(([route, spec]) => ({
      path: '/' + route.split(' ')[1]!,
      method: 'get' as const,
      query: spec.schema,
      output: spec.response,
      status: 200,
    })),
    {
      prefix: 'platformConfiguration',
      tag: 'platform-configuration',
      description:
        'Effective configuration is inspection only, with current Workspace authority. It grants no resource permission. Maintenance countdown is advisory; reopening requires authorized readiness.',
    },
  );
  const status = paths['/api/v1/platform/maintenance'];
  if (status?.get) {
    const operation = status.get as {
      security: unknown[];
      responses: Record<string, unknown>;
    };
    operation.security = [];
    operation.responses['503'] = {
      description:
        'Independent maintenance status is unavailable; ordinary traffic fails closed.',
      content: {
        'application/json': {
          schema: {
            $ref: '#/paths/~1api~1v1~1platform~1maintenance/get/responses/200/content/application~1json/schema',
          },
        },
      },
    };
  }
  return paths;
}
