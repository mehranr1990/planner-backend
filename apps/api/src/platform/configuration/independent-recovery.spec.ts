import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { OperationsControl } from '../operations/operations-control.js';
import { parseEnvironment } from '../../bootstrap/environment.js';
it('serializes signed offline restrictions and never reopens on failed checks, wrong run or restore state', async () => {
  const root = await fs.mkdtemp(path.resolve('.tools/p6-independent-'));
  try {
    const control = new OperationsControl(
        parseEnvironment({
          DATABASE_URL: 'postgresql://localhost/unavailable_dev',
          BETTER_AUTH_URL: 'http://localhost:3000',
          BETTER_AUTH_SECRET:
            'synthetic-p6-independent-key-at-least-32-characters',
          OPERATIONS_CONTROL_ROOT: root,
        }),
      ),
      run = randomUUID();
    await control.restrict(run);
    expect((await control.status())?.state).toBe('FAILED');
    await expect(control.recover(run, async () => undefined)).rejects.toThrow(
      'state',
    );
    await control.write('READY', run);
    const m = {
      mode: 'READ_ONLY' as const,
      bindings: [],
      messages: { en: 'Maintenance', fa: 'تعمیرات' },
      defaultLocale: 'en',
      estimatedEndAt: '2020-01-01T00:00:00.000Z',
      progress: 100,
      status: 'Still gated',
    };
    const messages = Object.fromEntries(
      [
        'en',
        ...Array.from(
          { length: 19 },
          (_, i) => 'a' + String.fromCharCode(97 + i),
        ),
      ].map((locale) => [locale, '\0'.repeat(500)]),
    );
    await expect(control.restrict(run, { ...m, messages })).rejects.toThrow(
      'byte budget',
    );
    expect((await control.status())?.state).toBe('READY');
    await control.restrict(run, m);
    await control.assert({ module: 'tasks', operation: 'read' });
    await expect(
      control.assert({ module: 'tasks', operation: 'write' }),
    ).rejects.toHaveProperty('status', 503);
    await expect(
      control.recover(randomUUID(), async () => undefined),
    ).rejects.toThrow('identity');
    await expect(
      control.recover(run, async () => {
        throw Error('readiness failed');
      }),
    ).rejects.toThrow('readiness');
    expect((await control.status())?.state).toBe('MAINTENANCE');
    await expect(control.restrict(run, m)).rejects.toThrow('escalated');
    await control.restrict(run);
    await expect(
      control.assert({ module: 'tasks', operation: 'read' }),
    ).rejects.toHaveProperty('status', 503);
    await control.recover(run, async () => undefined);
    await control.assert();
    await control.write('RESTORING', run);
    await expect(control.recover(run, async () => undefined)).rejects.toThrow(
      'state',
    );
    await expect(control.restrict(randomUUID())).rejects.toThrow('Recovery');
    expect((await control.status())?.runId).toBe(run);
  } finally {
    if (!root.startsWith(path.resolve('.tools') + path.sep))
      throw Error('Unsafe P6 fixture root');
    await fs.rm(root, { recursive: true, force: true });
  }
});
