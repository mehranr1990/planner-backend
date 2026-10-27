import fs from 'node:fs';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const owners = fs
  .readdirSync('apps/api/src/modules', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/generated/**',
      '.tools/**',
      'coverage/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: process.cwd() },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.type="MemberExpression"][callee.property.name="forwardRef"]',
          message: 'Resolve module boundaries instead of forwardRef.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@nestjs/common',
              importNames: ['forwardRef'],
              message: 'Resolve module ownership; forwardRef is prohibited.',
            },
          ],
        },
      ],
    },
  },
  ...owners.map((owner) => ({
    files: [`apps/api/src/modules/${owner}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@nestjs/common',
              importNames: ['forwardRef'],
              message: 'forwardRef is prohibited.',
            },
          ],
          patterns: [
            {
              regex: `(?:^|/)modules/(?!${owner}/)[^/]+/(?!public(?:/|$))|^(?:\\.\\./)+(?!${owner}/)(?:${owners.filter((other) => other !== owner).join('|')})/(?!public(?:/|$))`,
              message:
                'Import another module only through its public contract.',
            },
          ],
        },
      ],
    },
  })),
  {
    files: [
      'apps/api/src/**/domain/**/*.ts',
      'packages/api-contracts/src/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@nestjs/*',
                '@prisma/*',
                'pg',
                'better-auth',
                '**/infrastructure/**',
                '**/bootstrap/**',
                '**/platform/**',
              ],
              message:
                'Keep domain and transport schemas independent of server infrastructure.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
