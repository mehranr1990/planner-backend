import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { isolatedTestDatabaseUrl } from './test-database.ts';

/** Owns ONLY an unpredictable, newly-created fixture schema in the guarded test DB. */
export async function migrationSandbox(environment: NodeJS.ProcessEnv) {
  const base = isolatedTestDatabaseUrl(environment);
  const schema = 'p003_' + randomUUID().replaceAll('-', '');
  const pool = new Pool({ connectionString: base, max: 1 });
  let owned = false;
  async function create() {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    owned = true;
  }
  async function drop() {
    if (!owned || !/^p003_[a-f0-9]{32}$/.test(schema))
      throw new Error('Refusing to reset an unowned schema.');
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    owned = false;
  }
  await create();
  const url = new URL(base);
  url.searchParams.set('schema', schema);
  return {
    url: url.toString(),
    async query(sql: string, values?: unknown[]) {
      const connection = await pool.connect();
      try {
        await connection.query(`SET search_path TO "${schema}"`);
        return await connection.query(sql, values);
      } finally {
        connection.release();
      }
    },
    async resetOwnedSchema() {
      await drop();
      await create();
    },
    async close() {
      try {
        if (owned) await drop();
      } finally {
        await pool.end();
      }
    },
  };
}
