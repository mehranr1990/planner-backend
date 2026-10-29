import 'reflect-metadata';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseEnvironment } from '../../apps/api/src/bootstrap/environment.ts';
import { ErasureControl } from '../../apps/api/dist/platform/storage/erasure-control.js';
import {
  signBackup,
  verifyBackup,
} from '../../apps/api/dist/platform/lifecycle/backup-manifest.js';
const config = parseEnvironment(process.env),
  command = process.argv[2],
  control = new ErasureControl(config);
async function artifacts(root: string, names: string[]) {
  const result: Record<string, string> = {};
  for (const name of names) {
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(name))
      throw new Error('Invalid backup artifact name');
    const filename = path.resolve(root, name),
      stat = await fs.lstat(filename);
    if (
      path.dirname(filename) !== path.resolve(root) ||
      !stat.isFile() ||
      stat.isSymbolicLink()
    )
      throw new Error('Invalid backup artifact');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    result[name] = hash.digest('hex');
  }
  return result;
}
try {
  if (command === 'init-control') {
    await control.initialize();
    process.stdout.write(
      'PASS: independent erasure control initialized for a new installation.\n',
    );
  } else if (command === 'sign-backup') {
    const [root, output, ...names] = process.argv.slice(3);
    if (!root || !output || names.length < 2)
      throw new Error(
        'Expected artifact directory, output manifest and at least two artifact names',
      );
    await control.onModuleInit();
    const records = await control.records(),
      actual = await artifacts(root, names),
      now = new Date();
    const signed = signBackup(config.BETTER_AUTH_SECRET, {
      version: 1,
      capturedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 86400000).toISOString(),
      checkpoint: control.checkpoint(records),
      artifacts: Object.entries(actual).map(([name, sha256]) => ({
        name,
        sha256,
      })),
    });
    await fs.writeFile(output, JSON.stringify(signed, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    process.stdout.write(
      'PASS: signed 30-day backup manifest; off-host expiry still requires deployment verification.\n',
    );
  } else if (command === 'verify-backup' || command === 'restore-replay') {
    const [manifestFile, root] = process.argv.slice(3);
    if (!manifestFile || !root)
      throw new Error('Expected manifest file and artifact directory');
    const envelope = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as {
      manifest: { artifacts: Array<{ name: string }> };
    };
    const names = envelope.manifest.artifacts.map((v) => v.name),
      actual = await artifacts(root, names);
    verifyBackup(config.BETTER_AUTH_SECRET, envelope, actual);
    if (command === 'restore-replay') {
      // An operator restores only to an isolated target first. This command never pg_restores/resets a DB.
      const { NestFactory } = await import('@nestjs/core'),
        { AppModule } = await import('../../apps/api/dist/app.module.js'),
        { PersonalLifecycle } =
          await import('../../apps/api/dist/modules/account/public/index.js');
      const app = await NestFactory.createApplicationContext(
        AppModule.register(config),
        { logger: false },
      );
      try {
        if (!(await app.get(PersonalLifecycle).restoreReplay()))
          throw new Error(
            'Restore remains quarantined; bounded replay incomplete or control proof invalid',
          );
      } finally {
        await app.close();
      }
    }
    process.stdout.write(
      'PASS: signed backup expiry/checksums' +
        (command === 'restore-replay'
          ? ' and current erasure replay verified'
          : ' verified') +
        '.\n',
    );
  } else
    throw new Error(
      'Expected init-control, sign-backup, verify-backup or restore-replay',
    );
} catch {
  process.stderr.write(
    'Personal data operation failed safely; no credentials or private artifacts printed.\n',
  );
  process.exitCode = 1;
}
