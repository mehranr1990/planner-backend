import { Inject, Injectable, ConflictException } from '@nestjs/common';
import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
import {
  SharedKernel,
  CollaborationService,
  SharedLifecycleService,
} from '../../spaces/public/index.js';
import { AuthService } from '../../../platform/auth/auth.service.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { CompaniesService } from './companies.service.js';
@Injectable()
export class CompanyLifecycleService {
  constructor(
    @Inject(CompaniesService) private readonly companies: CompaniesService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(CollaborationService)
    private readonly collaboration: CollaborationService,
    @Inject(SharedLifecycleService)
    private readonly lifecycle: SharedLifecycleService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  async change(
    actor: RequestActor,
    id: string,
    revision: number,
    action: 'archive' | 'restore' | 'delete',
    password?: string,
  ) {
    await this.companies.hint(id);
    return this.kernel.companyLifecycle(actor, id, action, async (tx) => {
      const row = await tx.company.findUniqueOrThrow({ where: { id } });
      if (row.revision !== revision) throw new ConflictException();
      if (action === 'delete')
        await this.auth.verifyPasswordInside(tx, actor.userId, password ?? '');
      const updated = await tx.company.update({
        where: { id },
        data: { revision: { increment: 1 }, updatedAt: new Date() },
      });
      return { id, companyId: id, revision: updated.revision };
    });
  }
  async status(actor: RequestActor, id: string) {
    await this.companies.hint(id);
    return this.kernel.projectStatus(actor, id);
  }
  async handover(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.HandoverCreateSchema>,
    key?: string,
  ) {
    await this.companies.hint(id);
    return this.collaboration.createHandover(actor, id, input, key);
  }
  async readHandover(actor: RequestActor, id: string, handoverId: string) {
    await this.companies.hint(id);
    return this.collaboration.handover(actor, id, handoverId);
  }
  async decide(
    actor: RequestActor,
    id: string,
    handoverId: string,
    revision: number,
    decision: 'accept' | 'decline' | 'revoke',
    password?: string,
  ) {
    await this.companies.hint(id);
    return this.collaboration.decideHandover(
      actor,
      id,
      handoverId,
      revision,
      decision,
      password,
    );
  }
  async job(actor: RequestActor, id: string) {
    await this.companies.hint(id);
    return this.lifecycle.status(actor, id, 'COMPANY');
  }
  async proof(
    actor: RequestActor,
    id: string,
    revision: number,
    password: string,
  ) {
    await this.companies.hint(id);
    return this.lifecycle.issueProof(actor, id, revision, password, 'COMPANY');
  }
  async recover(
    actor: RequestActor,
    id: string,
    revision: number,
    generation: number,
    proof: string | undefined,
    password: string,
  ) {
    await this.companies.hint(id);
    return this.lifecycle.recover(
      actor,
      id,
      revision,
      generation,
      proof,
      password,
      async (tx, now) => {
        await tx.company.update({
          where: { id },
          data: { revision: { increment: 1 }, updatedAt: now },
        });
        await tx.accessScope.updateMany({
          where: { spaceId: id },
          data: { restoreGeneration: { increment: 1 } },
        });
      },
      'COMPANY',
    );
  }
}
