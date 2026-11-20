// Live clamd smoke (ADR 0068): clean bytes -> CLEAN, EICAR -> INFECTED.
// Runs in the ops container on the private scanner network:
//   sh deploy/planner-compose.sh run --rm --no-deps ops node deploy/clamav/smoke.mjs
import { Readable } from 'node:stream';
import { ClamAvScanner } from '../../apps/api/dist/platform/storage/clamav-scanner.js';

const scanner = new ClamAvScanner({
  CLAMAV_HOST: process.env.CLAMAV_HOST ?? 'clamav',
  CLAMAV_PORT: Number(process.env.CLAMAV_PORT ?? 3310),
  MALWARE_SCAN_TIMEOUT_MS: 30000,
  MALWARE_SCAN_MAX_BYTES: 67108864,
  MALWARE_SIGNATURE_MAX_AGE_HOURS: Number(
    process.env.MALWARE_SIGNATURE_MAX_AGE_HOURS ?? 48,
  ),
});
// Assembled at runtime so no repository file holds the EICAR byte string.
const eicar = [
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$',
  'EICAR-STANDARD-ANTIVIRUS',
  '-TEST-FILE!$H+H*',
].join('');
const scan = (text) =>
  scanner.scan(Readable.from([Buffer.from(text)]), Buffer.byteLength(text));

const clean = await scan('clean planner smoke file');
const infected = await scan(eicar);
process.stdout.write(
  `clean=${clean.verdict} eicar=${infected.verdict} engine=${clean.engine ?? 'n/a'}\n`,
);
if (clean.verdict !== 'CLEAN' || infected.verdict !== 'INFECTED') {
  process.stderr.write('FAIL: clamd smoke verdicts unexpected\n');
  process.exitCode = 1;
} else process.stdout.write('PASS: live clamd clean/EICAR smoke\n');
