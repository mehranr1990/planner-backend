import { z } from 'zod';
import { AnalyticsNavigationSchema } from './admin-analytics.js';
import { teamCompletionPaths } from './team-completion-openapi.js';
export function analyticsPaths() {
  return teamCompletionPaths(
    [
      {
        path: '/analytics/navigation',
        method: 'post',
        input: AnalyticsNavigationSchema,
        output: z.strictObject({ accepted: z.literal(true) }),
        status: 200,
      },
    ],
    {
      prefix: 'productAnalytics',
      tag: 'product-analytics',
      description:
        'Authenticated allowlisted navigation metadata only. Current Workspace authorization, collection policy and privacy fences apply. Navigation never counts toward meaningful activity.',
    },
  );
}
