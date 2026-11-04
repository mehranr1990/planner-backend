import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  taskToolsMigrationHashes,
  assertReviewedTaskToolsMigration,
} from '../testing/reviewed-task-tools-migrations.js';
it('pins M07 SQL review without relaxing the generic migration gate', () => {
  for (const name of Object.keys(taskToolsMigrationHashes)) {
    const sql = fs.readFileSync(
      'prisma/migrations/' + name + '/migration.sql',
      'utf8',
    );
    expect(() => assertReviewedTaskToolsMigration(name, sql)).not.toThrow();
    expect(() => assertReviewedTaskToolsMigration(name, sql + ' ')).toThrow();
    expect(sql).toMatch(/^BEGIN;/);
    expect(sql).toMatch(/COMMIT;\s*$/);
    expect(sql).not.toMatch(
      /DROP TABLE|TRUNCATE|DELETE FROM "(?:Task|Project|ContextAccess)"/i,
    );
  }
});
