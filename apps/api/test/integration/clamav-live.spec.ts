import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { ClamAvScanner } from '../../src/platform/storage/clamav-scanner.js';
import { EICAR } from '../support/malware-scanner-double.js';

// LIVE ClamAV smoke check. Runs only against a real clamd, e.g.
// CLAMAV_SMOKE_HOST=127.0.0.1 CLAMAV_SMOKE_PORT=3310 pnpm test:integration clamav-live
const host = process.env.CLAMAV_SMOKE_HOST;
describe.skipIf(!host)('live clamd smoke', () => {
  const scanner = new ClamAvScanner({
    CLAMAV_HOST: host ?? '',
    CLAMAV_PORT: Number(process.env.CLAMAV_SMOKE_PORT ?? 3310),
    MALWARE_SCAN_TIMEOUT_MS: 30000,
    MALWARE_SCAN_MAX_BYTES: 67108864,
    MALWARE_SIGNATURE_MAX_AGE_HOURS: 48,
  });
  const scan = (text: string) =>
    scanner.scan(Readable.from([Buffer.from(text)]), Buffer.byteLength(text));
  it('returns CLEAN for a clean file and INFECTED for EICAR', async () => {
    await expect(scan('clean planner smoke file')).resolves.toMatchObject({
      verdict: 'CLEAN',
    });
    await expect(scan(EICAR)).resolves.toMatchObject({ verdict: 'INFECTED' });
  });
});
