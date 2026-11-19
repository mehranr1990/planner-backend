import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import type { Readable } from 'node:stream';
import type { AppConfig } from '../../bootstrap/environment.js';
import type {
  MalwareScannerPort,
  MalwareScanResult,
} from './malware-scanner.port.js';

type ClamAvConfig = Pick<
  AppConfig,
  | 'CLAMAV_HOST'
  | 'CLAMAV_PORT'
  | 'MALWARE_SCAN_TIMEOUT_MS'
  | 'MALWARE_SCAN_MAX_BYTES'
  | 'MALWARE_SIGNATURE_MAX_AGE_HOURS'
>;
type Failure = Exclude<MalwareScanResult['verdict'], 'CLEAN' | 'INFECTED'>;
class ScanFault extends Error {
  constructor(readonly verdict: Failure) {
    super('Malware scan failed');
  }
}
const months = 'JanFebMarAprMayJunJulAugSepOctNovDec';
/** clamd VERSION: "ClamAV 1.4.3/27456/Wed Nov 18 09:24:01 2026" (daemon time, UTC in the image). */
export function signatureTime(reply: string): number | null {
  const m =
    /^ClamAV [^/]+\/\d+\/\w{3} (\w{3}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(
      reply.trim(),
    );
  const month = m ? months.indexOf(m[1]!) : -1;
  if (!m || month < 0 || month % 3) return null;
  return Date.UTC(+m[6]!, month / 3, +m[2]!, +m[3]!, +m[4]!, +m[5]!);
}
function send(socket: Socket, bytes: Uint8Array) {
  return new Promise<void>((resolve, reject) => {
    if (socket.destroyed) return reject(new ScanFault('ERROR'));
    socket.write(bytes, (error) =>
      error ? reject(new ScanFault('ERROR')) : resolve(),
    );
  });
}

/** Self-hosted clamd over its private TCP INSTREAM protocol. Fails closed. */
export class ClamAvScanner implements MalwareScannerPort {
  private freshUntil = 0;
  private engine = '';
  constructor(
    private readonly config: ClamAvConfig,
    private readonly now: () => number = Date.now,
  ) {}
  private exchange(
    signal: AbortSignal | undefined,
    write: (socket: Socket) => Promise<void>,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({
        host: this.config.CLAMAV_HOST,
        port: this.config.CLAMAV_PORT,
      });
      let reply = Buffer.alloc(0),
        connected = false,
        settled = false;
      const finish = (error: ScanFault | null, text = '') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
        socket.destroy();
        if (error) reject(error);
        else resolve(text);
      };
      const timer = setTimeout(
        () => finish(new ScanFault('TIMEOUT')),
        this.config.MALWARE_SCAN_TIMEOUT_MS,
      );
      const aborted = () => finish(new ScanFault('ERROR'));
      if (signal?.aborted) return aborted();
      signal?.addEventListener('abort', aborted, { once: true });
      socket.on('error', () =>
        finish(new ScanFault(connected ? 'ERROR' : 'UNAVAILABLE')),
      );
      socket.on('close', () => finish(new ScanFault('ERROR')));
      socket.on('data', (data: Buffer) => {
        reply = Buffer.concat([reply, data]);
        const end = reply.indexOf(0);
        if (end >= 0) finish(null, reply.toString('utf8', 0, end));
        else if (reply.length > 1024) finish(new ScanFault('ERROR'));
      });
      socket.once('connect', () => {
        connected = true;
        write(socket).catch((error: unknown) =>
          finish(error instanceof ScanFault ? error : new ScanFault('ERROR')),
        );
      });
    });
  }
  /** Signature freshness policy: stale or unknown databases are unusable. */
  private async fresh(signal?: AbortSignal) {
    if (this.now() < this.freshUntil) return;
    const reply = await this.exchange(signal, (socket) =>
      send(socket, Buffer.from('zVERSION\0')),
    );
    const built = signatureTime(reply);
    const maxAge = this.config.MALWARE_SIGNATURE_MAX_AGE_HOURS * 3_600_000;
    if (built === null || this.now() - built > maxAge)
      throw new ScanFault('UNAVAILABLE');
    this.engine = reply.trim().slice(0, 200);
    this.freshUntil = Math.min(this.now() + 60_000, built + maxAge);
  }
  async scan(
    content: Readable,
    size: number,
    signal?: AbortSignal,
  ): Promise<MalwareScanResult> {
    if (size > this.config.MALWARE_SCAN_MAX_BYTES) return { verdict: 'LIMIT' };
    try {
      await this.fresh(signal);
      const reply = await this.exchange(signal, async (socket) => {
        await send(socket, Buffer.from('zINSTREAM\0'));
        let sent = 0;
        for await (const value of content) {
          const chunk = Buffer.isBuffer(value)
            ? value
            : Buffer.from(value as Uint8Array);
          if (!chunk.length) continue;
          sent += chunk.length;
          if (sent > size) throw new ScanFault('ERROR');
          const header = Buffer.alloc(4);
          header.writeUInt32BE(chunk.length);
          await send(socket, Buffer.concat([header, chunk]));
        }
        if (sent !== size) throw new ScanFault('ERROR');
        await send(socket, Buffer.alloc(4));
      });
      if (reply === 'stream: OK')
        return { verdict: 'CLEAN', engine: this.engine };
      if (/size limit exceeded/i.test(reply)) return { verdict: 'LIMIT' };
      const found = /^stream: (\S+) FOUND$/.exec(reply);
      if (!found) return { verdict: 'ERROR' };
      // AlertExceedsMax reports unscanned remainder as a heuristic, never clean.
      if (found[1]!.startsWith('Heuristics.Limits.Exceeded'))
        return { verdict: 'LIMIT' };
      return { verdict: 'INFECTED', signature: found[1]! };
    } catch (error) {
      return { verdict: error instanceof ScanFault ? error.verdict : 'ERROR' };
    }
  }
}
