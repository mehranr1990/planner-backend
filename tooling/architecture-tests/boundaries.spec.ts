import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('architecture enforcement regression probes', () => {
  const cwd = process.cwd();
  const write = (dir: string, file: string, content: string) => {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  function check(
    importPath: string,
    options: { from?: string; files?: Record<string, string> } = {},
  ) {
    fs.mkdirSync('.tools', { recursive: true });
    const fixture = fs.mkdtempSync(path.join(cwd, '.tools/architecture-'));
    write(fixture, 'package.json', '{"type":"module"}');
    write(
      fixture,
      'tsconfig.json',
      '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"}}',
    );
    write(
      fixture,
      'apps/api/src/modules/spaces/infrastructure/repository.ts',
      'export const repository = 1;',
    );
    write(
      fixture,
      'apps/api/src/modules/spaces/public/index.ts',
      'export const facade = 1;',
    );
    write(
      fixture,
      options.from ?? 'apps/api/src/modules/account/application/probe.ts',
      `import * as dependency from '${importPath}'; export { dependency };`,
    );
    for (const [file, source] of Object.entries(options.files ?? {}))
      write(fixture, file, source);
    const result = spawnSync(
      process.execPath,
      [
        path.join(
          cwd,
          'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs',
        ),
        'apps/api/src',
        '--config',
        path.join(cwd, 'tooling/architecture-tests/dependency-cruiser.mjs'),
      ],
      { cwd: fixture, encoding: 'utf8' },
    );
    return { status: result.status, output: result.stdout + result.stderr };
  }
  it('fails an intentional import of another module repository', () => {
    const result = check('../../spaces/infrastructure/repository.js');
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain('only-spaces-public-contract');
  });
  it('accepts an import of the owner public facade', () => {
    const result = check('../../spaces/public/index.js');
    expect(result.status, result.output).toBe(0);
  });
  it('fails circular imports inside a module', () => {
    const result = check('./cycle.js', {
      files: {
        'apps/api/src/modules/account/application/cycle.ts':
          "export * from './probe.js';",
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('no-cycles');
  });
  it('prevents HTTP from bypassing application ports to persistence', () => {
    const result = check('../infrastructure/repository.js', {
      from: 'apps/api/src/modules/account/http/probe.ts',
      files: {
        'apps/api/src/modules/account/infrastructure/repository.ts':
          'export const repository = 1;',
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('http-cannot-access-persistence');
  });
  it('prevents domain code from importing application behavior', () => {
    const result = check('../application/dependency.js', {
      from: 'apps/api/src/modules/account/domain/probe.ts',
      files: {
        'apps/api/src/modules/account/application/dependency.ts':
          'export const application = 1;',
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('pure-domain');
  });
});
