import {
  Inject,
  Injectable,
  HttpException,
  ServiceUnavailableException,
  ConflictException,
} from '@nestjs/common';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedLifecycleService } from '../../spaces/public/index.js';
import { SharedFiles } from '../../../platform/storage/public/index.js';
import { MeetingKernel } from './meeting-kernel.js';
import { SharedCalendar } from '../../calendar/public/index.js';
@Injectable()
export class MeetingLifecycle {
  private afterSeat: string | undefined;
  constructor(
    @Inject(SharedLifecycleService) readonly lifecycle: SharedLifecycleService,
    @Inject(SharedFiles) private readonly files: SharedFiles,
    @Inject(MeetingKernel) private readonly owner: MeetingKernel,
    @Inject(SharedCalendar) private readonly calendar: SharedCalendar,
  ) {}
  status(a: RequestActor, id: string) {
    return this.lifecycle.status(a, id, 'MEETING');
  }
  issueProof(a: RequestActor, id: string, expected: number, password: string) {
    return this.lifecycle.issueProof(a, id, expected, password, 'MEETING');
  }
  recover(
    a: RequestActor,
    id: string,
    expected: number,
    generation: number,
    proof: string | undefined,
    password: string,
  ) {
    return this.lifecycle.recover(
      a,
      id,
      expected,
      generation,
      proof,
      password,
      (tx, now) => this.owner.recoverMember(tx, a, id, now),
      'MEETING',
    );
  }
  async consume() {
    const hint = await this.lifecycle.next('MEETING');
    if (!hint?.spaceId) {
      const r = await this.owner.reconcileSeats(this.afterSeat);
      this.afterSeat = r.after;
      return r.worked;
    }
    let lease: string | undefined;
    try {
      const result = await this.lifecycle.advance(
        hint,
        [],
        async (tx, s, stage) => {
          if (stage === 'FILES') {
            const files = await this.files.purgePlan(tx, s);
            return files.length ? { files } : { nextStage: 'CONTENT' };
          }
          if (stage === 'CONTENT')
            return (await this.owner.cleanup(tx, s))
              ? { nextStage: 'CALENDAR' }
              : {};
          if (stage === 'CALENDAR')
            return (await this.calendar.cleanup(tx, s))
              ? { nextStage: 'ADMISSIONS' }
              : {};
          if (stage === 'ADMISSIONS')
            return (await this.lifecycle.admissions(tx, s))
              ? { nextStage: 'STORAGE' }
              : {};
          if (stage === 'STORAGE')
            return (await this.files.purgeRows(tx, s))
              ? { nextStage: 'CORE' }
              : {};
          if (stage === 'CORE')
            return (await this.lifecycle.core(tx, s)) ? { finalize: true } : {};
          throw new ConflictException({ code: 'UNKNOWN_CLEANUP_STAGE' });
        },
        'MEETING',
        (tx, space) => this.owner.disposalBlocker(tx, space),
      );
      if (result?.transfer) {
        const p = result.transfer;
        lease = p.leaseId;
        await this.files.purgeRemove(p.files);
        await this.lifecycle.ack(
          p.jobId,
          p.spaceId,
          p.leaseId,
          p.files,
          (tx, s, files) => this.files.purgeAck(tx, s, files),
        );
      }
      return Boolean(result);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 404)
        return false;
      if (
        lease ||
        (error instanceof HttpException && error.getStatus() < 500)
      ) {
        await this.lifecycle.failure(hint, lease);
        return true;
      }
      throw new ServiceUnavailableException({
        code: 'SHARED_LIFECYCLE_RECONCILIATION_REQUIRED',
      });
    }
  }
}
