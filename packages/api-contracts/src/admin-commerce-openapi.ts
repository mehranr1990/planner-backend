import {
  ordinaryCommerceRoutes,
  publicCommerceRoutes,
} from './admin-commerce.js';
import { teamCompletionPaths } from './team-completion-openapi.js';
export function commercePaths() {
  const paths = teamCompletionPaths(
    Object.entries({ ...ordinaryCommerceRoutes, ...publicCommerceRoutes }).map(
      ([route, spec]) => {
        const [method, path] = route.split(' ');
        return {
          path: '/' + path!.replace(':id', '{id}'),
          method: method!.toLowerCase() as 'get' | 'post',
          ...(method === 'GET'
            ? { query: spec.schema }
            : { input: spec.schema }),
          output: spec.response,
          idempotency: method !== 'GET',
          status: 200,
        };
      },
    ),
    {
      prefix: 'commerce',
      tag: 'commercial-account',
      description:
        'Scope-authorized commercial entitlements and financial history. No automatic charging. Customer cancellation retains paid access. Financial amounts require owner or explicit financial authority.',
    },
  );
  const publicPath = paths['/api/v1/commerce/catalog'];
  if (publicPath?.get)
    (publicPath.get as { security: unknown[] }).security = [];
  return paths;
}
