import 'reflect-metadata';
import { expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { SharedControl } from './shared-control.js';
import { parseEnvironment } from '../../bootstrap/environment.js';
import {
  assertFileContentAvailable,
  BusinessFileStorage,
} from './file-content-policy.js';
import { SharedFiles } from './public/shared-files.js';
import type { SharedFileScope } from './public/shared-files.js';
import { FileCatalog } from './public/file-catalog.js';
import { FilesService } from './files.service.js';
import type { Prisma, StoredFile } from '../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../authorization/authorized-space.js';

const config = parseEnvironment({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://localhost/mehran_dev',
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'unit-test-only-secret-at-least-32-characters',
  SHARED_LOCAL_DEVELOPMENT_TEST_MODE: 'true',
});
it('retains real signed independent control IO while business file bytes are blocked', async () => {
  const root = fs.mkdtempSync(path.resolve('.tools/local-shared-control-'));
  try {
    const controlConfig = parseEnvironment({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost/mehran_dev',
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'unit-test-only-secret-at-least-32-characters',
      SHARED_LOCAL_DEVELOPMENT_TEST_MODE: 'true',
      STORAGE_ROOT: path.join(root, 'files'),
      ERASURE_CONTROL_ROOT: path.join(root, 'erasure'),
      SHARED_CONTROL_ROOT: path.join(root, 'control'),
      SHARED_CONTROL_KEYS: JSON.stringify({
        local: randomBytes(48).toString('base64url'),
      }),
      SHARED_CONTROL_ACTIVE_KEY_ID: 'local',
    });
    const control = new SharedControl(controlConfig);
    await control.initialize();
    expect(await control.currentEvidence()).toEqual({
      records: [],
      floor: '1970-01-01T00:00:00.000Z',
    });
    await expect(
      new BusinessFileStorage(controlConfig).open('unused', {
        size: 1,
        sha256: 'a'.repeat(64),
      }),
    ).rejects.toHaveProperty('status', 403);
  } finally {
    if (!root.startsWith(path.resolve('.tools') + path.sep))
      throw new Error('Invalid owned fixture path');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
it('blocks business byte reads/writes before IO, without inventing any scan result', async () => {
  const storage = new BusinessFileStorage(config);
  await expect(
    storage.write(
      'unused',
      'unused',
      Readable.from('x'),
      { size: 1, mimeType: 'text/plain' },
      new AbortController().signal,
    ),
  ).rejects.toHaveProperty('status', 403);
  await expect(
    storage.open('unused', { size: 1, sha256: 'a'.repeat(64) }),
  ).rejects.toHaveProperty('status', 403);
  expect(() =>
    assertFileContentAvailable({
      ...config,
      SHARED_LOCAL_DEVELOPMENT_TEST_MODE: false,
    }),
  ).not.toThrow();
});
it('blocks Shared admission, READY publication and existing-file references without querying or mutating rows', async () => {
  const files = new SharedFiles(
      {} as ConstructorParameters<typeof SharedFiles>[0],
      config,
    ),
    verify = vi.fn(),
    scope = { verify } as unknown as SharedFileScope,
    tx = {} as Prisma.TransactionClient;
  await expect(
    files.initiate(
      tx,
      scope,
      'unused',
      { filename: 'x.txt', mimeType: 'text/plain', expectedSize: 1 },
      new Date(),
    ),
  ).rejects.toHaveProperty('status', 403);
  await expect(
    files.ready(
      tx,
      scope,
      {} as Parameters<SharedFiles['ready']>[2],
      { size: 1, sha256: 'a'.repeat(64) },
      new Date(),
    ),
  ).rejects.toHaveProperty('status', 403);
  await expect(files.row(tx, scope, 'unused')).rejects.toHaveProperty(
    'status',
    403,
  );
  await expect(
    files.describeMany(tx, scope, ['unused']),
  ).rejects.toHaveProperty('status', 403);
  await expect(
    files.open({
      status: 'READY',
      actualSize: 1,
      sha256: 'a'.repeat(64),
    } as StoredFile),
  ).rejects.toHaveProperty('status', 403);
  expect(verify).toHaveBeenCalledTimes(4);
  const denied = {
    verify: () => {
      throw new Error('Current authority denied');
    },
  } as unknown as SharedFileScope;
  await expect(files.row(tx, denied, 'unused')).rejects.toThrow(
    'Current authority denied',
  );
});
it('blocks attaching existing Personal files through the catalog', async () => {
  const catalog = new FileCatalog(config),
    tx = {} as Prisma.TransactionClient,
    scope = {} as AuthorizedSpace;
  await expect(
    catalog.requireReady(tx, scope, 'unused'),
  ).rejects.toHaveProperty('status', 403);
  await expect(catalog.describe(tx, scope, ['unused'])).rejects.toHaveProperty(
    'status',
    403,
  );
});
it('blocks Personal upload finalization and existing READY retries/downloads before writes or audit success', async () => {
  const repository = {
      owned: vi
        .fn()
        .mockResolvedValue({ mimeType: 'text/plain', status: 'READY' }),
    },
    dependencies = [
      repository,
      {},
      config,
      {},
    ] as unknown as ConstructorParameters<typeof FilesService>,
    files = new FilesService(...dependencies),
    scope = {} as AuthorizedSpace;
  await expect(
    files.initiate(scope, {
      filename: 'x.txt',
      mimeType: 'text/plain',
      expectedSize: 1,
    }),
  ).rejects.toHaveProperty('status', 403);
  await expect(
    files.complete(scope, 'unused', Readable.from('x')),
  ).rejects.toHaveProperty('status', 403);
  await expect(files.retryComplete(scope, 'unused')).rejects.toHaveProperty(
    'status',
    403,
  );
  await expect(
    files.download(
      scope,
      'unused',
      {} as Parameters<FilesService['download']>[2],
    ),
  ).rejects.toHaveProperty('status', 403);
  expect(repository.owned).toHaveBeenCalledTimes(3);
});
