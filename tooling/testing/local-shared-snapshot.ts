import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isolatedTestDatabaseUrl } from './test-database.js';
import { migrationSandbox } from './migration-sandbox.js';

/** Quiesced synthetic schema + private bytes; current independent controls are deliberately excluded. */
export async function localSharedSnapshot(
  sourceUrl: string,
  storageRoot: string,
) {
  const base = new URL(isolatedTestDatabaseUrl(process.env)),
    source = new URL(sourceUrl).searchParams.get('schema');
  if (!source || !/^p003_[a-f0-9]{32}$/.test(source))
    throw new Error('Snapshot requires an owned local fixture schema');
  const root = fs.mkdtempSync(path.resolve('.tools/shared-snapshot-'));
  const dump = path.join(root, 'snapshot.sql');
  const executable =
    process.platform === 'win32'
      ? 'C:/Program Files/PostgreSQL/18/bin/pg_dump.exe'
      : 'pg_dump';
  const result = spawnSync(
    executable,
    [
      '--schema=' + source,
      '--inserts',
      '--no-owner',
      '--no-privileges',
      '--file=' + dump,
    ],
    {
      env: {
        ...process.env,
        PGHOST: base.hostname,
        PGPORT: base.port || '5432',
        PGDATABASE: decodeURIComponent(base.pathname.slice(1)),
        PGUSER: decodeURIComponent(base.username),
        PGPASSWORD: decodeURIComponent(base.password),
      },
      encoding: 'utf8',
    },
  );
  if (result.status !== 0)
    throw new Error(
      'Local fixture snapshot failed; connection and dump output withheld',
    );
  fs.cpSync(storageRoot, path.join(root, 'files'), { recursive: true });
  return async () => {
    const target = await migrationSandbox(process.env),
      schema = new URL(target.url).searchParams.get('schema')!;
    const sql = fs
      .readFileSync(dump, 'utf8')
      .replace(/^\\(?:unrestrict|restrict).*$/gm, '')
      .replaceAll('CREATE SCHEMA ' + source + ';', '')
      .replaceAll(source, schema);
    try {
      await target.query(sql);
    } catch {
      await target.close();
      throw new Error('Isolated fixture restore failed; dump output withheld');
    }
    const files = path.join(root, 'restored-' + schema);
    fs.cpSync(path.join(root, 'files'), files, { recursive: true });
    return { target, files };
  };
}
