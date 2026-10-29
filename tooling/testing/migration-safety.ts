import {
  reviewedFinanceMigrationName,
  assertReviewedFinanceMigration,
} from './reviewed-finance-migration.ts';
import {
  reviewedVoiceMigrationName,
  assertReviewedVoiceMigration,
} from './reviewed-voice-migration.ts';
import fs from 'node:fs';
import path from 'node:path';

/** Conservative review gate, not a general SQL parser. Unrecognized migration forms need owner review. */
export function assertAdditiveMigration(sql: string): void {
  if (/\$[a-zA-Z_0-9]*\$/.test(sql))
    throw new Error('Procedural SQL requires explicit migration review.');
  const code = sql.replace(
    /'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\//g,
    (token) =>
      token.startsWith('--') || token.startsWith('/*')
        ? ''
        : token.startsWith('"')
          ? 'identifier'
          : 'literal',
  );
  const statements = code
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  // A single outer transaction adds atomicity; inspect every enclosed statement normally.
  if (
    /^BEGIN$/i.test(statements[0] ?? '') &&
    /^COMMIT$/i.test(statements.at(-1) ?? '')
  ) {
    statements.shift();
    statements.pop();
  }
  if (
    !statements.length ||
    statements.some(
      (statement) =>
        /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|RENAME)\b/.test(
          statement
            .toUpperCase()
            .replace(
              /ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION)/gi,
              '',
            ),
        ) ||
        !/^(?:CREATE\s+(?:TABLE|TYPE|(?:UNIQUE\s+)?INDEX|SCHEMA\s+IF\s+NOT\s+EXISTS)\b|ALTER\s+TABLE\s+identifier\s+ADD\s+(?:COLUMN|CONSTRAINT)\b)/i.test(
          statement,
        ),
    )
  )
    throw new Error(
      'Empty, destructive or unreviewed migration requires explicit owner approval.',
    );
}

export function reviewMigrations(directory = 'prisma/migrations'): string[] {
  const names = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!names.length) throw new Error('No reviewed migrations found.');
  for (const name of names) {
    const sql = fs.readFileSync(
      path.join(directory, name, 'migration.sql'),
      'utf8',
    );
    if (name === reviewedVoiceMigrationName)
      assertReviewedVoiceMigration(name, sql);
    else if (name === reviewedFinanceMigrationName)
      assertReviewedFinanceMigration(name, sql);
    else assertAdditiveMigration(sql);
  }
  return names;
}
