import { Inject, Injectable, ConflictException } from '@nestjs/common';
import type { ProductivityTaskPatch } from '@mehran/api-contracts';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { TASK_PRODUCTIVITY } from './productivity.port.js';
import type { TaskProductivityPort } from './productivity.port.js';
@Injectable()
export class TaskProductivityService {
  constructor(
    @Inject(TASK_PRODUCTIVITY) private readonly repo: TaskProductivityPort,
  ) {}
  get(scope: AuthorizedSpace, id: string) {
    return this.repo.run(scope, async (tx) => {
      const { unavailable: _, ...rest } = await tx.read(id);
      return rest;
    });
  }
  patch(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    input: ProductivityTaskPatch,
  ) {
    return this.repo.run(scope, async (tx) => {
      const before = await tx.read(id);
      if (before.revision !== revision || before.unavailable)
        throw new ConflictException();
      return tx.update(id, revision, input);
    });
  }
}
