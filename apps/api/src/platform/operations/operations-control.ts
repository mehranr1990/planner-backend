import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  lstat,
  mkdir,
  readFile,
  writeFile,
  rename,
  realpath,
  open,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MaintenanceValueSchema } from '@mehran/api-contracts';
import {
  maintenanceBlocks,
  type TrafficBinding,
} from '../configuration/traffic.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import { PersonalEvidenceKeys } from '../lifecycle/personal-evidence-keys.js';
const Status = z.strictObject({
  version: z.literal(1),
  state: z.enum(['MAINTENANCE', 'RESTORING', 'VERIFYING', 'READY', 'FAILED']),
  runId: z.uuid(),
  updatedAt: z.iso.datetime(),
  message: z.string().max(160),
  maintenance: MaintenanceValueSchema.optional(),
});
@Injectable()
export class OperationsControl {
  private readonly root: string | undefined;
  private readonly keys: PersonalEvidenceKeys;
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.root = config.OPERATIONS_CONTROL_ROOT
      ? path.resolve(config.OPERATIONS_CONTROL_ROOT)
      : undefined;
    this.keys = new PersonalEvidenceKeys(config);
  }
  private async location(create = false) {
    if (!this.root)
      throw new Error('Independent operational control is not configured');
    if (create) await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (let current = this.root; ; current = path.dirname(current)) {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error('Unsafe control directory');
      if (path.dirname(current) === current) break;
    }
    if ((await realpath(this.root)) !== this.root)
      throw new Error('Unsafe control directory');
    return path.join(this.root, 'status.json');
  }
  async status() {
    if (!this.root) return null;
    const file = await this.location(),
      stat = await lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size > 32768
    )
      throw new Error('Invalid independent status');
    const envelope = z
      .strictObject({
        body: z.string().max(30000),
        version: z.union([z.literal(1), z.literal(2)]),
        keyId: z.string().optional(),
        signature: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(JSON.parse(await readFile(file, 'utf8')));
    this.keys.verify(
      'control',
      envelope.body,
      envelope,
      'operational-status-v1:',
    );
    return Status.parse(JSON.parse(envelope.body));
  }
  async assert(action?: TrafficBinding) {
    try {
      const status = await this.status();
      if (status && status.state !== 'READY') {
        if (
          status.state !== 'MAINTENANCE' ||
          !status.maintenance ||
          !action ||
          maintenanceBlocks(
            status.maintenance.mode,
            status.maintenance.bindings,
            action,
          )
        )
          throw new Error();
      }
    } catch {
      throw new ServiceUnavailableException({
        code: 'OPERATIONAL_MAINTENANCE',
      });
    }
  }
  /** Operator-only independent status. Countdown/time never reopens access. */
  async restrict(
    runId: string,
    maintenance?: z.infer<typeof MaintenanceValueSchema>,
  ) {
    await this.locked(async () => {
      const prior = await this.status().catch(() => null);
      if (!prior) {
        await this.writeUnlocked('FAILED', runId);
        return;
      }
      if (['RESTORING', 'VERIFYING', 'FAILED'].includes(prior.state))
        throw new Error(
          'Recovery control cannot be replaced by emergency policy',
        );
      if (
        prior.state === 'MAINTENANCE' &&
        maintenance &&
        (maintenance.mode !== 'FULL' || maintenance.bindings.length)
      )
        throw new Error(
          'Unknown/existing maintenance can only be escalated to global Full Maintenance offline',
        );
      await this.writeUnlocked('MAINTENANCE', runId, maintenance);
    });
  }
  async recover(runId: string, checks: () => Promise<void>) {
    await this.locked(async () => {
      const prior = await this.status();
      if (!prior || prior.state !== 'MAINTENANCE' || prior.runId !== runId)
        throw new Error('Independent recovery identity/state mismatch');
      await checks();
      await this.writeUnlocked('READY', runId);
    });
  }
  private async locked<T>(work: () => Promise<T>) {
    const file = await this.location(true),
      lock = await open(file + '.lock', 'wx', 0o600);
    try {
      return await work();
    } finally {
      await lock.close();
      await unlink(file + '.lock');
    }
  }
  async write(
    state: z.infer<typeof Status>['state'],
    runId: string,
    maintenance?: z.infer<typeof MaintenanceValueSchema>,
  ) {
    await this.locked(() => this.writeUnlocked(state, runId, maintenance));
  }
  private async writeUnlocked(
    state: z.infer<typeof Status>['state'],
    runId: string,
    maintenance?: z.infer<typeof MaintenanceValueSchema>,
  ) {
    const file = await this.location(true),
      body = JSON.stringify(
        Status.parse({
          version: 1,
          state,
          runId,
          updatedAt: new Date().toISOString(),
          message:
            state === 'READY'
              ? 'Replay and readiness verified'
              : 'Operator recovery in progress',
          ...(maintenance
            ? { maintenance: MaintenanceValueSchema.parse(maintenance) }
            : {}),
        }),
      ),
      temporary = file + '.' + randomUUID() + '.part';
    const envelope = JSON.stringify({
      body,
      ...this.keys.sign('control', body, 'operational-status-v1:'),
    });
    if (Buffer.byteLength(envelope, 'utf8') > 32768)
      throw new Error('Independent status exceeds its byte budget');
    await writeFile(temporary, envelope, {
      flag: 'wx',
      mode: 0o600,
      flush: true,
    });
    await rename(temporary, file);
    // Match private control-store durability: persist the rename on Linux.
    // Windows does not expose portable directory fsync through Node.
    if (process.platform !== 'win32') {
      const directory = await open(this.root!, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  }
}
