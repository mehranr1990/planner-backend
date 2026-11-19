import { afterEach, beforeEach, expect, it } from 'vitest';
import { createServer } from 'node:net';
import type { AddressInfo, Server } from 'node:net';
import { Readable } from 'node:stream';
import { ClamAvScanner, signatureTime } from './clamav-scanner.js';

// Protocol-level fake clamd (test double). Live ClamAV is a separate smoke check.
const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const now = Date.UTC(2026, 10, 19, 12);
let server: Server,
  port = 0,
  mode = 'ok',
  version = 'ClamAV 1.4.3/27456/Thu Nov 19 06:00:00 2026',
  received: Buffer[] = [],
  connections = 0;

beforeEach(async () => {
  mode = 'ok';
  version = 'ClamAV 1.4.3/27456/Thu Nov 19 06:00:00 2026';
  received = [];
  connections = 0;
  server = createServer((socket) => {
    connections++;
    let input = Buffer.alloc(0);
    socket.on('error', () => undefined);
    socket.on('data', (data) => {
      input = Buffer.concat([input, data]);
      if (input.subarray(0, 9).toString() === 'zVERSION\0')
        return void socket.end(`${version}\0`);
      if (input.subarray(0, 10).toString() !== 'zINSTREAM\0') return;
      if (mode === 'hang') return;
      const body: Buffer[] = [];
      for (let at = 10; at + 4 <= input.length;) {
        const size = input.readUInt32BE(at);
        if (!size) {
          const bytes = Buffer.concat(body);
          received.push(bytes);
          const reply =
            mode === 'garbage'
              ? 'what?'
              : mode === 'limit'
                ? 'INSTREAM size limit exceeded. ERROR'
                : mode === 'exceeded'
                  ? 'stream: Heuristics.Limits.Exceeded.MaxFileSize FOUND'
                  : bytes.includes(EICAR)
                    ? 'stream: Win.Test.EICAR_HDB-1 FOUND'
                    : 'stream: OK';
          return void socket.end(`${reply}\0`);
        }
        if (at + 4 + size > input.length) return;
        body.push(input.subarray(at + 4, at + 4 + size));
        at += 4 + size;
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const scanner = (overrides: Record<string, number> = {}) =>
  new ClamAvScanner(
    {
      CLAMAV_HOST: '127.0.0.1',
      CLAMAV_PORT: port,
      MALWARE_SCAN_TIMEOUT_MS: 500,
      MALWARE_SCAN_MAX_BYTES: 1024 * 1024,
      MALWARE_SIGNATURE_MAX_AGE_HOURS: 48,
      ...overrides,
    },
    () => now,
  );
const content = (text: string | Buffer) =>
  Readable.from([Buffer.from(text)], { objectMode: false });

it('reports CLEAN only for a clean INSTREAM reply over the exact bytes', async () => {
  const bytes = Buffer.alloc(200_000, 7);
  await expect(
    scanner().scan(
      Readable.from([bytes.subarray(0, 70_000), bytes.subarray(70_000)]),
      bytes.length,
    ),
  ).resolves.toEqual({
    verdict: 'CLEAN',
    engine: 'ClamAV 1.4.3/27456/Thu Nov 19 06:00:00 2026',
  });
  expect(received[0]!.equals(bytes)).toBe(true);
});
it('reports the EICAR test file as INFECTED with the engine signature', async () => {
  await expect(scanner().scan(content(EICAR), EICAR.length)).resolves.toEqual({
    verdict: 'INFECTED',
    signature: 'Win.Test.EICAR_HDB-1',
  });
});
it('fails closed when clamd is offline', async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await expect(scanner().scan(content('x'), 1)).resolves.toEqual({
    verdict: 'UNAVAILABLE',
  });
  server = createServer().listen(0);
});
it('times out a stalled scan', async () => {
  mode = 'hang';
  await expect(scanner().scan(content('x'), 1)).resolves.toEqual({
    verdict: 'TIMEOUT',
  });
});
it('refuses oversized content before connecting and maps clamd limits to LIMIT', async () => {
  await expect(
    scanner({ MALWARE_SCAN_MAX_BYTES: 4 }).scan(content('12345'), 5),
  ).resolves.toEqual({ verdict: 'LIMIT' });
  expect(connections).toBe(0);
  mode = 'limit';
  await expect(
    scanner().scan(content(Buffer.alloc(300_000)), 300_000),
  ).resolves.toEqual({ verdict: 'LIMIT' });
  mode = 'exceeded';
  await expect(scanner().scan(content('x'), 1)).resolves.toEqual({
    verdict: 'LIMIT',
  });
});
it('treats unknown replies and size mismatches as scan errors', async () => {
  mode = 'garbage';
  await expect(scanner().scan(content('x'), 1)).resolves.toEqual({
    verdict: 'ERROR',
  });
  mode = 'ok';
  await expect(scanner().scan(content('xy'), 1)).resolves.toEqual({
    verdict: 'ERROR',
  });
  await expect(scanner().scan(content('x'), 2)).resolves.toEqual({
    verdict: 'ERROR',
  });
});
it('refuses stale or unknown signature databases and caches fresh ones briefly', async () => {
  version = 'ClamAV 1.4.3/27400/Mon Nov 16 06:00:00 2026';
  await expect(scanner().scan(content('x'), 1)).resolves.toEqual({
    verdict: 'UNAVAILABLE',
  });
  version = 'ClamAV 1.4.3';
  await expect(scanner().scan(content('x'), 1)).resolves.toEqual({
    verdict: 'UNAVAILABLE',
  });
  version = 'ClamAV 1.4.3/27456/Thu Nov 19 06:00:00 2026';
  const fresh = scanner();
  await fresh.scan(content('x'), 1);
  await fresh.scan(content('y'), 1);
  expect(connections).toBe(2 + 3);
  expect(signatureTime('ClamAV 1.4.3/1/Thu Nov  5 01:02:03 2026')).toBe(
    Date.UTC(2026, 10, 5, 1, 2, 3),
  );
});
it('stops on caller abort', async () => {
  mode = 'hang';
  const abort = new AbortController();
  const pending = scanner({ MALWARE_SCAN_TIMEOUT_MS: 5000 }).scan(
    content('x'),
    1,
    abort.signal,
  );
  setTimeout(() => abort.abort(), 20);
  await expect(pending).resolves.toEqual({ verdict: 'ERROR' });
});
