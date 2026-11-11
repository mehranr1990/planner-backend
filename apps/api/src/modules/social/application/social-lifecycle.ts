import { Injectable, Inject, ConflictException } from '@nestjs/common';
import { SharedLifecycleService } from '../../spaces/public/index.js';
import {
  sharedDeleteBatch,
  sharedChildDeleteBatch,
} from '../../../platform/lifecycle/shared-cleanup.js';
@Injectable()
export class SocialLifecycle {
  constructor(
    @Inject(SharedLifecycleService) readonly lifecycle: SharedLifecycleService,
  ) {}
  async consume() {
    const hint = await this.lifecycle.next('SOCIAL_GROUP');
    if (!hint?.spaceId) return false;
    const result = await this.lifecycle.advance(
      hint,
      [],
      async (tx, s, stage) => {
        if (stage === 'FILES') return { nextStage: 'REQUESTS' };
        if (stage === 'REQUESTS')
          return (await sharedChildDeleteBatch(tx, s, 'SocialJoinRequest', [
            { table: 'SocialGroup', foreignKey: 'groupId' },
          ]))
            ? { nextStage: 'ADMISSIONS' }
            : {};
        if (stage === 'ADMISSIONS')
          return (await this.lifecycle.admissions(tx, s))
            ? { nextStage: 'ROOT' }
            : {};
        if (stage === 'ROOT')
          return (await sharedDeleteBatch(tx, s, ['SocialGroup']))
            ? { nextStage: 'CORE' }
            : {};
        if (stage === 'CORE')
          return (await this.lifecycle.core(tx, s)) ? { finalize: true } : {};
        throw new ConflictException({ code: 'UNKNOWN_CLEANUP_STAGE' });
      },
      'SOCIAL_GROUP',
    );
    return Boolean(result);
  }
}
