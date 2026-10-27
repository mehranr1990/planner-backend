import fs from 'node:fs';

const root = 'apps/api/src/modules';
const owners = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
export default {
  forbidden: [
    { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'no-unresolved',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'transport-has-no-server-dependencies',
      severity: 'error',
      from: { path: '^packages/api-contracts/' },
      to: {
        path: '^apps/|node_modules/(?:@nestjs|@prisma|pg|better-auth)(?:/|$)',
      },
    },
    {
      name: 'pure-domain',
      severity: 'error',
      from: { path: '/domain/' },
      to: {
        path: 'node_modules/(?:@nestjs|@prisma|pg|better-auth|nestjs-pino|pino|pino-http|zod)(?:/|$)|/generated/|/(?:http|application|infrastructure|platform|bootstrap)/|^packages/',
      },
    },
    {
      name: 'application-cannot-import-http-or-infrastructure',
      severity: 'error',
      from: { path: '/application/' },
      to: {
        path: '/(?:http|infrastructure)/|node_modules/(?:@prisma|pg)(?:/|$)',
      },
    },
    {
      name: 'http-cannot-access-persistence',
      severity: 'error',
      from: { path: '/http/' },
      to: {
        path: '/infrastructure/|/platform/database/|node_modules/(?:@prisma|pg)(?:/|$)',
      },
    },
    {
      name: 'controllers-cannot-import-orm',
      severity: 'error',
      from: { path: '\\.controller\\.ts$' },
      to: { path: '/generated/|node_modules/(?:@prisma|pg)(?:/|$)' },
    },
    {
      name: 'platform-cannot-import-business-modules',
      severity: 'error',
      from: { path: '/platform/' },
      to: { path: '^apps/api/src/modules/' },
    },
    ...owners.map((owner) => ({
      name: `only-${owner}-public-contract`,
      severity: 'error',
      from: { path: '^apps/api/src/', pathNot: `^${root}/${owner}/` },
      to: { path: `^${root}/${owner}/`, pathNot: `^${root}/${owner}/public/` },
    })),
  ],
  options: {
    doNotFollow: { path: 'node_modules|/generated/' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'node', 'default'],
    },
    exclude: { path: '\\.spec\\.ts$' },
  },
};
