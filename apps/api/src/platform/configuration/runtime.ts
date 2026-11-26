import {
  Injectable,
  Inject,
  ForbiddenException,
  ServiceUnavailableException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  ConfigurationPayloadSchema,
  MaintenanceValueSchema,
  type ConfigurationContext,
} from '@mehran/api-contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  ConfigurationCore,
  effectiveConfiguration,
  configurationVersionEligible,
} from './configuration-core.js';
import { OperationsControl } from '../operations/operations-control.js';
import { maintenanceBlocks, type TrafficBinding } from './traffic.js';
import { configurationAction } from './action-context.js';
/** Restriction only. Callers must establish their own current resource authority first. */
export async function assertRuntimeConfiguration(
  tx: Prisma.TransactionClient,
  context: ConfigurationContext,
  action: TrafficBinding,
) {
  // Publication/kill/release increments this row before commit. Holding a share
  // lock orders an already-admitted mutation before a concurrent policy change.
  const [epoch] = await tx.$queryRaw<
    { generation: bigint }[]
  >`SELECT generation FROM "PlatformConfigEpoch" WHERE id='GLOBAL' FOR SHARE`;
  if (!epoch)
    throw new ServiceUnavailableException({
      code: 'CONFIGURATION_UNAVAILABLE',
    });
  if (epoch.generation === 1n) return;
  const maintenance = await tx.platformConfigVersion.findMany({
    where: {
      r_definitionId: { key: 'platform.maintenance' },
      startsAt: { lte: new Date() },
      r_PlatformMaintenanceRelease_versionId: { none: {} },
      r_PlatformConfigEvent_versionId: { none: { kind: 'ACTIVATION_DENIED' } },
    },
    take: 100,
  });
  for (const v of maintenance) {
    if (!(await configurationVersionEligible(tx, v))) continue;
    const m = MaintenanceValueSchema.parse(
      ConfigurationPayloadSchema.parse(v.payload).value,
    );
    if (maintenanceBlocks(m.mode, m.bindings, action))
      throw new ServiceUnavailableException({
        code:
          m.mode === 'READ_ONLY'
            ? 'PLATFORM_READ_ONLY'
            : 'PLATFORM_MAINTENANCE',
      });
  }
  const definitions = await tx.platformConfigDefinition.findMany({
    where: {
      OR: [
        {
          category: 'FLAG',
          binding: { path: ['module'], equals: action.module },
        },
        { key: 'modules.' + action.module + '.enabled' },
      ],
    },
  });
  for (const d of definitions) {
    const binding = d.binding as TrafficBinding | null;
    if (
      binding &&
      !(
        binding.operation === action.operation ||
        (binding.operation === 'write' &&
          ['upload', 'delete'].includes(action.operation))
      )
    )
      continue;
    const effective = await effectiveConfiguration(tx, d, context);
    if (effective.value === false)
      throw new ForbiddenException({
        code: d.killed ? 'FEATURE_KILLED' : 'FEATURE_DISABLED',
      });
  }
  if (
    action.module === 'notifications' &&
    action.operation !== 'read' &&
    (await productConfiguration(
      tx,
      'platform.notifications.enabled',
      context,
      true,
    )) === false
  )
    throw new ForbiddenException({ code: 'NOTIFICATIONS_PAUSED' });
}
export async function productConfiguration(
  tx: Prisma.TransactionClient,
  key: string,
  context: ConfigurationContext,
  fallback: unknown,
) {
  const d = await tx.platformConfigDefinition.findUnique({ where: { key } });
  return d ? (await effectiveConfiguration(tx, d, context)).value : fallback;
}
export async function assertConfiguredUpload(
  tx: Prisma.TransactionClient,
  context: ConfigurationContext,
  size: number,
) {
  const limit = await productConfiguration(
    tx,
    'uploads.maxBytes',
    context,
    104857600,
  );
  if (typeof limit !== 'number' || size > limit)
    throw new PayloadTooLargeException({ code: 'CONFIGURED_UPLOAD_LIMIT' });
}
@Injectable()
export class ConfigurationRuntime {
  constructor(
    @Inject(ConfigurationCore) readonly core: ConfigurationCore,
    @Inject(OperationsControl) readonly independent: OperationsControl,
  ) {}
  async unconfigured() {
    return (
      (
        await this.core.db.client.platformConfigEpoch.findUniqueOrThrow({
          where: { id: 'GLOBAL' },
          select: { generation: true },
        })
      ).generation === 1n
    );
  }
  async assert(
    action: TrafficBinding,
    context: ConfigurationContext = { clientVersion: 1 },
  ) {
    await this.independent.assert(action);
    if (await this.unconfigured()) return;
    return this.core.db.client.$transaction(async (tx) => {
      await assertRuntimeConfiguration(tx, context, action);
    });
  }
  async worker<T>(
    module: TrafficBinding['module'],
    work: () => Promise<T>,
  ): Promise<T | false> {
    const action = { module, operation: 'write' as const };
    try {
      await this.assert(action);
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof ServiceUnavailableException
      )
        return false;
      throw error;
    }
    return configurationAction.run(action, work);
  }
}
