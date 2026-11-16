import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { reviewMigrations } from './migration-safety.ts';
import { SHARED_CLEANUP_FK_SHA256 } from '../../apps/api/src/platform/lifecycle/shared-cleanup-catalog.ts';
/** Continue the existing populated upgrade rehearsal, exclusively in its owned test schema. */
export async function verifyProjectGapUpgrade(input: {
  client: Client;
  schema: string;
  copy: (name: string) => void;
  deploy: () => void;
}) {
  const { client, schema } = input,
    names = reviewMigrations(),
    boundary = names.indexOf('202611150060_project_order_phase_dates');
  assert.equal(boundary, 84);
  names.slice(69, boundary).forEach(input.copy);
  input.deploy();
  const ledger = (
    await client.query(
      'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
    )
  ).rows;
  assert.equal(ledger.length, 84);
  const columns = (
    await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name<>'_prisma_migrations' ORDER BY table_name,ordinal_position`,
      [schema],
    )
  ).rows;
  const tables = new Map<string, string[]>();
  for (const c of columns) {
    assert.match(c.table_name, /^[A-Za-z][A-Za-z0-9_]*$/);
    assert.match(c.column_name, /^[A-Za-z][A-Za-z0-9_]*$/);
    tables.set(c.table_name, [
      ...(tables.get(c.table_name) ?? []),
      c.column_name,
    ]);
  }
  async function snapshot() {
    const data: Record<string, unknown> = {};
    for (const [table, cols] of tables)
      data[table] = (
        await client.query(
          `SELECT to_jsonb(t) row FROM (SELECT ${cols.map((c) => '"' + c + '"').join(',')} FROM "${table}") t ORDER BY to_jsonb(t)::text`,
        )
      ).rows;
    return data;
  }
  const before = await snapshot();
  const catalog = async () =>
    (
      await client.query(
        `SELECT t.relname "table",c.conname name,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace=$1::regnamespace ORDER BY t.relname,c.conname`,
        [schema],
      )
    ).rows;
  const constraints = await catalog();
  for (const name of names.slice(boundary)) {
    let requestFixture:
      { teamId: string; projectId: string; active: boolean } | undefined;
    let requestId: string | undefined;
    if (name === '202611160072_typed_team_association_requests') {
      requestFixture = (
        await client.query(
          'SELECT "teamId","projectId",active FROM "TeamProjectReference" ORDER BY "teamId","projectId" LIMIT 1',
        )
      ).rows[0];
      assert.ok(requestFixture, 'Populated Team reference predecessor fixture');
      requestId = randomUUID();
      await client.query(
        'UPDATE "TeamProjectReference" SET "associationRequest"=$3 WHERE "teamId"=$1 AND "projectId"=$2',
        [
          requestFixture.teamId,
          requestFixture.projectId,
          {
            id: requestId,
            action: requestFixture.active ? 'UNLINK' : 'LINK',
            state: 'PENDING',
            requestedAt: '2030-01-01T00:00:00.000Z',
            reviewedAt: null,
          },
        ],
      );
    }
    const sql = fs.readFileSync(
        'prisma/migrations/' + name + '/migration.sql',
        'utf8',
      ),
      prior = await catalog();
    const interrupted = /^\s*BEGIN;/i.test(sql)
      ? sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')
      : 'BEGIN;\n' + sql + '\nSELECT 1/0; COMMIT;';
    await assert.rejects(client.query(interrupted), { code: '22012' });
    await client.query('ROLLBACK');
    assert.deepEqual(await catalog(), prior);
    assert.deepEqual(await snapshot(), before);
    input.copy(name);
    input.deploy();
    assert.deepEqual(await snapshot(), before);
    if (requestFixture) {
      const row = (
        await client.query(
          'SELECT "associationRequest","requestId","requestState","requestAction","requestCreatedAt","requestReviewedAt" FROM "TeamProjectReference" WHERE "teamId"=$1 AND "projectId"=$2',
          [requestFixture.teamId, requestFixture.projectId],
        )
      ).rows[0];
      assert.equal(row.requestId, requestId);
      assert.equal(row.requestId, row.associationRequest.id);
      assert.equal(row.requestState, 'PENDING');
      assert.equal(row.requestAction, row.associationRequest.action);
      assert.equal(
        row.requestCreatedAt.toISOString(),
        row.associationRequest.requestedAt,
      );
      assert.equal(row.requestReviewedAt, null);
    }
  }
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 84',
      )
    ).rows,
    ledger,
  );
  const after = await catalog();
  for (const old of constraints) {
    const current = after.find(
      (c) => c.table === old.table && c.name === old.name,
    );
    assert.ok(current);
    if (
      old.table === 'SharedAssignmentNotification' &&
      old.name === 'SharedAssignmentNotification_kind_check'
    ) {
      assert.equal(
        current.definition,
        old.definition.replace(
          "'REASSIGNED'::character varying]",
          "'REASSIGNED'::character varying, 'WITHDRAWN'::character varying, 'REMINDER'::character varying]",
        ),
      );
    } else {
      const additions: Record<string, [string, string]> = {
        'TeamMeetingInvitation.TeamMeetingInvitation_state_check': [
          "'REVOKED'::character varying]",
          "'MAYBE'::character varying, 'REVOKED'::character varying]",
        ],
        'TeamTimeOffEvent.TeamTimeOffEvent_action_check': [
          "'CANCELED'::character varying]",
          "'CANCELED'::character varying, 'EDITED'::character varying]",
        ],
        'TeamTaskAssignment.TeamTaskAssignment_endReason_check': [
          "'REASSIGNED'::character varying]",
          "'REASSIGNED'::character varying, 'WITHDRAWN'::character varying]",
        ],
        'TeamTaskAssignmentEvent.TeamTaskAssignmentEvent_action_check': [
          "'REMINDED'::character varying]",
          "'REMINDED'::character varying, 'REVERTED'::character varying]",
        ],
      };
      const change = additions[old.table + '.' + old.name];
      assert.equal(
        current.definition,
        change ? old.definition.replace(...change) : old.definition,
      );
    }
  }
  const codes = (
    await client.query(
      'SELECT d.code,d.kind,d.ordinal FROM "ProjectRegisterDetail" d',
    )
  ).rows;
  assert.equal(
    codes.length,
    Number(
      (await client.query('SELECT count(*) n FROM "ProjectRiskIssue"')).rows[0]
        .n,
    ),
  );
  for (const row of codes)
    assert.equal(row.code, (row.kind === 'RISK' ? 'R-' : 'I-') + row.ordinal);
  const fks = (
    await client.query(
      `SELECT t.relname "table",c.conname name,r.relname target,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid WHERE c.contype='f' AND c.connamespace=$1::regnamespace`,
      [schema],
    )
  ).rows
    .map((r) => ({
      table: r.table,
      name: r.name,
      target: r.target,
      definition: r.definition,
    }))
    .sort((a, b) => (a.table + '|' + a.name < b.table + '|' + b.name ? -1 : 1));
  assert.equal(fks.length, 970);
  assert.equal(
    createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
    SHARED_CLEANUP_FK_SHA256,
  );
  process.stdout.write(
    `PASS: Projects gap closure preserves ${tables.size} predecessor datasets and all 84 historical checksums; ${names.length - boundary} interruption rollbacks, repeated deployment, stable risk-code backfill and exact 970-FK cleanup catalog.\n`,
  );
}
