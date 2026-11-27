import fs from 'node:fs';
import { format } from 'prettier';
import * as c from '../../packages/api-contracts/dist/index.js';
import { createOpenApiDocument } from '../../packages/api-contracts/dist/openapi.js';
import { adminRolePermissions } from '../../apps/api/src/platform/admin/admin-policy.ts';

const names = [
  'Authentication and RBAC',
  'Dashboard',
  'Users',
  'Workspaces',
  'Memberships',
  'Security',
  'Audit',
  'Privacy and retention',
  'Health',
  'Jobs',
  'Storage',
  'Backup and restore',
  'Communications',
  'Support',
  'Moderation',
  'Plans',
  'Subscriptions',
  'Billing',
  'Feature flags',
  'Product configuration',
  'Platform settings and maintenance',
  'Product analytics',
];
function modules(path: string): number[] {
  const p = path.slice('/api/v1/admin/'.length);
  if (p === 'session' || p.startsWith('auth/')) return [1];
  if (p.startsWith('system-emails')) return [13];
  if (p.startsWith('dashboard')) return [2];
  if (p.startsWith('users/')) return [p.includes('memberships') ? 5 : 3];
  if (p === 'users' || p.startsWith('bulk/')) return [3];
  if (p.startsWith('workspaces/'))
    return [/memberships|invitations/.test(p) ? 5 : 4];
  if (p === 'workspaces') return [4];
  if (p.startsWith('security/')) return [6];
  if (p.startsWith('audit')) return [7];
  if (p.startsWith('privacy/')) return [8];
  if (p.startsWith('operations/')) {
    if (/^operations\/(jobs|job-controls)/.test(p)) return [10];
    if (p.startsWith('operations/storage')) return [11];
    if (/^operations\/(backups|restores)/.test(p)) return [12];
    if (p.startsWith('operations/policies')) return [9, 10, 11, 12];
    return [9];
  }
  if (p.startsWith('communications')) return [13];
  if (p.startsWith('support/')) return [14];
  if (p.startsWith('moderation/')) return [15];
  if (p.startsWith('engagement/')) return [13, 14, 15];
  if (p.startsWith('commerce/')) {
    if (/^commerce\/(features|products|prices|policy)/.test(p)) return [16];
    if (/subscriptions|terms|entitlements|overrides|history/.test(p))
      return [17];
    if (p === 'commerce/customers') return [17];
    return [18];
  }
  if (p.startsWith('configuration/')) {
    if (/reopen|readiness/.test(p)) return [21];
    return [19, 20, 21];
  }
  if (p.startsWith('analytics/')) return [22];
  throw Error('Unmapped Admin operation: ' + path);
}
export function buildAdminIntegrationReference() {
  const registry = {
    ...c.adminManagementRoutes,
    ...c.adminSecurityRoutes,
    ...c.adminAuditRoutes,
    ...c.adminUserSecurityRoutes,
    ...c.adminRetentionRoutes,
    ...c.adminPrivacyRoutes,
    ...c.adminOperationsRoutes,
    ...c.adminEngagementRoutes,
    ...c.adminCommerceRoutes,
    ...c.adminConfigurationRoutes,
    ...c.adminAnalyticsRoutes,
  };
  const permissions = new Map(
    Object.entries(registry).map(([route, spec]) => {
      const [method, suffix] = route.split(' ') as [string, string];
      return [
        method + ' /api/v1/admin/' + suffix.replaceAll(':id', '{id}'),
        spec.permission,
      ];
    }),
  );
  permissions.set('GET /api/v1/admin/session', 'admin.session.read');
  const roles = Object.fromEntries(
    Object.entries(adminRolePermissions).map(([role, values]) => [
      role,
      [...new Set(values)].sort(),
    ]),
  );
  const operations = Object.entries(createOpenApiDocument().paths)
    .filter(([path]) => path.startsWith('/api/v1/admin/'))
    .flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, raw]) => {
        const op = raw as { operationId: string };
        const key = method.toUpperCase() + ' ' + path;
        const permission = permissions.get(key) ?? null;
        if (!permission && !path.startsWith('/api/v1/admin/auth/'))
          throw Error('Missing permission mapping: ' + key);
        return {
          method: method.toUpperCase(),
          path,
          operationId: op.operationId,
          modules: modules(path),
          permission,
          roles: permission
            ? Object.keys(roles).filter((r) => roles[r]!.includes(permission))
            : [],
          authority: permission
            ? 'Capability plus current session and target-specific checks'
            : 'Allowlisted authentication state machine; enrollment/session operations require the corresponding Admin session',
        };
      }),
    )
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
    );
  for (const key of permissions.keys())
    if (!operations.some((o) => o.method + ' ' + o.path === key))
      throw Error('Route absent from OpenAPI: ' + key);
  return {
    modules: names.map((name, i) => ({
      number: i + 1,
      name,
      operationIds: operations
        .filter((o) => o.modules.includes(i + 1))
        .map((o) => o.operationId),
    })),
    roles,
    operations,
  };
}
export async function adminIntegrationMarkdown() {
  const reference = buildAdminIntegrationReference();
  const lines = [
    '# Generated Platform Admin API reference',
    '',
    'Generated from current OpenAPI, route registries and the server role policy.',
    'Regenerate: `node tooling/scripts/admin-integration-reference.ts --write` after the contracts build.',
    'Check: replace `--write` with `--check`. This is a backend handoff artifact, not frontend source.',
    '',
    `${reference.operations.length} distinct Admin operations; shared operations appear under each applicable module.`,
    'Request, query, response, enum and error schemas are in [OpenAPI](openapi.json).',
    'Roles below express capability eligibility. Recent MFA, current target authority, extra sensitive/export rights, approval separation and transaction rechecks still apply.',
    '',
    'Auth rows use the allowlisted authentication state machine; an empty capability does not mean unrestricted access.',
    '',
  ];
  for (const module of reference.modules) {
    lines.push(
      `## ${String(module.number).padStart(2, '0')} ${module.name}`,
      '',
      '| Method / path | Operation ID | Capability | Eligible roles |',
      '| --- | --- | --- | --- |',
    );
    for (const op of reference.operations.filter((o) =>
      o.modules.includes(module.number),
    ))
      lines.push(
        `| ${op.method} ${op.path} | ${op.operationId} | ${op.permission ?? 'Auth state machine'} | ${op.roles.join(', ') || 'See auth requirements'} |`,
      );
    lines.push('');
  }
  lines.push('## Exact role capability sets', '');
  for (const [role, values] of Object.entries(reference.roles))
    lines.push(
      `### ${role}`,
      '',
      values.map((p) => '`' + p + '`').join(', ') + '.',
      '',
    );
  return format(lines.join('\n'), { parser: 'markdown' });
}
if (process.argv.includes('--write') || process.argv.includes('--check')) {
  const file = 'docs/frontend-handoff/PLATFORM_ADMIN_API_REFERENCE.md';
  const output = await adminIntegrationMarkdown();
  if (process.argv.includes('--write')) fs.writeFileSync(file, output);
  else if (fs.readFileSync(file, 'utf8') !== output)
    throw Error('Admin handoff reference is stale');
  process.stdout.write(
    'Admin API handoff matches ' +
      buildAdminIntegrationReference().operations.length +
      ' operations across all 22 modules.\n',
  );
}
