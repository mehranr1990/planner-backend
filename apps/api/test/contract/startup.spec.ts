import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('compiled startup', () => {
  it('fails clearly and safely before listening when config is missing', () => {
    const result = spawnSync(process.execPath, ['apps/api/dist/main.js'], {
      env: { ...process.env, DATABASE_URL: '' },
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain('STARTUP_FAILED');
    expect(output).toContain('Invalid configuration: DATABASE_URL');
    expect(output).not.toContain('Nest application successfully started');
  });
});
