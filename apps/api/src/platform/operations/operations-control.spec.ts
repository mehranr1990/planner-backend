import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { OperationsControl } from './operations-control.js';
import { parseEnvironment } from '../../bootstrap/environment.js';
it('keeps signed maintenance status available without PostgreSQL and fails closed on missing or corrupt evidence', async () => {
  await fs.mkdir('.tools', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.tools/p3-control-'));
  try {
    const config = parseEnvironment({
      DATABASE_URL: 'postgresql://localhost/unavailable_dev',
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'unit-test-only-backup-key-at-least-32-characters',
      OPERATIONS_CONTROL_ROOT: path.join(root, 'independent'),
    });
    const first = new OperationsControl(config),
      id = randomUUID();
    await expect(first.assert()).rejects.toHaveProperty('status', 503);
    await first.write('RESTORING', id);
    const restarted = new OperationsControl(config);
    expect(await restarted.status()).toMatchObject({
      state: 'RESTORING',
      runId: id,
    });
    await expect(restarted.assert()).rejects.toHaveProperty('status', 503);
    await restarted.write('READY', id);
    await restarted.assert();
    await fs.writeFile(path.join(root, 'independent/status.json'), '{}');
    await expect(restarted.assert()).rejects.toHaveProperty('status', 503);
  } finally {
    if (!root.startsWith(path.resolve('.tools') + path.sep))
      throw new Error('Unsafe fixture root');
    await fs.rm(root, { recursive: true, force: true });
  }
});
