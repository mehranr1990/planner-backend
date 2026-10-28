import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { NOTES_REPOSITORY } from './notes.port.js';
import type { NotesPort, NotesTransaction, PageQuery } from './notes.port.js';
import { validFolders } from '../domain/folders.js';
@Injectable()
export class NotesService {
  constructor(@Inject(NOTES_REPOSITORY) private readonly repo: NotesPort) {}
  private rev(v: { revision: number }, n: number) {
    if (v.revision !== n) throw new ConflictException();
  }
  private key(k: string | undefined) {
    if (!k) throw new BadRequestException();
    return k;
  }
  private async refs(
    tx: NotesTransaction,
    input: c.NoteCreate,
    before?: c.Note,
  ) {
    if (
      input.folderId &&
      input.folderId !== before?.folderId &&
      (await tx.folder(input.folderId)).state !== 'ACTIVE'
    )
      throw new BadRequestException();
    if (input.taskId && input.taskId !== before?.taskId)
      await tx.task(input.taskId);
    if (input.goalId && input.goalId !== before?.goalId)
      await tx.goal(input.goalId);
  }
  async createInside(tx: NotesTransaction, input: c.NoteCreate) {
    await this.refs(tx, input);
    const n = await tx.append({ ...input, state: 'ACTIVE' });
    await tx.audit('NOTE_CREATE', n.id);
    return n;
  }
  create(scope: AuthorizedSpace, key: string | undefined, input: c.NoteCreate) {
    return this.repo.once(scope, 'post.notes', this.key(key), input, (tx) =>
      this.createInside(tx, input),
    );
  }
  get(scope: AuthorizedSpace, id: string, includeDeleted = false) {
    return this.repo.run(scope, async (tx) => {
      const n = await tx.note(id);
      if (n.state === 'DELETED' && !includeDeleted)
        throw new NotFoundException();
      return n;
    });
  }
  list(scope: AuthorizedSpace, q: z.infer<typeof c.NoteQuerySchema>) {
    return this.repo.run(scope, (tx) => tx.notes(q));
  }
  patch(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    input: c.NotePatch,
  ) {
    return this.repo.run(scope, async (tx) => {
      const n = await tx.note(id);
      this.rev(n, revision);
      if (n.state === 'DELETED' && input.state !== 'ACTIVE')
        throw new ConflictException();
      const next = {
        title: input.title ?? n.title,
        content: input.content ?? n.content,
        state: input.state ?? n.state,
        folderId: input.folderId === undefined ? n.folderId : input.folderId,
        taskId: input.taskId === undefined ? n.taskId : input.taskId,
        goalId: input.goalId === undefined ? n.goalId : input.goalId,
      };
      await this.refs(tx, next, n);
      const result = await tx.append(next, n);
      await tx.audit('NOTE_UPDATE', id);
      return result;
    });
  }
  history(scope: AuthorizedSpace, id: string, q: PageQuery) {
    return this.repo.run(scope, async (tx) => {
      await tx.note(id);
      return tx.history(id, q);
    });
  }
  folder(scope: AuthorizedSpace, id: string) {
    return this.repo.run(scope, (tx) => tx.folder(id));
  }
  folders(scope: AuthorizedSpace, q: PageQuery) {
    return this.repo.run(scope, (tx) => tx.folders(q));
  }
  createFolder(
    scope: AuthorizedSpace,
    key: string | undefined,
    input: c.NoteFolderCreate,
  ) {
    return this.repo.once(
      scope,
      'post.note-folders',
      this.key(key),
      input,
      async (tx) => {
        const nodes = await tx.graph();
        if (nodes.length >= 1000) throw new BadRequestException();
        if (
          input.parentId &&
          (await tx.folder(input.parentId)).state !== 'ACTIVE'
        )
          throw new BadRequestException();
        if (
          !validFolders([...nodes, { id: 'new', parentId: input.parentId }], 5)
        )
          throw new BadRequestException();
        const f = await tx.createFolder(input);
        await tx.audit('NOTE_FOLDER_CREATE', f.id);
        return f;
      },
    );
  }
  patchFolder(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    input: c.NoteFolderPatch,
  ) {
    return this.repo.run(scope, async (tx) => {
      const f = await tx.folder(id);
      this.rev(f, revision);
      const parentId =
        input.parentId === undefined ? f.parentId : input.parentId;
      if (
        parentId &&
        parentId !== f.parentId &&
        (await tx.folder(parentId)).state !== 'ACTIVE'
      )
        throw new BadRequestException();
      const nodes = (await tx.graph()).map((n) =>
        n.id === id ? { ...n, parentId } : n,
      );
      if (!validFolders(nodes, 5)) throw new BadRequestException();
      const result = await tx.updateFolder(f, input);
      await tx.audit('NOTE_FOLDER_UPDATE', id);
      return result;
    });
  }
}
