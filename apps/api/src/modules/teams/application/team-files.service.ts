import {
  Inject,
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  StoredFile,
  TeamFile,
  TeamFileFolder,
  TeamFileVersion,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedFiles } from '../../../platform/storage/public/index.js';
import type { SharedFileScope } from '../../../platform/storage/public/index.js';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import { TeamInteractionContext } from './team-interaction.context.js';
import type { Interaction, Member } from './team-interaction.context.js';
type Page = z.infer<typeof c.ProjectPageQuerySchema>;
const ref = (accessId: string, generation: number): Member => ({
  accessId,
  generation,
});
const MAX_VERSIONS = 100;
/**
 * TM-11 (owner-approved): private Team folders and versioned files over the
 * existing StoredFile/StoragePort lifecycle. Members upload; the owner or a
 * work manager edits and removes; every read re-checks current Team access.
 */
@Injectable()
export class TeamFilesService {
  private readonly active = new Map<
    string,
    { abort: AbortController; finished: Promise<void> }
  >();
  constructor(
    @Inject(TeamInteractionContext) private readonly op: TeamInteractionContext,
    @Inject(SharedFiles) private readonly files: SharedFiles,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  private me(s: Interaction): Member {
    const a = this.op.access(s);
    return ref(a.accessId, a.generation);
  }
  private manager(s: Interaction) {
    return this.op.eligible(s, this.me(s), 'WORK');
  }
  private scope(s: Interaction): SharedFileScope {
    return {
      ...this.op.scope(s),
      actorId: this.op.access(s).actorId,
      verify: (tx, _write) => {
        if (tx !== s.tx) throw new ForbiddenException();
      },
    };
  }
  private owns(s: Interaction, r: TeamFile) {
    const me = this.me(s);
    return (
      r.ownerAccessId === me.accessId && r.ownerGeneration === me.generation
    );
  }

  // Folders -----------------------------------------------------------------
  private async folderView(
    s: Interaction,
    r: TeamFileFolder,
    manager: boolean,
  ) {
    const mine = r.createdByActorId === this.op.access(s).actorId;
    return c.TeamFileFolderSchema.parse({
      id: r.id,
      parentId: r.parentId,
      title: r.title,
      revision: r.revision,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      can: { rename: mine || manager, remove: mine || manager },
    });
  }
  private async folderRow(s: Interaction, folderId: string) {
    const row = await s.tx.teamFileFolder.findFirst({
      where: { id: folderId, ...this.op.scope(s) },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  private async editableFolder(s: Interaction, folderId: string) {
    const row = await this.folderRow(s, folderId);
    if (
      row.createdByActorId !== this.op.access(s).actorId &&
      !(await this.manager(s))
    )
      throw new ForbiddenException();
    return row;
  }
  folders(actor: RequestActor, id: string, q: Page) {
    return this.op.read(actor, id, async (s) => {
      const manager = await this.manager(s);
      return this.op.page(s, 'team-file-folders', q, async (after) =>
        Promise.all(
          (
            await s.tx.teamFileFolder.findMany({
              where: {
                ...this.op.scope(s),
                ...(after ? { id: { gt: after } } : {}),
              },
              orderBy: { id: 'asc' },
              take: q.limit + 1,
            })
          ).map((r) => this.folderView(s, r, manager)),
        ),
      );
    });
  }
  createFolder(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.TeamFileFolderCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.TeamFileFolderCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'task.create',
      [],
      'team.files.folder.create',
      body.id,
      async (s) => {
        if (body.parentId) await this.folderRow(s, body.parentId);
        await this.op.once(
          s,
          'team.files.folder.create',
          key,
          body,
          async () => {
            if (
              (await s.tx.teamFileFolder.count({ where: this.op.scope(s) })) >=
              1000
            )
              throw new PayloadTooLargeException();
            await s.begin();
            return s.tx.teamFileFolder.create({
              data: {
                id: body.id,
                ...this.op.scope(s),
                parentId: body.parentId,
                title: body.title,
                createdByActorId: this.op.access(s).actorId,
                updatedAt: s.now,
              },
            });
          },
        );
        return this.folderView(
          s,
          await this.folderRow(s, body.id),
          await this.manager(s),
        );
      },
    );
  }
  renameFolder(
    actor: RequestActor,
    id: string,
    folderId: string,
    revision: number,
    input: z.infer<typeof c.TeamFileFolderPatchSchema>,
  ) {
    const body = c.TeamFileFolderPatchSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'task.read',
      [],
      'team.files.folder.update',
      folderId,
      async (s) => {
        const row = await this.editableFolder(s, folderId);
        this.op.match(row.revision, revision);
        await s.begin();
        const updated = await s.tx.teamFileFolder.update({
          where: { id: row.id, revision: row.revision },
          data: {
            title: body.title,
            updatedAt: s.now,
            revision: { increment: 1 },
          },
        });
        return this.folderView(s, updated, await this.manager(s));
      },
    );
  }
  removeFolder(
    actor: RequestActor,
    id: string,
    folderId: string,
    revision: number,
  ) {
    return this.op.write(
      actor,
      id,
      'task.read',
      [],
      'team.files.folder.remove',
      folderId,
      async (s) => {
        const row = await this.editableFolder(s, folderId);
        this.op.match(row.revision, revision);
        const where = { ...this.op.scope(s) };
        if (
          (await s.tx.teamFileFolder.count({
            where: { ...where, parentId: folderId },
          })) ||
          (await s.tx.teamFile.count({
            where: { ...where, folderId, removedAt: null },
          }))
        )
          throw new ConflictException({ code: 'FOLDER_NOT_EMPTY' });
        await s.begin();
        // Removed files keep their history but leave the deleted folder.
        await s.tx.teamFile.updateMany({
          where: { ...where, folderId, removedAt: { not: null } },
          data: { folderId: null },
        });
        await s.tx.teamFileFolder.delete({ where: { id: row.id } });
        return c.TeamFileRemovedSchema.parse({ id: folderId, removed: true });
      },
    );
  }

  // Files -------------------------------------------------------------------
  private versionView(v: TeamFileVersion, f: StoredFile) {
    return c.TeamFileVersionSchema.parse({
      id: v.id,
      fileId: v.fileId,
      number: v.number,
      filename: f.filename,
      mimeType: f.mimeType,
      expectedSize: f.expectedSize,
      size: f.actualSize,
      sha256: f.sha256,
      status: f.status,
      uploader: ref(v.uploaderAccessId, v.uploaderGeneration),
      revision: f.revision,
      createdAt: v.createdAt.toISOString(),
    });
  }
  private async versionRows(s: Interaction, fileId: string) {
    const rows = await s.tx.teamFileVersion.findMany({
      where: { ...this.op.scope(s), fileId },
      orderBy: { number: 'desc' },
      take: MAX_VERSIONS,
    });
    return Promise.all(
      rows.map(async (v) => ({
        v,
        f: await this.files.row(s.tx, this.scope(s), v.id),
      })),
    );
  }
  private async fileView(s: Interaction, r: TeamFile, manager: boolean) {
    const versions = await this.versionRows(s, r.id),
      current = versions.find((x) => x.f.status === 'READY'),
      latest = versions[0],
      editable = !r.removedAt && (this.owns(s, r) || manager);
    return c.TeamFileSchema.parse({
      id: r.id,
      folderId: r.folderId,
      title: r.title,
      owner: ref(r.ownerAccessId, r.ownerGeneration),
      current: current ? this.versionView(current.v, current.f) : null,
      latest: latest ? this.versionView(latest.v, latest.f) : null,
      versionCount: versions.length,
      removed: r.removedAt !== null,
      revision: r.revision,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      can: {
        upload: editable && this.op.access(s).role !== 'VIEWER',
        edit: editable,
        remove: editable,
      },
    });
  }
  private async fileRow(s: Interaction, fileId: string, live = true) {
    const row = await s.tx.teamFile.findFirst({
      where: {
        id: fileId,
        ...this.op.scope(s),
        ...(live ? { removedAt: null } : {}),
      },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  private async editableFile(s: Interaction, fileId: string) {
    const row = await this.fileRow(s, fileId);
    if (!this.owns(s, row) && !(await this.manager(s)))
      throw new ForbiddenException();
    return row;
  }
  list(
    actor: RequestActor,
    id: string,
    q: z.infer<typeof c.TeamFileQuerySchema>,
  ) {
    return this.op.read(actor, id, async (s) => {
      const manager = await this.manager(s);
      return this.op.page(
        s,
        'team-files:' + (q.folderId ?? ''),
        q,
        async (after) =>
          Promise.all(
            (
              await s.tx.teamFile.findMany({
                where: {
                  ...this.op.scope(s),
                  removedAt: null,
                  ...(q.folderId
                    ? { folderId: q.folderId === 'root' ? null : q.folderId }
                    : {}),
                  ...(after ? { id: { gt: after } } : {}),
                },
                orderBy: { id: 'asc' },
                take: q.limit + 1,
              })
            ).map((r) => this.fileView(s, r, manager)),
          ),
      );
    });
  }
  read(actor: RequestActor, id: string, fileId: string) {
    return this.op.read(actor, id, async (s) =>
      this.fileView(s, await this.fileRow(s, fileId), await this.manager(s)),
    );
  }
  private async addVersion(
    s: Interaction,
    fileId: string,
    versionId: string,
    upload: z.infer<typeof c.TeamFileCreateSchema>['upload'],
  ) {
    const last = await s.tx.teamFileVersion.findFirst({
      where: { ...this.op.scope(s), fileId },
      orderBy: { number: 'desc' },
    });
    if ((last?.number ?? 0) >= MAX_VERSIONS)
      throw new ConflictException({ code: 'FILE_VERSION_LIMIT' });
    await this.files.initiate(s.tx, this.scope(s), versionId, upload, s.now);
    const me = this.me(s);
    return s.tx.teamFileVersion.create({
      data: {
        id: versionId,
        ...this.op.scope(s),
        fileId,
        number: (last?.number ?? 0) + 1,
        uploaderAccessId: me.accessId,
        uploaderGeneration: me.generation,
      },
    });
  }
  create(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.TeamFileCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.TeamFileCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'task.create',
      [],
      'team.files.file.create',
      body.id,
      async (s) => {
        if (body.folderId) await this.folderRow(s, body.folderId);
        await this.op.once(s, 'team.files.file.create', key, body, async () => {
          if (
            (await s.tx.teamFile.count({
              where: { ...this.op.scope(s), removedAt: null },
            })) >= 10000
          )
            throw new PayloadTooLargeException();
          await s.begin();
          const me = this.me(s);
          const file = await s.tx.teamFile.create({
            data: {
              id: body.id,
              ...this.op.scope(s),
              folderId: body.folderId,
              title: body.title,
              ownerAccessId: me.accessId,
              ownerGeneration: me.generation,
              updatedAt: s.now,
            },
          });
          await this.addVersion(s, file.id, body.versionId, body.upload);
          return file;
        });
        return this.fileView(
          s,
          await this.fileRow(s, body.id),
          await this.manager(s),
        );
      },
    );
  }
  createVersion(
    actor: RequestActor,
    id: string,
    fileId: string,
    input: z.infer<typeof c.TeamFileVersionCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.TeamFileVersionCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'task.create',
      [],
      'team.files.version.create',
      body.id,
      async (s) => {
        const file = await this.editableFile(s, fileId);
        await this.op.once(
          s,
          'team.files.version.create',
          key,
          { ...body, fileId },
          async () => {
            await s.begin();
            await s.tx.teamFile.update({
              where: { id: file.id },
              data: { updatedAt: s.now, revision: { increment: 1 } },
            });
            return this.addVersion(s, fileId, body.id, body.upload);
          },
        );
        const v = await s.tx.teamFileVersion.findFirst({
          where: { id: body.id, ...this.op.scope(s), fileId },
        });
        if (!v) throw new NotFoundException();
        return this.versionView(
          v,
          await this.files.row(s.tx, this.scope(s), v.id),
        );
      },
    );
  }
  patch(
    actor: RequestActor,
    id: string,
    fileId: string,
    revision: number,
    input: z.infer<typeof c.TeamFilePatchSchema>,
  ) {
    const body = c.TeamFilePatchSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'task.read',
      [],
      'team.files.file.update',
      fileId,
      async (s) => {
        const row = await this.editableFile(s, fileId);
        this.op.match(row.revision, revision);
        if (body.folderId) await this.folderRow(s, body.folderId);
        await s.begin();
        const updated = await s.tx.teamFile.update({
          where: { id: row.id, revision: row.revision },
          data: {
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.folderId !== undefined ? { folderId: body.folderId } : {}),
            updatedAt: s.now,
            revision: { increment: 1 },
          },
        });
        return this.fileView(s, updated, await this.manager(s));
      },
    );
  }
  versions(actor: RequestActor, id: string, fileId: string, q: Page) {
    return this.op.read(actor, id, async (s) => {
      await this.fileRow(s, fileId);
      return this.op.page(s, 'team-file-versions:' + fileId, q, async (after) =>
        Promise.all(
          (
            await s.tx.teamFileVersion.findMany({
              where: {
                ...this.op.scope(s),
                fileId,
                ...(after ? { id: { gt: after } } : {}),
              },
              orderBy: { id: 'asc' },
              take: q.limit + 1,
            })
          ).map(async (v) =>
            this.versionView(
              v,
              await this.files.row(s.tx, this.scope(s), v.id),
            ),
          ),
        ),
      );
    });
  }
  private async version(s: Interaction, fileId: string, versionId: string) {
    await this.fileRow(s, fileId);
    const v = await s.tx.teamFileVersion.findFirst({
      where: { id: versionId, ...this.op.scope(s), fileId },
    });
    if (!v) throw new NotFoundException();
    return { v, f: await this.files.row(s.tx, this.scope(s), v.id) };
  }
  /** Streams bytes for an uploader-owned INITIATED version, then marks it READY (or REJECTED). */
  async complete(
    actor: RequestActor,
    id: string,
    fileId: string,
    versionId: string,
    revision: number,
    source: Readable,
    length: string | undefined,
  ) {
    const ticket = await this.op.write(
      actor,
      id,
      'task.create',
      [],
      'team.files.version.claim',
      versionId,
      async (s) => {
        const { v, f } = await this.version(s, fileId, versionId);
        if (f.status === 'READY') return { view: this.versionView(v, f) };
        this.op.match(f.revision, revision);
        await s.begin();
        return {
          ticket: await this.files.claim(s.tx, this.scope(s), f.id, s.now),
        };
      },
    );
    if ('view' in ticket) {
      source.resume();
      return ticket.view;
    }
    const abort = new AbortController(),
      timer = setTimeout(
        () => abort.abort(),
        this.config.FILE_UPLOAD_TIMEOUT_MS,
      );
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.active.set(versionId, { abort, finished });
    try {
      const evidence = await this.files.write(
        ticket.ticket,
        source,
        length,
        abort.signal,
      );
      return await this.op.write(
        actor,
        id,
        'task.create',
        [],
        'team.files.version.ready',
        versionId,
        async (s) => {
          const { v } = await this.version(s, fileId, versionId);
          await s.begin();
          const f = await this.files.ready(
            s.tx,
            this.scope(s),
            ticket.ticket,
            evidence,
            s.now,
          );
          return this.versionView(v, f);
        },
      );
    } catch (error) {
      await this.op
        .write(
          actor,
          id,
          'task.create',
          [],
          'team.files.version.reject',
          versionId,
          async (s) => {
            await s.begin();
            await this.files.reject(
              s.tx,
              this.scope(s),
              versionId,
              ticket.ticket.attempt,
            );
          },
        )
        .catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
      finish();
      this.active.delete(versionId);
    }
  }
  /** Re-checks Team access and the exact file revision after opening private bytes. */
  async download(
    actor: RequestActor,
    id: string,
    fileId: string,
    versionId: string,
  ) {
    const first = await this.op.read(actor, id, (s) =>
      this.version(s, fileId, versionId),
    );
    const stream = await this.files.open(first.f);
    try {
      await this.op.read(actor, id, async (s) => {
        const current = await this.version(s, fileId, versionId);
        if (
          current.f.revision !== first.f.revision ||
          current.f.status !== 'READY'
        )
          throw new NotFoundException();
      });
      return { stream, file: first.f };
    } catch (error) {
      stream.destroy();
      throw error;
    }
  }
  /** Owner or work manager: hides the file, deletes every private object and finishes cleanup. */
  async remove(
    actor: RequestActor,
    id: string,
    fileId: string,
    revision: number,
  ) {
    const removed = await this.op.write(
      actor,
      id,
      'task.read',
      [],
      'team.files.file.remove',
      fileId,
      async (s) => {
        const row = await this.editableFile(s, fileId);
        this.op.match(row.revision, revision);
        await s.begin();
        await s.tx.teamFile.update({
          where: { id: row.id, revision: row.revision },
          data: {
            removedAt: s.now,
            removedByActorId: this.op.access(s).actorId,
            updatedAt: s.now,
            revision: { increment: 1 },
          },
        });
        const stored: StoredFile[] = [];
        for (const { f } of await this.versionRows(s, fileId))
          stored.push(
            await this.files.deleted(
              s.tx,
              this.scope(s),
              f.id,
              f.revision,
              s.now,
            ),
          );
        return stored;
      },
    );
    for (const file of removed) {
      const active = this.active.get(file.id);
      if (active) {
        active.abort.abort();
        await active.finished;
      }
      await this.files.remove(file);
    }
    return this.op.write(
      actor,
      id,
      'task.read',
      [],
      'team.files.file.cleanup',
      fileId,
      async (s) => {
        for (const file of removed)
          await this.files.cleanupFinished(
            s.tx,
            this.scope(s),
            file.id,
            file.uploadAttemptId,
          );
        return this.fileView(
          s,
          await this.fileRow(s, fileId, false),
          await this.manager(s),
        );
      },
    );
  }
}
