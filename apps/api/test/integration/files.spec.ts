import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Readable, PassThrough } from 'node:stream';
import http from 'node:http';
import { testApplication } from '../support/application.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import { FilesService } from '../../src/platform/storage/files.service.js';
import { FilesRepository } from '../../src/platform/storage/files.repository.js';
import {
  STORAGE_PORT,
  StorageFailure,
} from '../../src/platform/storage/storage.port.js';
import type { StoragePort } from '../../src/platform/storage/storage.port.js';
import { SpacesService } from '../../src/modules/spaces/public/index.js';
import { AuditService } from '../../src/platform/audit/audit.service.js';
import { StoredFileSchema } from '@mehran/api-contracts';

const databaseUrl = isolatedTestDatabaseUrl(process.env),
  origin = 'http://localhost:3000';
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
type Actor = { id: string; cookie: string };
describe('P0-04 private file lifecycle and security', () => {
  let app: NestExpressApplication,
    db: DatabaseService,
    fixture: string,
    root: string;
  const identities: string[] = [];
  let clock = Date.now();
  const environment = () => ({
    STORAGE_ROOT: root,
    FILE_MAX_BYTES: '2048',
    FILE_UPLOAD_TIMEOUT_MS: '1000',
  });
  async function identity(): Promise<Actor> {
    const email = `p004-${randomUUID()}@example.test`,
      password = 'test-only-file-password-123!';
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .send({ email, password, name: 'File fixture' })
      .expect(200);
    const id = signup.body.user.id as string;
    identities.push(id);
    const link = new URL(
      app.get(IdentityMailService).latestForTest(email, 'verify-email')!.url,
    );
    link.searchParams.delete('callbackURL');
    await request(app.getHttpServer())
      .get(link.pathname + link.search)
      .expect(200);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email, password })
      .expect(200);
    return {
      id,
      cookie: (login.headers['set-cookie'] as unknown as string[])
        .map((value) => value.split(';')[0])
        .join('; '),
    };
  }
  const initiate = (actor: Actor, body: object, key?: string) => {
    const call = request(app.getHttpServer())
      .post('/api/v1/files/uploads')
      .set('Origin', origin)
      .set('Cookie', actor.cookie);
    if (key) call.set('Idempotency-Key', key);
    return call.send(body);
  };
  const complete = (actor: Actor, id: string, bytes: Buffer) =>
    request(app.getHttpServer())
      .post(`/api/v1/files/${id}/complete`)
      .set('Origin', origin)
      .set('Cookie', actor.cookie)
      .set('Content-Type', 'application/octet-stream')
      .send(bytes);
  const remove = (actor: Actor, id: string) =>
    request(app.getHttpServer())
      .delete('/api/v1/files/' + id)
      .set('Origin', origin)
      .set('Cookie', actor.cookie);
  const metadata = (bytes: Buffer) => ({
    filename: 'private document.txt',
    mimeType: 'text/plain' as const,
    expectedSize: bytes.length,
    sha256: hash(bytes),
  });
  async function upload(
    actor: Actor,
    bytes = Buffer.from('private file content'),
  ) {
    const initiated = await initiate(actor, metadata(bytes)).expect(201);
    return (await complete(actor, initiated.body.id, bytes).expect(200))
      .body as { id: string; download: { url: string } };
  }
  async function scope(actor: Actor) {
    return app.get(SpacesService).authorizePersonal({
      userId: actor.id,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    });
  }
  beforeEach(async () => {
    // Separate scenarios use distinct real-library limiter windows. Limits stay enabled.
    vi.spyOn(Date, 'now').mockReturnValue((clock += 61000));
    await fs.mkdir('.tools', { recursive: true });
    fixture = await fs.mkdtemp(path.resolve('.tools/storage-integration-'));
    root = path.join(fixture, 'private');
    app = await testApplication({ databaseUrl, environment: environment() });
    db = app.get(DatabaseService);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (db) {
      await db.client.securityAuditEvent.deleteMany({
        where: { actorUserId: { in: identities } },
      });
      await db.client.user.deleteMany({ where: { id: { in: identities } } });
    }
    await app?.close();
    identities.length = 0;
    if (
      !fixture.startsWith(path.resolve('.tools') + path.sep) ||
      !path.basename(fixture).startsWith('storage-integration-')
    )
      throw new Error('Unsafe file test cleanup');
    await fs.rm(fixture, { recursive: true, force: true });
  });

  it('streams a verified private file, persists across API recreation, renews links and deletes bytes', async () => {
    const a = await identity(),
      bytes = Buffer.from('private سلام\n');
    const stored = await upload(a, bytes);
    StoredFileSchema.parse(stored);
    const row = await db.client.storedFile.findUniqueOrThrow({
      where: { id: stored.id },
    });
    expect(row.actualSize).toBe(bytes.length);
    expect(row.sha256).toBe(hash(bytes));
    expect(row.status).toBe('READY');
    expect(JSON.stringify(stored)).not.toContain(row.objectKey);
    expect(JSON.stringify(stored)).not.toContain(root);
    const first = await request(app.getHttpServer())
      .get(stored.download.url)
      .set('Cookie', a.cookie)
      .expect(200);
    expect(first.body).toEqual(bytes);
    expect(first.headers['content-type']).toContain('application/octet-stream');
    expect(first.headers['content-disposition']).toMatch(/^attachment;/);
    expect(first.headers['x-content-type-options']).toBe('nosniff');
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.headers['content-security-policy']).toContain('sandbox');
    await app.close();
    app = await testApplication({ databaseUrl, environment: environment() });
    db = app.get(DatabaseService);
    const persisted = await request(app.getHttpServer())
      .get(stored.download.url)
      .set('Cookie', a.cookie)
      .expect(200);
    expect(persisted.body).toEqual(bytes);
    const retried = await request(app.getHttpServer())
      .post(`/api/v1/files/${stored.id}/complete`)
      .set('Origin', origin)
      .set('Cookie', a.cookie)
      .send({})
      .expect(200);
    expect(retried.body.sha256).toBe(hash(bytes));
    expect(
      (
        await db.client.storedFile.findUniqueOrThrow({
          where: { id: stored.id },
        })
      ).revision,
    ).toBe(row.revision);
    await remove(a, stored.id).expect(204);
    await remove(a, stored.id).expect(204);
    expect(await fs.readdir(root)).toEqual([]);
    await request(app.getHttpServer())
      .get(stored.download.url)
      .set('Cookie', a.cookie)
      .expect(404);
    const deleted = await db.client.storedFile.findUniqueOrThrow({
      where: { id: stored.id },
    });
    expect(deleted.status).toBe('DELETED');
    expect(deleted.purgedAt).not.toBeNull();
  });

  it('enforces verified sessions and own scope on completion, download, deletion, nested IDs and direct paths', async () => {
    const a = await identity(),
      b = await identity(),
      stored = await upload(a);
    for (const id of [stored.id, randomUUID()]) {
      await complete(b, id, Buffer.from('private file content')).expect(404);
      await remove(b, id).expect(404);
      const url = new URL(stored.download.url, origin);
      url.pathname = `/api/v1/files/${id}/download`;
      await request(app.getHttpServer())
        .get(url.pathname + url.search)
        .set('Cookie', b.cookie)
        .expect(404);
    }
    await request(app.getHttpServer()).get(stored.download.url).expect(401);
    await request(app.getHttpServer())
      .get(stored.download.url)
      .set('X-User-Id', a.id)
      .expect(401);
    const row = await db.client.storedFile.findUniqueOrThrow({
      where: { id: stored.id },
    });
    for (const url of [
      `/private/${row.objectKey}.blob`,
      `/files/${row.objectKey}.blob`,
      `/${encodeURIComponent(root)}/${row.objectKey}.blob`,
    ])
      await request(app.getHttpServer())
        .get(url)
        .set('Cookie', a.cookie)
        .expect(404);
    await initiate(a, {
      ...metadata(Buffer.from('abc')),
      spaceId: (await scope(b)).spaceId,
    }).expect(400);
    await db.client.user.update({
      where: { id: a.id },
      data: { emailVerified: false },
    });
    await request(app.getHttpServer())
      .get(stored.download.url)
      .set('Cookie', a.cookie)
      .expect(403);
    await db.client.user.update({
      where: { id: a.id },
      data: { emailVerified: true },
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/sign-out')
      .set('Origin', origin)
      .set('Cookie', a.cookie)
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .get(stored.download.url)
      .set('Cookie', a.cookie)
      .expect(401);
  });

  it('rejects invalid actual size, checksum, type and caller-supplied completion metadata', async () => {
    const a = await identity();
    for (const [input, bytes] of [
      [
        { filename: 'a.txt', mimeType: 'text/plain', expectedSize: 4 },
        Buffer.from('abc'),
      ],
      [
        {
          filename: 'a.txt',
          mimeType: 'text/plain',
          expectedSize: 3,
          sha256: 'a'.repeat(64),
        },
        Buffer.from('abc'),
      ],
      [
        { filename: 'a.png', mimeType: 'image/png', expectedSize: 3 },
        Buffer.from('abc'),
      ],
      [
        { filename: 'a.txt', mimeType: 'text/plain', expectedSize: 4 },
        Buffer.from('<svg'),
      ],
    ] as const) {
      const init = await initiate(a, input).expect(201);
      await complete(a, init.body.id, bytes).expect(400);
      expect(
        (
          await db.client.storedFile.findUniqueOrThrow({
            where: { id: init.body.id },
          })
        ).status,
      ).toBe('REJECTED');
    }
    const init = await initiate(a, metadata(Buffer.from('abc'))).expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/files/${init.body.id}/complete`)
      .set('Cookie', a.cookie)
      .set('Origin', origin)
      .send({ objectKey: randomUUID(), actualSize: 3 })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/files/${init.body.id}/complete`)
      .set('Cookie', a.cookie)
      .set('Origin', origin)
      .send({})
      .expect(409);
    await initiate(a, {
      ...metadata(Buffer.from('abc')),
      expectedSize: 2049,
    }).expect(413);
    await initiate(a, {
      ...metadata(Buffer.from('abc')),
      filename: '../secret.txt',
    }).expect(400);
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('deduplicates concurrent initiations and rejects changed fingerprints without leaking another actor receipt', async () => {
    const a = await identity(),
      b = await identity(),
      key = randomUUID(),
      data = metadata(Buffer.from('abc'));
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => initiate(a, data, key).expect(201)),
    );
    expect(new Set(responses.map((response) => response.body.id)).size).toBe(1);
    await initiate(a, { ...data, filename: 'different.txt' }, key).expect(409);
    const other = await initiate(b, data, key).expect(201);
    expect(other.body.id).not.toBe(responses[0]!.body.id);
    expect(
      await db.client.storedFile.count({ where: { ownerUserId: a.id } }),
    ).toBe(1);
  });

  it('permits one completion claim and safely cancels an in-flight upload', async () => {
    const a = await identity(),
      authorized = await scope(a),
      service = app.get(FilesService),
      bytes = Buffer.from('abcdef');
    const init = await service.initiate(authorized, metadata(bytes)),
      source = new PassThrough();
    const pending = service.complete(authorized, init.id, source);
    const settled = pending.catch((error) => error);
    for (let attempt = 0; attempt < 50; attempt++) {
      if (
        (
          await db.client.storedFile.findUniqueOrThrow({
            where: { id: init.id },
          })
        ).uploadAttemptId
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await expect(
      service.complete(authorized, init.id, Readable.from([bytes])),
    ).rejects.toThrow('Conflict');
    await service.delete(authorized, init.id);
    source.end(bytes);
    expect(await settled).toBeInstanceOf(Error);
    const row = await db.client.storedFile.findUniqueOrThrow({
      where: { id: init.id },
    });
    expect(row.status).toBe('DELETED');
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('cleans an aborted HTTP upload and a timed-out stream without exposing partial bytes', async () => {
    const a = await identity(),
      init = await initiate(a, {
        filename: 'a.txt',
        mimeType: 'text/plain',
        expectedSize: 100,
      }).expect(201);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    await new Promise<void>((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: `/api/v1/files/${init.body.id}/complete`,
          method: 'POST',
          headers: {
            Origin: origin,
            Cookie: a.cookie,
            'Content-Type': 'application/octet-stream',
            'Content-Length': '100',
          },
        },
        () => resolve(),
      );
      req.on('error', () => resolve());
      req.write('partial');
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 30);
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        (
          await db.client.storedFile.findUniqueOrThrow({
            where: { id: init.body.id },
          })
        ).status === 'REJECTED'
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(
      (
        await db.client.storedFile.findUniqueOrThrow({
          where: { id: init.body.id },
        })
      ).status,
    ).toBe('REJECTED');
    expect(await fs.readdir(root)).toEqual([]);
    const excess = await initiate(a, {
      filename: 'excess.txt',
      mimeType: 'text/plain',
      expectedSize: 3,
    }).expect(201);
    const overflow = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: `/api/v1/files/${excess.body.id}/complete`,
            method: 'POST',
            headers: {
              Origin: origin,
              Cookie: a.cookie,
              'Content-Type': 'application/octet-stream',
            },
          },
          (res) => {
            let body = '';
            res.on('data', (chunk) => {
              body += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode!, body }));
          },
        );
        req.on('error', reject);
        req.write('too-long');
        req.end();
      },
    );
    expect(overflow.status).toBe(413);
    expect(JSON.parse(overflow.body).error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(await fs.readdir(root)).toEqual([]);
    const service = app.get(FilesService),
      authorized = await scope(a),
      second = await service.initiate(authorized, {
        filename: 'timeout.txt',
        mimeType: 'text/plain',
        expectedSize: 5,
      });
    await expect(
      service.complete(authorized, second.id, new PassThrough()),
    ).rejects.toThrow();
    expect(
      (
        await db.client.storedFile.findUniqueOrThrow({
          where: { id: second.id },
        })
      ).status,
    ).toBe('REJECTED');
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('retains READY bytes after an ambiguous commit response and reconciles crash leftovers without touching live/foreign files', async () => {
    const a = await identity(),
      authorized = await scope(a),
      service = app.get(FilesService),
      repository = app.get(FilesRepository),
      data = Buffer.from('abc');
    const init = await service.initiate(authorized, metadata(data));
    const original = repository.ready.bind(repository);
    const commit = vi
      .spyOn(repository, 'ready')
      .mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new StorageFailure('UNAVAILABLE');
      });
    await expect(
      service.complete(authorized, init.id, Readable.from([data])),
    ).rejects.toThrow('Service Unavailable');
    commit.mockRestore();
    const row = await db.client.storedFile.findUniqueOrThrow({
      where: { id: init.id },
    });
    expect(row.status).toBe('READY');
    expect(await fs.readFile(path.join(root, row.objectKey + '.blob'))).toEqual(
      data,
    );
    const abandoned = await service.initiate(authorized, metadata(data)),
      attemptId = randomUUID();
    await db.client.storedFile.update({
      where: { id: abandoned.id },
      data: {
        createdAt: new Date(Date.now() - 7200000),
        uploadExpiresAt: new Date(Date.now() - 3600000),
        uploadAttemptId: attemptId,
        uploadStartedAt: new Date(Date.now() - 3600000),
      },
    });
    const stale = await db.client.storedFile.findUniqueOrThrow({
      where: { id: abandoned.id },
    });
    await fs.writeFile(
      path.join(root, `${stale.objectKey}.${attemptId}.part`),
      'orphan',
    );
    const active = await service.initiate(authorized, metadata(data));
    const b = await identity(),
      foreignScope = await scope(b),
      foreign = await service.initiate(foreignScope, metadata(data));
    await db.client.storedFile.update({
      where: { id: foreign.id },
      data: {
        createdAt: new Date(Date.now() - 7200000),
        uploadExpiresAt: new Date(Date.now() - 3600000),
      },
    });
    expect(await service.reconcileIncomplete(authorized)).toEqual({
      cleaned: 1,
    });
    expect(await service.reconcileIncomplete(authorized)).toEqual({
      cleaned: 0,
    });
    expect(
      (
        await db.client.storedFile.findUniqueOrThrow({
          where: { id: active.id },
        })
      ).status,
    ).toBe('INITIATED');
    expect(await fs.readFile(path.join(root, row.objectKey + '.blob'))).toEqual(
      data,
    );
    expect(
      (
        await db.client.storedFile.findUniqueOrThrow({
          where: { id: foreign.id },
        })
      ).status,
    ).toBe('INITIATED');
  });

  it('hides corrupt/missing bytes and permits safe retry after physical delete failure', async () => {
    const a = await identity(),
      stored = await upload(a),
      row = await db.client.storedFile.findUniqueOrThrow({
        where: { id: stored.id },
      });
    await fs.writeFile(
      path.join(root, row.objectKey + '.blob'),
      Buffer.alloc(row.actualSize!, 97),
    );
    const bad = await request(app.getHttpServer())
      .get(stored.download.url)
      .set('Cookie', a.cookie)
      .expect(503);
    expect(JSON.stringify(bad.body)).not.toContain(root);
    const port = app.get<StoragePort>(STORAGE_PORT),
      removeSpy = vi
        .spyOn(port, 'remove')
        .mockRejectedValueOnce(new StorageFailure('UNAVAILABLE'));
    await remove(a, stored.id).expect(503);
    expect(
      (
        await db.client.storedFile.findUniqueOrThrow({
          where: { id: stored.id },
        })
      ).status,
    ).toBe('DELETED');
    await request(app.getHttpServer())
      .get(stored.download.url)
      .set('Cookie', a.cookie)
      .expect(404);
    removeSpy.mockRestore();
    await remove(a, stored.id).expect(204);
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('requires current owner sessions plus untampered unexpired links, trusted origins and bounded inputs', async () => {
    const a = await identity(),
      stored = await upload(a),
      url = new URL(stored.download.url, origin);
    url.searchParams.set('signature', '0'.repeat(64));
    await request(app.getHttpServer())
      .get(url.pathname + url.search)
      .set('Cookie', a.cookie)
      .expect(403);
    url.searchParams.set('expires', '1700000000');
    await request(app.getHttpServer())
      .get(url.pathname + url.search)
      .set('Cookie', a.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(url.pathname)
      .set('Cookie', a.cookie)
      .expect(400);
    clock += 301000;
    vi.mocked(Date.now).mockReturnValue(clock);
    await request(app.getHttpServer())
      .get(stored.download.url)
      .set('Cookie', a.cookie)
      .expect(403);
    const renewed = await request(app.getHttpServer())
      .post(`/api/v1/files/${stored.id}/complete`)
      .set('Origin', origin)
      .set('Cookie', a.cookie)
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .get(renewed.body.download.url)
      .set('Cookie', a.cookie)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/files/uploads')
      .set('Cookie', a.cookie)
      .send(metadata(Buffer.from('abc')))
      .expect(403);
    await request(app.getHttpServer())
      .delete('/api/v1/files/' + stored.id)
      .set('Cookie', a.cookie)
      .set('Origin', 'https://untrusted.invalid')
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/files/uploads')
      .set('Cookie', a.cookie)
      .set('Origin', origin)
      .send({ filename: 'x'.repeat(140000) })
      .expect(413);
    const cors = await request(app.getHttpServer())
      .options('/api/v1/files/' + stored.id)
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'DELETE')
      .expect(204);
    expect(cors.headers['access-control-allow-methods']).toContain('DELETE');
  });

  it('rate limits the verified actor despite spoofed forwarding headers and emits metadata-only audits', async () => {
    const a = await identity(),
      body = metadata(Buffer.from('private'));
    for (let index = 0; index < 20; index++)
      await initiate(a, body)
        .set('X-Forwarded-For', '192.0.2.' + index)
        .expect(201);
    const limited = await initiate(a, body)
      .set('X-Forwarded-For', '198.51.100.1')
      .expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    const audit = await db.client.securityAuditEvent.findMany({
      where: { actorUserId: a.id, action: 'FILE_INITIATE' },
    });
    expect(audit).toHaveLength(20);
    expect(audit.every((row) => row.resourceId !== null)).toBe(true);
    expect(JSON.stringify(audit)).not.toMatch(
      /private document|private-file|signature=|objectKey|password|filename/,
    );
  });

  it('enforces ownership, state and immutable receipt evidence with database constraints and audit failure rollback', async () => {
    const a = await identity(),
      b = await identity(),
      aScope = await scope(a),
      bScope = await scope(b),
      service = app.get(FilesService);
    const stored = await upload(a);
    const openSpy = vi.spyOn(app.get<StoragePort>(STORAGE_PORT), 'open');
    const spy = vi
      .spyOn(app.get(AuditService), 'record')
      .mockRejectedValueOnce(new Error('fixture download audit failure'));
    await request(app.getHttpServer())
      .get(stored.download.url)
      .set('Cookie', a.cookie)
      .expect(500);
    expect(openSpy).not.toHaveBeenCalled();
    spy.mockRestore();
    openSpy.mockRestore();
    await remove(a, stored.id).expect(204);
    const input = {
      id: randomUUID(),
      objectKey: randomUUID(),
      spaceId: bScope.spaceId,
      ownerUserId: a.id,
      filename: 'fixture.txt',
      mimeType: 'text/plain',
      expectedSize: 3,
      uploadExpiresAt: new Date(Date.now() + 100000),
    };
    await expect(
      db.client.storedFile.create({ data: input }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      db.client.storedFile.create({
        data: {
          ...input,
          id: randomUUID(),
          objectKey: randomUUID(),
          spaceId: aScope.spaceId,
          status: 'READY',
        },
      }),
    ).rejects.toThrow();
    const init = await service.initiate(aScope, metadata(Buffer.from('abc')));
    const txAudit = vi
      .spyOn(app.get(FilesRepository), 'ready')
      .mockRejectedValueOnce(new StorageFailure('UNAVAILABLE'));
    await expect(
      service.complete(aScope, init.id, Readable.from([Buffer.from('abc')])),
    ).rejects.toThrow();
    txAudit.mockRestore();
    expect(
      (await db.client.storedFile.findUniqueOrThrow({ where: { id: init.id } }))
        .status,
    ).toBe('REJECTED');
    expect(await fs.readdir(root)).toEqual([]);
  });
});
