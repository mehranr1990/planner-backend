import { it, expect } from 'vitest';
import fs from 'node:fs';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { assertAdditiveMigration } from '../../../../tooling/testing/migration-safety.js';
import { randomUUID } from 'node:crypto';
it('adds capacity and communication offer tables without changing predecessor rows or allowing cross-scope links', async () => {
  const s = await migrationSandbox(process.env);
  try {
    for (const table of ['Project', 'Conversation', 'Meeting'])
      await s.query(
        `CREATE TABLE "${table}" (id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,UNIQUE("spaceId","scopeId",id))`,
      );
    await s.query(
      'CREATE TABLE "ContextAccess" (id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,UNIQUE("spaceId","scopeId",id))',
    );
    await s.query(
      'CREATE TABLE "ContextAccessInterval" ("accessId" uuid NOT NULL,generation integer NOT NULL,PRIMARY KEY("accessId",generation))',
    );
    await s.query(
      'CREATE TABLE "SharedActor" (id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,UNIQUE("spaceId",id))',
    );
    for (const kind of ['Conversation', 'Meeting']) {
      await s.query(
        `CREATE TABLE "${kind}Member" (id uuid PRIMARY KEY,"${kind.toLowerCase()}Id" uuid NOT NULL,UNIQUE("${kind.toLowerCase()}Id",id))`,
      );
      await s.query(
        `CREATE TABLE "${kind}Invitation" (id uuid PRIMARY KEY,revision integer NOT NULL)`,
      );
      await s.query(`INSERT INTO "${kind}Invitation" VALUES ($1,7)`, [
        randomUUID(),
      ]);
    }
    const id = randomUUID(),
      space = randomUUID(),
      scope = randomUUID();
    await s.query('INSERT INTO "Project" VALUES ($1,$2,$3)', [
      id,
      space,
      scope,
    ]);
    const before = (await s.query('SELECT * FROM "Project"')).rows;
    for (const name of [
      '202611230092_project_member_weekday_capacity',
      '202611230093_communication_email_invitations',
    ]) {
      const sql = fs.readFileSync(
        `prisma/migrations/${name}/migration.sql`,
        'utf8',
      );
      assertAdditiveMigration(sql);
      await s.query(sql);
    }
    expect((await s.query('SELECT * FROM "Project"')).rows).toEqual(before);
    expect(
      (
        await s.query(
          'SELECT revision,"invitedEmail" FROM "ConversationInvitation"',
        )
      ).rows,
    ).toEqual([{ revision: 7, invitedEmail: null }]);
    await expect(
      s.query(
        'INSERT INTO "ProjectMemberCapacityTemplate"(id,"spaceId","scopeId","projectId","accessId",generation) VALUES ($1,$2,$3,$4,$5,1)',
        [randomUUID(), space, scope, id, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    expect(
      (
        await s.query(
          'SELECT count(*)::int AS count FROM "ConversationEmailInvitation"',
        )
      ).rows[0].count,
    ).toBe(0);
  } finally {
    await s.close();
  }
});
it('preserves predecessor data and deterministically backfills only new feature columns', async () => {
  const s = await migrationSandbox(process.env);
  try {
    for (const table of [
      'Project',
      'ConversationMember',
      'ContextInvitation',
      'NotificationPreference',
    ]) {
      await s.query(
        `CREATE TABLE "${table}" (id integer PRIMARY KEY, payload text NOT NULL)`,
      );
      await s.query(`INSERT INTO "${table}" VALUES (1,'preserved')`);
    }
    for (const migration of [
      '202611230088_project_manual_status',
      '202611230089_conversation_member_visibility',
      '202611230090_invitation_email_delivery',
      '202611230091_module_notification_channels',
    ]) {
      const sql = fs.readFileSync(
        `prisma/migrations/${migration}/migration.sql`,
        'utf8',
      );
      assertAdditiveMigration(sql);
      await s.query(sql);
    }
    expect((await s.query('SELECT * FROM "Project"')).rows).toEqual([
      { id: 1, payload: 'preserved', manualStatus: 'PLANNED' },
    ]);
    expect((await s.query('SELECT * FROM "ConversationMember"')).rows).toEqual([
      {
        id: 1,
        payload: 'preserved',
        archived: false,
        hiddenAt: null,
        deletedThrough: '0',
      },
    ]);
    expect(
      (await s.query('SELECT * FROM "ContextInvitation"')).rows[0]
        .emailDeliveryState,
    ).toBe('NONE');
    expect(
      (await s.query('SELECT * FROM "NotificationPreference"')).rows[0]
        .moduleChannels,
    ).toEqual({});
    await expect(
      s.query(`UPDATE "Project" SET "manualStatus"='ARCHIVED'`),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      s.query(`UPDATE "ConversationMember" SET "deletedThrough"=-1`),
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await s.close();
  }
});
