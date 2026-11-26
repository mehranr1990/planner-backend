import {
  Injectable,
  Inject,
  ServiceUnavailableException,
  NotFoundException,
} from '@nestjs/common';
import {
  MaintenanceValueSchema,
  ConfigurationPayloadSchema,
  ConfigurationMaintenanceStatusSchema,
} from '@mehran/api-contracts';
import {
  ConfigurationCore,
  configurationLock,
  configJson,
  configHash,
  configFail,
  configurationVersionEligible,
} from './configuration-core.js';
import { OperationsControl } from '../operations/operations-control.js';
import { SystemHealth } from '../operations/system-health.js';
import { AdminCommand } from '../admin/admin-command.js';
import { PrivacyGate } from '../authorization/privacy-gate.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { maintenanceBlocks, type TrafficBinding } from './traffic.js';
@Injectable()
export class ConfigurationMaintenance {
  constructor(
    @Inject(ConfigurationCore) readonly core: ConfigurationCore,
    @Inject(OperationsControl) readonly independent: OperationsControl,
    @Inject(SystemHealth) readonly health: SystemHealth,
    @Inject(PrivacyGate) readonly privacy: PrivacyGate,
  ) {}
  async active(tx: Prisma.TransactionClient, now = new Date()) {
    const rows = await tx.platformConfigVersion.findMany({
      where: {
        r_definitionId: { key: 'platform.maintenance' },
        startsAt: { lte: now },
        r_PlatformMaintenanceRelease_versionId: { none: {} },
        r_PlatformConfigEvent_versionId: {
          none: { kind: 'ACTIVATION_DENIED' },
        },
      },
      orderBy: { version: 'desc' },
      take: 100,
    });
    const eligible = [];
    for (const v of rows)
      if (await configurationVersionEligible(tx, v, now)) eligible.push(v);
    return eligible.map((v) => ({
      version: v,
      value: MaintenanceValueSchema.parse(
        ConfigurationPayloadSchema.parse(v.payload).value,
      ),
    }));
  }
  async assert(tx: Prisma.TransactionClient, action: TrafficBinding) {
    await this.independent.assert(action);
    for (const row of await this.active(tx))
      if (maintenanceBlocks(row.value.mode, row.value.bindings, action))
        throw new ServiceUnavailableException({
          code:
            row.value.mode === 'READ_ONLY'
              ? 'PLATFORM_READ_ONLY'
              : 'PLATFORM_MAINTENANCE',
        });
  }
  async status() {
    const now = new Date();
    try {
      const result = await this.core.db.client.$transaction(async (tx) => {
        await this.core.reconcile(tx);
        return {
          rows: await this.active(tx, now),
          upcoming: await tx.platformConfigVersion.findMany({
            where: {
              r_definitionId: { key: 'platform.maintenance' },
              startsAt: { gt: now },
              r_PlatformMaintenanceRelease_versionId: { none: {} },
              r_PlatformConfigEvent_versionId: {
                none: { kind: 'ACTIVATION_DENIED' },
              },
            },
            orderBy: { startsAt: 'asc' },
            take: 100,
          }),
          epoch: await tx.platformConfigEpoch.findUniqueOrThrow({
            where: { id: 'GLOBAL' },
          }),
        };
      });
      const state = await this.independent.status();
      const rows = result.rows.map(({ version, value }) =>
        this.statusItem(
          version.id,
          value,
          version.createdAt,
          now,
          version.startsAt,
        ),
      );
      rows.push(
        ...result.upcoming.map((v) =>
          this.statusItem(
            v.id,
            MaintenanceValueSchema.parse(
              ConfigurationPayloadSchema.parse(v.payload).value,
            ),
            v.createdAt,
            now,
            v.startsAt,
          ),
        ),
      );
      if (state && state.state !== 'READY')
        rows.unshift(this.independentItem(state, now));
      return ConfigurationMaintenanceStatusSchema.parse({
        available: true,
        source: 'DATABASE',
        generation: result.epoch.generation.toString(),
        observedAt: now.toISOString(),
        items: rows,
      });
    } catch {
      try {
        const state = await this.independent.status();
        if (state)
          return ConfigurationMaintenanceStatusSchema.parse({
            available: false,
            source: 'INDEPENDENT',
            generation: state.updatedAt,
            observedAt: now.toISOString(),
            items: [
              this.independentItem(
                state.state === 'READY'
                  ? {
                      ...state,
                      state: 'VERIFYING',
                      message: 'Database unavailable; recovery checks required',
                    }
                  : state,
                now,
              ),
            ],
          });
      } catch {
        /* No unverified fallback. */
      }
      return ConfigurationMaintenanceStatusSchema.parse({
        available: false,
        source: 'UNAVAILABLE',
        generation: '0',
        observedAt: now.toISOString(),
        items: [
          {
            versionId: null,
            active: true,
            startsAt: now.toISOString(),
            countdownToStartSeconds: 0,
            mode: 'FULL',
            bindings: [],
            messages: { en: 'Service recovery in progress' },
            defaultLocale: 'en',
            estimatedEndAt: null,
            countdownSeconds: null,
            overrunning: false,
            progress: 0,
            status: 'Readiness unavailable',
            lastUpdatedAt: now.toISOString(),
          },
        ],
      });
    }
  }
  private statusItem(
    versionId: string | null,
    value: ReturnType<typeof MaintenanceValueSchema.parse>,
    updated: Date,
    now: Date,
    startsAt = updated,
  ) {
    return {
      versionId,
      active: startsAt <= now,
      startsAt: startsAt.toISOString(),
      countdownToStartSeconds: Math.max(
        0,
        Math.ceil((+startsAt - +now) / 1000),
      ),
      ...value,
      countdownSeconds: value.estimatedEndAt
        ? Math.max(
            0,
            Math.ceil((Date.parse(value.estimatedEndAt) - +now) / 1000),
          )
        : null,
      overrunning:
        !!value.estimatedEndAt && Date.parse(value.estimatedEndAt) <= +now,
      lastUpdatedAt: updated.toISOString(),
    };
  }
  private independentItem(
    state: NonNullable<Awaited<ReturnType<OperationsControl['status']>>>,
    now: Date,
  ) {
    return this.statusItem(
      null,
      state.maintenance ?? {
        mode: 'FULL',
        bindings: [],
        messages: { en: state.message },
        defaultLocale: 'en',
        estimatedEndAt: null,
        progress: 0,
        status: state.state,
      },
      new Date(state.updatedAt),
      now,
    );
  }
  async readiness() {
    this.privacy.assert();
    await this.independent.assert();
    const health = await this.health.snapshot();
    if (
      health.status !== 'READY' ||
      health.checks.some((c) => c.status !== 'UP')
    )
      configFail('MAINTENANCE_READINESS_FAILED');
    const restores = await this.core.db.client.adminRestoreRun.count({
      where: { state: { in: ['RUNNING', 'VERIFYING'] } },
    });
    if (restores) configFail('RESTORE_STILL_IN_PROGRESS');
    return health;
  }
  async preview(id: string, notBefore?: string) {
    const v = await this.core.db.client.platformConfigVersion.findUnique({
      where: { id },
      include: { r_definitionId: true },
    });
    if (!v || v.r_definitionId.key !== 'platform.maintenance')
      throw new NotFoundException();
    let ready = true;
    try {
      await this.readiness();
    } catch {
      ready = false;
    }
    return {
      versionId: id,
      revision: v.r_definitionId.revision,
      fingerprint: configHash({
        versionId: id,
        revision: v.r_definitionId.revision,
        ...(notBefore ? { notBefore } : {}),
      }),
      ready,
      observedAt: new Date().toISOString(),
    };
  }
  /** Protected local operator only. Restore states cannot use this path. */
  private scheduleView(row: {
    id: string;
    versionId: string;
    state: string;
    notBefore: Date;
    nextAttemptAt: Date;
    failureCode: string | null;
  }) {
    return {
      id: row.id,
      versionId: row.versionId,
      state: row.state,
      notBefore: row.notBefore.toISOString(),
      nextAttemptAt: row.nextAttemptAt.toISOString(),
      failureCode: row.failureCode,
    };
  }
  async scheduled(versionId: string) {
    const row =
      await this.core.db.client.platformMaintenanceSchedule.findUnique({
        where: { versionId },
      });
    if (!row) throw new NotFoundException();
    return this.scheduleView(row);
  }
  async schedule(
    command: AdminCommand,
    versionId: string,
    input: { reason: string; approvalId: string; notBefore: string },
  ) {
    command.require('admin.maintenance.reopen');
    return this.core.db.client.$transaction((tx) =>
      command.execute(tx, async () => {
        await configurationLock(tx);
        const v = await tx.platformConfigVersion.findUnique({
          where: { id: versionId },
          include: { r_definitionId: true },
        });
        if (!v || v.r_definitionId.key !== 'platform.maintenance')
          throw new NotFoundException();
        const notBefore = new Date(input.notBefore);
        if (
          notBefore <= new Date() ||
          notBefore < v.startsAt ||
          +notBefore > Date.now() + 30 * 86400000
        )
          configFail('MAINTENANCE_RELEASE_SCHEDULE_INVALID');
        if (
          await tx.platformMaintenanceRelease.findUnique({
            where: { versionId },
          })
        )
          configFail('MAINTENANCE_ALREADY_RELEASED');
        if (
          await tx.platformMaintenanceSchedule.findUnique({
            where: { versionId },
          })
        )
          configFail('MAINTENANCE_RELEASE_ALREADY_SCHEDULED');
        await this.core.consumeApproval(
          tx,
          command,
          input.approvalId,
          'MAINTENANCE_REOPEN',
          versionId,
          configHash({
            versionId,
            revision: v.r_definitionId.revision,
            notBefore: input.notBefore,
          }),
        );
        const row = await tx.platformMaintenanceSchedule.create({
          data: {
            versionId,
            approvalId: input.approvalId,
            requesterAdminId: command.adminId,
            expectedRevision: v.r_definitionId.revision,
            notBefore,
            nextAttemptAt: notBefore,
            reason: input.reason,
          },
        });
        await this.core.event(
          tx,
          v.definitionId,
          'REOPEN_SCHEDULED',
          input.reason,
          command.adminId,
          versionId,
          { scheduleId: row.id, notBefore: input.notBefore },
        );
        return this.scheduleView(row);
      }),
    );
  }
  async consume(now = new Date()) {
    const hints =
      await this.core.db.client.platformMaintenanceSchedule.findMany({
        where: {
          state: { in: ['PENDING', 'WAITING'] },
          nextAttemptAt: { lte: now },
        },
        orderBy: { nextAttemptAt: 'asc' },
        take: 25,
      });
    for (const hint of hints) {
      let readiness: Awaited<ReturnType<SystemHealth['snapshot']>> | null =
        null;
      try {
        readiness = await this.readiness();
      } catch {
        /* Persist a waiting fence, never infer readiness. */
      }
      await this.core.db.client.$transaction(async (tx) => {
        await configurationLock(tx);
        const row = await tx.platformMaintenanceSchedule.findUniqueOrThrow({
          where: { id: hint.id },
        });
        if (
          !['PENDING', 'WAITING'].includes(row.state) ||
          row.nextAttemptAt > now
        )
          return;
        const v = await tx.platformConfigVersion.findUniqueOrThrow({
            where: { id: row.versionId },
            include: { r_definitionId: true },
          }),
          approval = await tx.adminSecurityApproval.findUniqueOrThrow({
            where: { id: row.approvalId },
          });
        let eligible = true;
        try {
          await AdminCommand.requireInitiator(
            tx,
            row.requesterAdminId,
            'admin.maintenance.reopen',
          );
          if (!approval.approverAdminId || approval.state !== 'EXECUTED')
            throw new Error();
          await AdminCommand.requireInitiator(
            tx,
            approval.approverAdminId,
            'admin.security.critical.approve',
          );
        } catch {
          eligible = false;
        }
        if (!eligible || row.expectedRevision !== v.r_definitionId.revision) {
          await tx.platformMaintenanceSchedule.update({
            where: { id: row.id },
            data: {
              state: 'REVIEW',
              failureCode: eligible
                ? 'CONFIGURATION_REVISION_CHANGED'
                : 'OPERATOR_AUTHORITY_REVOKED',
              lastAttemptAt: now,
              completedAt: now,
            },
          });
          await this.core.event(
            tx,
            v.definitionId,
            'REOPEN_REVIEW',
            row.reason,
            null,
            v.id,
            { scheduleId: row.id },
          );
          return;
        }
        if (!readiness) {
          await tx.platformMaintenanceSchedule.update({
            where: { id: row.id },
            data: {
              state: 'WAITING',
              lastAttemptAt: now,
              nextAttemptAt: new Date(+now + 60000),
              failureCode: 'READINESS_FAILED',
            },
          });
          return;
        }
        this.privacy.assert();
        await this.independent.assert();
        if (await tx.adminRestoreRun.count({ where: { state: 'RUNNING' } }))
          return;
        if (
          !(await tx.platformMaintenanceRelease.findUnique({
            where: { versionId: v.id },
          }))
        )
          await tx.platformMaintenanceRelease.create({
            data: {
              versionId: v.id,
              actorAdminId: row.requesterAdminId,
              reason: row.reason,
              readiness: configJson(readiness),
            },
          });
        await tx.platformMaintenanceSchedule.update({
          where: { id: row.id },
          data: {
            state: 'RELEASED',
            lastAttemptAt: now,
            completedAt: now,
            failureCode: null,
          },
        });
        await this.core.event(
          tx,
          v.definitionId,
          'REOPENED',
          row.reason,
          row.requesterAdminId,
          v.id,
          { scheduleId: row.id },
        );
        await this.core.bump(tx);
      });
    }
    return hints.length > 0;
  }
  async recoverIndependent(runId: string, reason: string) {
    if (reason.trim().length < 5 || reason.length > 500)
      configFail('RECOVERY_REASON_REQUIRED');
    await this.independent.recover(runId, async () => {
      this.privacy.assert();
      const health = await this.health.snapshot();
      if (
        health.checks
          .filter((c) => c.name !== 'maintenance')
          .some((c) => c.status !== 'UP')
      )
        configFail('MAINTENANCE_READINESS_FAILED');
      const pending = await this.core.db.client.adminRestoreRun.count({
        where: { state: 'RUNNING' },
      });
      if (pending) configFail('RESTORE_STILL_IN_PROGRESS');
      await this.core.db.client.adminAuditEvent.create({
        data: {
          action: 'INDEPENDENT_MAINTENANCE_RECOVERED',
          requestId: runId,
          outcome: 'SUCCEEDED',
          reason,
          metadata: {
            operatorConsole: true,
            checks: configJson(health.checks),
            trafficSwitch: false,
          },
        },
      });
    });
    return { runId, reopened: true };
  }
  async reopen(
    command: AdminCommand,
    id: string,
    input: { reason: string; approvalId: string },
  ) {
    command.require('admin.maintenance.reopen');
    const health = await this.readiness();
    return this.core.db.client.$transaction(
      (tx) =>
        command.execute(tx, async () => {
          await configurationLock(tx);
          const v = await tx.platformConfigVersion.findUnique({
            where: { id },
            include: { r_definitionId: true },
          });
          if (!v || v.r_definitionId.key !== 'platform.maintenance')
            throw new NotFoundException();
          if (v.startsAt > new Date()) configFail('MAINTENANCE_NOT_STARTED');
          if (
            await tx.platformMaintenanceRelease.findUnique({
              where: { versionId: id },
            })
          )
            configFail('MAINTENANCE_ALREADY_RELEASED');
          await this.core.consumeApproval(
            tx,
            command,
            input.approvalId,
            'MAINTENANCE_REOPEN',
            id,
            configHash({ versionId: id, revision: v.r_definitionId.revision }),
          );
          // Recheck controls and DB at the commit boundary; signed restore control stays independent.
          this.privacy.assert();
          await this.independent.assert();
          await tx.$queryRaw`SELECT 1`;
          const pending = await tx.adminRestoreRun.count({
            where: { state: 'RUNNING' },
          });
          if (pending) configFail('RESTORE_STILL_IN_PROGRESS');
          const release = await tx.platformMaintenanceRelease.create({
            data: {
              versionId: id,
              actorAdminId: command.adminId,
              reason: input.reason,
              readiness: configJson(health),
            },
          });
          await tx.platformMaintenanceSchedule.updateMany({
            where: { versionId: id, state: { in: ['PENDING', 'WAITING'] } },
            data: { state: 'CANCELED', completedAt: new Date() },
          });
          await this.core.event(
            tx,
            v.definitionId,
            'REOPENED',
            input.reason,
            command.adminId,
            id,
            { releaseId: release.id },
          );
          await this.core.bump(tx);
          return {
            versionId: id,
            reopened: true,
            checkedAt: release.createdAt.toISOString(),
          };
        }),
      { timeout: 20000 },
    );
  }
}
