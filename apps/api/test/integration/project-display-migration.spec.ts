import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { assertAdditiveMigration } from '../../../../tooling/testing/migration-safety.js';

it('preserves populated Project data when adding nullable display metadata', async () => {
  const sandbox = await migrationSandbox(process.env);
  try {
    await sandbox.query(
      'CREATE TABLE "Project" (id uuid PRIMARY KEY, title varchar(300) NOT NULL, description varchar(10000), revision integer NOT NULL)',
    );
    const id = randomUUID();
    await sandbox.query('INSERT INTO "Project" VALUES ($1,$2,$3,7)', [
      id,
      'Preserved project',
      'Existing summary',
    ]);
    const before = (await sandbox.query('SELECT * FROM "Project"')).rows[0];
    const sql = fs.readFileSync(
      'prisma/migrations/202611120046_project_display_metadata/migration.sql',
      'utf8',
    );
    assertAdditiveMigration(sql);
    await sandbox.query(sql);
    expect((await sandbox.query('SELECT * FROM "Project"')).rows[0]).toEqual({
      ...before,
      key: null,
      color: null,
    });
    const planningSql = fs.readFileSync(
      'prisma/migrations/202611120047_project_planning_metadata/migration.sql',
      'utf8',
    );
    assertAdditiveMigration(planningSql);
    await sandbox.query(planningSql);
    expect(
      (
        await sandbox.query(
          'SELECT "startDate","endDate","statusNote" FROM "Project"',
        )
      ).rows[0],
    ).toEqual({ startDate: null, endDate: null, statusNote: null });
    await expect(
      sandbox.query(
        'UPDATE "Project" SET "startDate"=$1,"endDate"=$2 WHERE id=$3',
        ['2026-12-31', '2026-01-01', id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      sandbox.query('UPDATE "Project" SET color=$1 WHERE id=$2', ['red', id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      sandbox.query('UPDATE "Project" SET "key"=$1 WHERE id=$2', [
        'bad key',
        id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await sandbox.query('UPDATE "Project" SET "key"=$1,color=$2 WHERE id=$3', [
      'APP-1',
      '#Aabb00',
      id,
    ]);
    expect(
      (await sandbox.query('SELECT title,description,revision FROM "Project"'))
        .rows[0],
    ).toEqual({
      title: before.title,
      description: before.description,
      revision: 7,
    });
  } finally {
    await sandbox.close();
  }
});
