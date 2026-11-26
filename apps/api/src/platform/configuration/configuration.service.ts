import {
  Inject,
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ConfigurationDefinitionInputSchema,
  ConfigurationPayloadSchema,
  ConfigurationCatalog,
  ConfigurationDraftViewSchema,
  ConfigurationDefinitionViewSchema,
  ConfigurationVersionViewSchema,
  adminConfigurationRoutes,
} from '@mehran/api-contracts';
import { AdminCommand } from '../admin/admin-command.js';
import { PrivacyGate } from '../authorization/privacy-gate.js';
import {
  ConfigurationCore,
  configurationLock,
  configJson,
  configFail,
  configHash,
  configPage,
} from './configuration-core.js';
import { ConfigurationMaintenance } from './maintenance.js';
import type {
  Prisma,
  PlatformConfigDraft,
  PlatformConfigDefinition,
  PlatformConfigVersion,
} from '../../generated/prisma/client.js';
const definitionView = (d: PlatformConfigDefinition) =>
  ConfigurationDefinitionViewSchema.parse({
    ...d,
    createdAt: d.createdAt.toISOString(),
  });
const draftView = (d: PlatformConfigDraft) =>
  ConfigurationDraftViewSchema.parse({
    id: d.id,
    definitionId: d.definitionId,
    expectedRevision: d.expectedRevision,
    payload: d.payload,
    state: d.state,
    fingerprint: d.fingerprint,
    requesterAdminId: d.requesterAdminId,
    previewExpiresAt: d.previewExpiresAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  });
const versionView = (v: PlatformConfigVersion) =>
  ConfigurationVersionViewSchema.parse({
    id: v.id,
    definitionId: v.definitionId,
    version: v.version,
    payload: v.payload,
    actorAdminId: v.actorAdminId,
    reason: v.reason,
    sourceVersionId: v.sourceVersionId,
    createdAt: v.createdAt.toISOString(),
  });
@Injectable()
export class ConfigurationService {
  constructor(
    @Inject(ConfigurationCore) readonly core: ConfigurationCore,
    @Inject(ConfigurationMaintenance)
    readonly maintenance: ConfigurationMaintenance,
    @Inject(PrivacyGate) readonly privacy: PrivacyGate,
  ) {}
  async handle(
    route: keyof typeof adminConfigurationRoutes,
    id: string | undefined,
    body: unknown,
    command: AdminCommand,
  ) {
    command.require(adminConfigurationRoutes[route].permission);
    // Restore/recovery is deliberately accessible while ordinary privacy replay is quarantined.
    if (!route.endsWith('/reopen')) this.privacy.assert();
    if (route.endsWith('/readiness'))
      return this.maintenance.preview(
        id!,
        (body as { notBefore?: string }).notBefore,
      );
    if (route.endsWith('/schedule-reopen'))
      return this.maintenance.schedule(
        command,
        id!,
        body as { reason: string; approvalId: string; notBefore: string },
      );
    if (route.endsWith('/reopen-schedule'))
      return this.maintenance.scheduled(id!);
    if (route.endsWith('/reopen'))
      return this.maintenance.reopen(
        command,
        id!,
        body as { reason: string; approvalId: string },
      );
    return this.core.db.client.$transaction(
      (tx) =>
        command.execute(
          tx,
          async () => {
            await configurationLock(tx);
            const input = body as {
              after?: string;
              limit?: number;
              revision?: number;
              reason?: string;
              versionId?: string;
              payload?: unknown;
              approvalId?: string;
              active?: boolean;
              userId?: string;
              workspaceId?: string;
              clientVersion?: number;
            };
            const q = { ...(input.after ? { id: { gt: input.after } } : {}) },
              limit = input.limit ?? 25;
            if (route === 'GET configuration/catalog')
              return configJson({
                items: Object.entries(ConfigurationCatalog).map(([key, c]) => ({
                  key,
                  category: c.category,
                  type: c.type,
                  defaultValue: c.defaultValue,
                  sensitive: c.sensitive,
                })),
              });
            if (route === 'GET configuration/definitions')
              return configJson(
                configPage(
                  (
                    await tx.platformConfigDefinition.findMany({
                      where: q,
                      orderBy: { id: 'asc' },
                      take: limit + 1,
                    })
                  ).map(definitionView),
                  limit,
                ),
              );
            if (route === 'POST configuration/definitions') {
              const b = ConfigurationDefinitionInputSchema.parse(body),
                c = this.core.catalog(b.key);
              if (
                (b.category === 'FLAG' && c) ||
                (b.category !== 'FLAG' && (!c || c.category !== b.category)) ||
                (b.category !== 'FLAG' && b.binding)
              )
                throw new BadRequestException({
                  code: 'CONFIGURATION_KEY_NOT_ALLOWLISTED',
                });
              if (
                await tx.platformConfigDefinition.findUnique({
                  where: { key: b.key },
                })
              )
                configFail('CONFIGURATION_KEY_EXISTS');
              if ((await tx.platformConfigDefinition.count()) >= 500)
                configFail('CONFIGURATION_CATALOG_CAPACITY');
              const d = await tx.platformConfigDefinition.create({
                data: {
                  key: b.key,
                  category: b.category,
                  ...(b.binding ? { binding: configJson(b.binding) } : {}),
                },
              });
              await this.core.event(
                tx,
                d.id,
                'CREATED',
                b.reason,
                command.adminId,
              );
              await this.core.bump(tx);
              return configJson(definitionView(d));
            }
            if (route.includes('/drafts/:id')) {
              const draft = await tx.platformConfigDraft.findUnique({
                where: { id: id! },
              });
              if (!draft) throw new NotFoundException();
              if (route === 'GET configuration/drafts/:id')
                return configJson(draftView(draft));
              if (
                draft.requesterAdminId !== command.adminId ||
                draft.state === 'PUBLISHED'
              )
                throw new ForbiddenException();
              const d = await this.core.definition(tx, draft.definitionId);
              if (d.revision !== draft.expectedRevision)
                configFail('STALE_REVISION');
              const payload = ConfigurationPayloadSchema.parse(draft.payload),
                impact = await this.core.impact(tx, d, payload);
              if (route.endsWith('/preview')) {
                const prior = await tx.platformConfigVersion.findFirst({
                  where: { definitionId: d.id },
                  orderBy: { version: 'desc' },
                });
                const updated = await tx.platformConfigDraft.update({
                  where: { id: draft.id },
                  data: {
                    state: 'PREVIEW',
                    fingerprint: impact.fingerprint,
                    previewExpiresAt: new Date(Date.now() + 900000),
                  },
                });
                await this.core.event(
                  tx,
                  d.id,
                  'PREVIEWED',
                  input.reason!,
                  command.adminId,
                  null,
                  { draftId: draft.id, fingerprint: impact.fingerprint },
                );
                return configJson({
                  draft: draftView(updated),
                  impact,
                  diff: this.core.diff(prior?.payload ?? null, payload),
                });
              }
              if (
                draft.state !== 'PREVIEW' ||
                !draft.previewExpiresAt ||
                draft.previewExpiresAt <= new Date() ||
                draft.fingerprint !== impact.fingerprint
              )
                configFail('CONFIGURATION_PREVIEW_STALE');
              if (
                payload.expiresAt &&
                Date.parse(payload.expiresAt) <= Date.now()
              )
                configFail('CONFIGURATION_WINDOW_EXPIRED');
              if (impact.sensitive) {
                await AdminCommand.requireInitiator(
                  tx,
                  command.adminId,
                  'admin.configuration.sensitive.publish',
                );
                await this.core.consumeApproval(
                  tx,
                  command,
                  input.approvalId,
                  'CONFIG_PUBLICATION',
                  draft.id,
                  impact.fingerprint,
                );
              }
              if (
                d.key === 'platform.maintenance' &&
                (await tx.platformConfigVersion.count({
                  where: {
                    definitionId: d.id,
                    r_PlatformMaintenanceRelease_versionId: { none: {} },
                  },
                })) >= 99
              )
                configFail('MAINTENANCE_RELEASE_OLD_VERSIONS_FIRST');
              const last = await tx.platformConfigVersion.aggregate({
                where: { definitionId: d.id },
                _max: { version: true },
              });
              const v = await tx.platformConfigVersion.create({
                data: {
                  definitionId: d.id,
                  version: (last._max.version ?? 0) + 1,
                  payload: configJson(payload),
                  actorAdminId: command.adminId,
                  reason: input.reason!,
                  sourceVersionId: draft.sourceVersionId,
                  approvalId: impact.sensitive ? input.approvalId! : null,
                  startsAt: payload.startsAt
                    ? new Date(payload.startsAt)
                    : new Date(),
                  expiresAt: payload.expiresAt
                    ? new Date(payload.expiresAt)
                    : null,
                },
              });
              for (const [position, r] of payload.rules.entries()) {
                const t = r.target;
                let spaceId: string | null = null,
                  scopeId: string | null = null;
                if (t.kind === 'WORKSPACE') {
                  const s = await tx.space.findFirst({
                    where: { id: t.workspaceId, kind: 'PERSONAL' },
                    select: { id: true },
                  });
                  if (s) spaceId = s.id;
                  else scopeId = t.workspaceId;
                }
                await tx.platformConfigTarget.create({
                  data: {
                    versionId: v.id,
                    position,
                    kind: t.kind,
                    scopeType: t.kind === 'SCOPE_TYPE' ? t.scopeType : null,
                    spaceId,
                    scopeId,
                    userId: t.kind === 'USER' ? t.userId : null,
                    groupId: t.kind === 'GROUP' ? t.groupId : null,
                    value: configJson(r.value),
                    priority: r.priority,
                    basisPoints: r.basisPoints,
                    steps: configJson(r.steps),
                  },
                });
              }
              await tx.platformConfigDefinition.update({
                where: { id: d.id },
                data: { revision: { increment: 1 } },
              });
              await tx.platformConfigDraft.update({
                where: { id: draft.id },
                data: { state: 'PUBLISHED' },
              });
              await this.core.event(
                tx,
                d.id,
                'PUBLISHED',
                input.reason!,
                command.adminId,
                v.id,
                { draftId: draft.id, fingerprint: impact.fingerprint },
              );
              if (v.startsAt <= new Date())
                await this.core.event(
                  tx,
                  d.id,
                  'ACTIVATED',
                  input.reason!,
                  command.adminId,
                  v.id,
                );
              await this.core.bump(tx);
              await command.recordChange(
                tx,
                { revision: d.revision },
                { revision: d.revision + 1, versionId: v.id },
              );
              return configJson(versionView(v));
            }
            const d = await this.core.definition(tx, id!);
            if (route.endsWith('/kill-release-preview'))
              return {
                definitionId: d.id,
                revision: d.revision,
                fingerprint: configHash({
                  id: d.id,
                  revision: d.revision,
                  killed: false,
                }),
              };
            if (route.endsWith('/effective')) {
              await this.core.reconcile(tx);
              return configJson(
                await this.core.effective(tx, d, {
                  ...(input.userId ? { userId: input.userId } : {}),
                  ...(input.workspaceId
                    ? { workspaceId: input.workspaceId }
                    : {}),
                  clientVersion: input.clientVersion ?? 1,
                }),
              );
            }
            if (route.endsWith('/history'))
              return configJson(
                configPage(
                  (
                    await tx.platformConfigVersion.findMany({
                      where: { definitionId: d.id, ...q },
                      orderBy: { id: 'asc' },
                      take: limit + 1,
                    })
                  ).map(versionView),
                  limit,
                ),
              );
            if (route.endsWith('/events'))
              return configJson(
                configPage(
                  (
                    await tx.platformConfigEvent.findMany({
                      where: { definitionId: d.id, ...q },
                      orderBy: { id: 'asc' },
                      take: limit + 1,
                    })
                  ).map((e) => ({
                    ...e,
                    createdAt: e.createdAt.toISOString(),
                  })),
                  limit,
                ),
              );
            if (input.revision !== d.revision) configFail('STALE_REVISION');
            if (route.endsWith('/kill')) {
              if (d.category !== 'FLAG') throw new BadRequestException();
              if (!input.active)
                await this.core.consumeApproval(
                  tx,
                  command,
                  input.approvalId,
                  'CONFIG_KILL_RELEASE',
                  d.id,
                  configHash({ id: d.id, revision: d.revision, killed: false }),
                );
              const next = await tx.platformConfigDefinition.update({
                where: { id: d.id },
                data: { killed: input.active!, revision: { increment: 1 } },
              });
              await this.core.event(
                tx,
                d.id,
                input.active ? 'KILLED' : 'KILL_RELEASED',
                input.reason!,
                command.adminId,
                null,
                { before: d.killed, after: next.killed },
              );
              await this.core.bump(tx);
              return configJson(definitionView(next));
            }
            let payload,
              sourceVersionId: string | null = null;
            if (route.endsWith('/rollback')) {
              const version = await tx.platformConfigVersion.findFirst({
                where: { id: input.versionId!, definitionId: d.id },
              });
              if (!version) throw new NotFoundException();
              payload = {
                ...ConfigurationPayloadSchema.parse(version.payload),
                startsAt: null,
                expiresAt: null,
              };
              sourceVersionId = version.id;
            } else payload = ConfigurationPayloadSchema.parse(input.payload);
            this.core.validate(d, payload);
            const draft = await tx.platformConfigDraft.create({
              data: {
                definitionId: d.id,
                expectedRevision: d.revision,
                payload: configJson(payload),
                requesterAdminId: command.adminId,
                sourceVersionId,
              },
            });
            await this.core.event(
              tx,
              d.id,
              'DRAFTED',
              input.reason!,
              command.adminId,
              null,
              { draftId: draft.id, sourceVersionId },
            );
            return configJson(draftView(draft));
          },
          (result) => {
            const r = result as Record<string, Prisma.InputJsonValue>;
            return {
              operation: command.permission,
              ...(typeof r.id === 'string' ? { id: r.id } : {}),
            };
          },
        ),
      { timeout: 20000 },
    );
  }
}
