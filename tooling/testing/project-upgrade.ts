import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { migrationSandbox } from './migration-sandbox.ts';
import { isolatedTestDatabaseUrl } from './test-database.ts';
import { seedG0Personal } from './g0-personal-fixture.ts';
import {
  projectMigrationName,
  projectUsageMigrationName,
  assertReviewedProjectMigration,
} from './reviewed-project-migration.ts';
import { defaultPolicy } from '../../apps/api/src/modules/spaces/domain/shared-policy.ts';
import { verifyAssignmentUpgrade } from './assignment-upgrade.ts';

/** Populated accepted P2-02 state -> exact M05, including interrupted DDL and repeat deploy. */
export async function verifyProjectUpgrade(names: string[]) {
  const sandbox = await migrationSandbox(process.env),
    schema = new URL(sandbox.url).searchParams.get('schema')!;
  const folder = path.resolve('.tools/p2-03-upgrade-' + randomUUID()),
    migrations = path.join(folder, 'migrations'),
    config = path.join(folder, 'prisma.config.ts');
  fs.mkdirSync(migrations, { recursive: true });
  const copy = (name: string) =>
    fs.cpSync(
      path.join('prisma/migrations', name),
      path.join(migrations, name),
      { recursive: true },
    );
  fs.copyFileSync(
    'prisma/migrations/migration_lock.toml',
    path.join(migrations, 'migration_lock.toml'),
  );
  fs.writeFileSync(
    config,
    `import {defineConfig} from 'prisma/config';\nexport default defineConfig({schema:${JSON.stringify(path.resolve('prisma/schema.prisma'))},migrations:{path:${JSON.stringify(migrations)}},datasource:{url:process.env.DATABASE_URL!}});\n`,
  );
  function deploy() {
    const r = spawnSync(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'migrate',
        'deploy',
        '--config',
        config,
      ],
      { env: { ...process.env, DATABASE_URL: sandbox.url }, encoding: 'utf8' },
    );
    if (r.status !== 0)
      throw new Error(
        'Owned P2-03 populated upgrade failed (credentials withheld)',
      );
  }
  const client = new Client({
    connectionString: isolatedTestDatabaseUrl(process.env),
  });
  try {
    const boundary = names.indexOf(projectMigrationName);
    assert.equal(boundary, 28);
    names.slice(0, boundary).forEach(copy);
    deploy();
    await client.connect();
    await client.query(`SET search_path TO "${schema}"`);
    const personal = await seedG0Personal(client),
      policy = 'synthetic-p202-upgrade';
    const rule = {
      retainAfterClosureSeconds: 0,
      audience: ['OWNER'],
      exportAuthority: ['OWNER'],
      disposalAction: 'PURGE',
    };
    await client.query(
      'INSERT INTO "SharedRetentionPolicy" (version,configuration,"approvalReference") VALUES ($1,$2,\'SYNTHETIC-ONLY\')',
      [
        policy,
        JSON.stringify({
          policyVersion: policy,
          approvalReference: 'SYNTHETIC-ONLY',
          accountableOperator: 'synthetic migration fixture',
          applicableContexts: ['PROJECT'],
          marketScope: 'isolated rehearsal',
          sharedRecoverySeconds: 2592000,
          classRules: {
            workContent: rule,
            commentsHistory: rule,
            filesDerivatives: rule,
            exports: rule,
            accessAuditLifecycle: rule,
          },
          holds: [],
          obligations: [],
          backupPolicyReference: 'synthetic current control',
        }),
      ],
    );
    const roots: string[] = [],
      actors: string[] = [],
      accesses: string[] = [];
    for (const closing of [false, true]) {
      const space = randomUUID(),
        actor = randomUUID(),
        access = randomUUID();
      roots.push(space);
      actors.push(actor);
      accesses.push(access);
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO "Space" (id,kind,"ownerUserId","updatedAt") VALUES ($1,\'SHARED\',NULL,now())',
        [space],
      );
      await client.query(
        'INSERT INTO "SharedCustody" ("spaceId",kind,state,"primaryOwnerAccessId","retentionPolicyVersion","closureGeneration") VALUES ($1,\'PROJECT\',$2,$3,$4,$5)',
        [
          space,
          closing ? 'CLOSING_GRACE' : 'ACTIVE',
          access,
          policy,
          closing ? 1 : 0,
        ],
      );
      await client.query(
        'INSERT INTO "AccessScope" (id,"spaceId",kind) VALUES ($1,$1,\'ROOT\')',
        [space],
      );
      await client.query(
        'INSERT INTO "SharedActor" (id,"spaceId","userId",state,"erasedAt") VALUES ($1,$2,$3,$4,$5)',
        [
          actor,
          space,
          closing ? null : personal.user,
          closing ? 'ERASED' : 'ACTIVE',
          closing ? new Date('2026-10-30T00:00:00Z') : null,
        ],
      );
      await client.query(
        'INSERT INTO "ContextAccess" (id,"spaceId","scopeId","actorId",state,"memberRole","joinedAt","endedAt") VALUES ($1,$2,$2,$3,$4,\'ADMIN\',\'2026-10-20T00:00:00Z\',$5)',
        [
          access,
          space,
          actor,
          closing ? 'ERASED' : 'ACTIVE',
          closing ? new Date('2026-10-30T00:00:00Z') : null,
        ],
      );
      await client.query(
        'INSERT INTO "ContextAccessInterval" ("accessId",generation,"joinedAt","endedAt") VALUES ($1,1,\'2026-10-20T00:00:00Z\',$2)',
        [access, closing ? new Date('2026-10-30T00:00:00Z') : null],
      );
      await client.query(
        'INSERT INTO "ContextCapabilityPolicy" ("spaceId","scopeId",version,"roleDefaults","exportMaxRecords","exportMaxBytes","publishedByActorId","auditId") VALUES ($1,$1,1,$2,10000,10485760,$3,$4)',
        [space, JSON.stringify(defaultPolicy), actor, randomUUID()],
      );
      if (closing)
        await client.query(
          'INSERT INTO "SharedLifecycleJob" (id,"custodyId","spaceId",generation,state,"effectiveDepartureAt","recoveryDeadline","retentionPolicyVersion","nextAt") VALUES ($1,$2,$2,1,\'CLOSING_GRACE\',\'2026-10-30T00:00:00Z\',\'2026-11-29T00:00:00Z\',$3,\'2026-11-29T00:00:00Z\')',
          [randomUUID(), space, policy],
        );
      await client.query('COMMIT');
    }
    for (const feature of ['shared.custody', 'shared.membership']) {
      const id = randomUUID();
      await client.query(
        'INSERT INTO "SharedAuditEvent" (id,"spaceId","actorId",action,"requestId") VALUES ($1,$2,$3,\'fixture.created\',$4)',
        [id, roots[0], actors[0], randomUUID()],
      );
      await client.query(
        'INSERT INTO "SharedOutboxEvent" (id,"spaceId","actorId","auditId",action,"authorizationVersion") VALUES ($1,$2,$3,$4,\'fixture.created\',1)',
        [randomUUID(), roots[0], actors[0], id],
      );
      await client.query(
        'INSERT INTO "SharedUsageEntry" (id,"spaceId","subjectActorId","auditId",feature,delta) VALUES ($1,$2,$3,$4,$5,1)',
        [randomUUID(), roots[0], actors[0], id, feature],
      );
    }
    await client.query(
      'INSERT INTO "SharedMutationReceipt" (id,"spaceId","scopeId","actorId",operation,"keyHash",fingerprint,"resultId","statusCode","createdAt","expiresAt") VALUES ($1,$2,$2,$3,\'fixture.create\',$4,$5,$2,201,\'2026-10-30T00:00:00Z\',\'2026-10-31T00:00:00Z\')',
      [randomUUID(), roots[0], actors[0], 'a'.repeat(64), 'b'.repeat(64)],
    );
    await client.query(
      'INSERT INTO "SharedExitWork" ("userId","closedAt",attempts,"failureCode") VALUES ($1,\'2026-10-30T00:00:00Z\',2,\'SYNTHETIC_RETRY\')',
      [personal.other],
    );
    await client.query('BEGIN');
    const recipientActor = randomUUID(),
      recipientAccess = randomUUID();
    await client.query(
      `INSERT INTO "SharedActor" (id,"spaceId","userId",state) VALUES ($1,$2,$3,'ACTIVE')`,
      [recipientActor, roots[0], personal.other],
    );
    await client.query(
      `INSERT INTO "ContextAccess" (id,"spaceId","scopeId","actorId",state,"memberRole","joinedAt") VALUES ($1,$2,$2,$3,'ACTIVE','MEMBER','2026-10-20T00:00:00Z')`,
      [recipientAccess, roots[0], recipientActor],
    );
    await client.query(
      `INSERT INTO "ContextAccessInterval" ("accessId",generation,"joinedAt") VALUES ($1,1,'2026-10-20T00:00:00Z')`,
      [recipientAccess],
    );
    await client.query(
      `INSERT INTO "ContextInvitation" (id,"spaceId","scopeId","inviterAccessId","inviterGeneration","recipientUserId","recipientAccessId","recipientGeneration","recipientRevision","memberRole","proofHash","keyHash",fingerprint,"createdAt","expiresAt") VALUES ($1,$2,$2,$3,1,$4,$5,1,1,'MEMBER',$6,$7,$8,'2026-10-30T00:00:00Z','2026-11-06T00:00:00Z')`,
      [
        randomUUID(),
        roots[0],
        accesses[0],
        personal.other,
        recipientAccess,
        'c'.repeat(64),
        'd'.repeat(64),
        'e'.repeat(64),
      ],
    );
    await client.query(
      `INSERT INTO "OwnerHandover" (id,"spaceId","scopeId","fromAccessId","fromGeneration","toAccessId","toGeneration","expectedCustodyRevision","keyHash",fingerprint,"createdAt","expiresAt") VALUES ($1,$2,$2,$3,1,$4,1,1,$5,$6,'2026-10-30T00:00:00Z','2026-11-06T00:00:00Z')`,
      [
        randomUUID(),
        roots[0],
        accesses[0],
        recipientAccess,
        'f'.repeat(64),
        'a'.repeat(64),
      ],
    );
    await client.query(
      `INSERT INTO "SharedRateLimit" ("keyHash","windowAt",requests,"expiresAt") VALUES ($1,'2026-10-30T00:00:00Z',5,'2026-10-30T00:01:00Z')`,
      ['b'.repeat(64)],
    );
    await client.query('COMMIT');
    const tables = (
      await client.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename<>'_prisma_migrations' ORDER BY tablename",
        [schema],
      )
    ).rows.map((r) => r.tablename);
    assert.equal(tables.length, 84);
    const columns: Record<string, string> = {};
    for (const table of tables)
      columns[table] = (
        await client.query<{ column_name: string }>(
          'SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',
          [schema, table],
        )
      ).rows
        .map((r) => '"' + r.column_name + '"')
        .join(',');
    async function snapshot() {
      const rows: Record<string, unknown> = {};
      for (const table of tables)
        rows[table] = (
          await client.query(
            `SELECT to_jsonb(t) row FROM (SELECT ${columns[table]} FROM "${table}") t ORDER BY to_jsonb(t)::text`,
          )
        ).rows;
      return rows;
    }
    const before = await snapshot(),
      constraints = (
        await client.query(
          `SELECT c.relname table_name,con.conname,pg_get_constraintdef(con.oid) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid WHERE con.connamespace=$1::regnamespace ORDER BY c.relname,con.conname`,
          [schema],
        )
      ).rows;
    const history = (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
      )
    ).rows;
    const sql = fs.readFileSync(
      'prisma/migrations/' + projectMigrationName + '/migration.sql',
      'utf8',
    );
    assertReviewedProjectMigration(projectMigrationName, sql);
    await client.query(sql.replace(/COMMIT;\s*$/, 'ROLLBACK;'));
    const usageSql = fs.readFileSync(
      'prisma/migrations/' + projectUsageMigrationName + '/migration.sql',
      'utf8',
    );
    assertReviewedProjectMigration(projectUsageMigrationName, usageSql);
    await client.query(usageSql.replace(/COMMIT;\s*$/, 'ROLLBACK;'));
    assert.equal(
      (await client.query('SELECT to_regclass(\'"Project"\') relation')).rows[0]
        .relation,
      null,
    );
    const start = performance.now();
    copy(projectMigrationName);
    deploy(); // Core committed; resume the reviewed feature-register companion separately.
    copy(projectUsageMigrationName);
    copy('202611040007_project_structure_order');
    copy('202611040008_project_personal_compatibility');
    deploy();
    const elapsedMs = Math.round(performance.now() - start);
    deploy();
    assert.deepEqual(await snapshot(), before);
    const featureCheck = (
      await client.query<{ definition: string }>(
        `SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace=$1::regnamespace AND conname='SharedUsageEntry_feature_check'`,
        [schema],
      )
    ).rows[0]!.definition;
    for (const feature of [
      'shared.custody',
      'shared.membership',
      'task.shared',
      'goal.shared',
      'shared.resource-grant',
    ])
      assert.ok(featureCheck.includes("'" + feature + "'"));
    for (const con of constraints) {
      if (
        con.table_name === 'SharedUsageEntry' &&
        con.conname === 'SharedUsageEntry_feature_check'
      )
        continue;
      if (
        (['Task', 'Goal'].includes(con.table_name) &&
          con.definition === 'NOT NULL "createdByUserId"') ||
        (con.table_name === 'TaskChange' &&
          con.definition === 'NOT NULL "actorUserId"')
      )
        continue;
      assert.deepEqual(
        (
          await client.query(
            'SELECT pg_get_constraintdef(con.oid) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid WHERE con.connamespace=$1::regnamespace AND c.relname=$2 AND con.conname=$3',
            [schema, con.table_name, con.conname],
          )
        ).rows,
        [{ definition: con.definition }],
      );
    }
    assert.deepEqual(
      (
        await client.query(
          'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 28',
        )
      ).rows,
      history,
    );
    fs.writeFileSync(
      path.join(folder, 'report.json'),
      JSON.stringify(
        {
          tablesPreserved: 84,
          historicalMigrations: 28,
          existingConstraints: constraints.length,
          intentionalFeatureCheckExtension: 1,
          intentionalBranchSafeNullabilityChanges: 3,
          populatedInvitationsAndHandover: 'PASS',
          activeAndClosingCustody: 'PASS',
          interruptedRollback: 'PASS',
          repeatDeploy: 'PASS',
          elapsedMs,
          sha256: createHash('sha256').update(sql).digest('hex'),
          usageSha256: createHash('sha256').update(usageSql).digest('hex'),
        },
        null,
        2,
      ) + '\n',
    );
    process.stdout.write(
      'PASS: P2-03 preserves all 84 prior table data sets, unchanged legacy FKs and 28 checksums; only the three reviewed attribution NOT NULL branches and feature CHECK change; active/closing custody, interrupted M05 rollback/resume and repeat deploy.\n',
    );
    if (names.includes('202611040009_task_assignment'))
      await verifyAssignmentUpgrade({
        client,
        schema,
        copy,
        deploy,
        spaceId: roots[0]!,
        actorId: actors[0]!,
        accessId: accesses[0]!,
        recipientActorId: recipientActor,
        recipientAccessId: recipientAccess,
      });
  } finally {
    await client.end();
    await sandbox.close();
  }
}
