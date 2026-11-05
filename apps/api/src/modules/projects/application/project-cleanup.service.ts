import {
  Inject,
  Injectable,
  ConflictException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma, StoredFile } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import {
  sharedDeleteBatch,
  sharedVersionedDelete,
} from '../../../platform/lifecycle/shared-cleanup.js';
import type { SharedCleanupScope } from '../../../platform/lifecycle/shared-cleanup.js';
import { SharedFiles } from '../../../platform/storage/public/index.js';
import {
  SharedLifecycleService,
  SharedKernel,
} from '../../spaces/public/index.js';
import type { LifecycleStep } from '../../spaces/public/index.js';
import { SharedTasksCleanup } from '../../tasks/public/index.js';
import { SharedGoalsCleanup } from '../../goals/public/index.js';
import { SharedScheduling } from '../../calendar/public/index.js';
import { SharedWorkNotifications } from '../../notifications/public/index.js';
@Injectable()
export class ProjectCleanupService {
  constructor(
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(SharedLifecycleService) readonly lifecycle: SharedLifecycleService,
    @Inject(SharedFiles) private readonly files: SharedFiles,
    @Inject(SharedTasksCleanup) private readonly tasks: SharedTasksCleanup,
    @Inject(SharedGoalsCleanup) private readonly goals: SharedGoalsCleanup,
    @Inject(SharedScheduling) private readonly calendar: SharedScheduling,
    @Inject(SharedWorkNotifications)
    private readonly notifications: SharedWorkNotifications,
  ) {}
  async restoreRestrictions(spaceId: string) {
    let rows: StoredFile[] = [];
    const result = await this.kernel.restoreRestrictions(
      spaceId,
      async (tx, scope, id) => {
        rows = await this.files.restoreDeleted(tx, scope, id);
      },
    );
    // Private IO is outside the replay transaction; metadata already denies every download.
    for (const row of rows) await this.files.remove(row);
    if (result.complete)
      await this.kernel.restoredFileEffect(spaceId, (tx, scope) =>
        this.files.restoreRemoved(tx, scope, rows),
      );
    return {
      ...result,
      complete: result.complete && rows.length < 25,
      filesRemoved: rows.length,
    };
  }
  private async content(tx: Prisma.TransactionClient, s: SharedCleanupScope) {
    if (
      !(await sharedDeleteBatch(tx, s, [
        'TeamProjectReference',
        'ProjectActivity',
        'ProjectCommentVersion',
        'ProjectComment',
        'ProjectFile',
        'ProjectWorkAllocation',
        'ProjectCapacityDay',
        'ProjectReportSource',
        'ProjectReportSnapshot',
        'ProjectChangeSource',
        'ProjectChangePlan',
        'ProjectTransfer',
        'ProjectRiskIssueEvent',
        'ProjectRiskIssue',
        'TaskAssignment',
        'ProjectTask',
        'ProjectGoal',
        'ProjectMemberAssignment',
        'ProjectMilestone',
        'ProjectSection',
        'ProjectPhase',
      ]))
    )
      return false;
    if (
      !(await sharedVersionedDelete(
        tx,
        s,
        'ProjectTemplate',
        'ProjectTemplateVersion',
        'templateId',
      ))
    )
      return false;
    return sharedVersionedDelete(
      tx,
      s,
      'ProjectDocument',
      'ProjectDocumentVersion',
      'documentId',
      'revision',
    );
  }
  async consume() {
    const hint = await this.lifecycle.next();
    if (!hint?.spaceId) return false;
    const p = hint.progress as Record<string, unknown>,
      calendar =
        p.stage === 'CALENDAR'
          ? await this.calendar.cleanupHints(hint.spaceId)
          : { blockIds: [], userIds: [] };
    let claimedLease: string | undefined;
    try {
      const result = await this.lifecycle.advance(
        hint,
        calendar.userIds,
        async (tx, s, stage): Promise<LifecycleStep> => {
          if (stage === 'FILES') {
            const files = await this.files.purgePlan(tx, s);
            return files.length ? { files } : { nextStage: 'ADMISSIONS' };
          }
          if (stage === 'ADMISSIONS')
            return (await this.lifecycle.admissions(tx, s))
              ? { nextStage: 'NOTIFICATIONS' }
              : {};
          if (stage === 'NOTIFICATIONS')
            return (await this.notifications.cleanup(tx, s))
              ? { nextStage: 'CALENDAR' }
              : {};
          if (stage === 'CALENDAR')
            return (await this.calendar.cleanup(tx, s, calendar.blockIds))
              ? { nextStage: 'PROJECTS' }
              : {};
          if (stage === 'PROJECTS')
            return (await this.content(tx, s)) ? { nextStage: 'GOALS' } : {};
          if (stage === 'GOALS')
            return (await this.goals.batch(tx, s))
              ? { nextStage: 'TASKS' }
              : {};
          if (stage === 'TASKS')
            return (await this.tasks.batch(tx, s))
              ? { nextStage: 'STORAGE' }
              : {};
          if (stage === 'STORAGE')
            return (await this.files.purgeRows(tx, s))
              ? { nextStage: 'PROJECT_ROOT' }
              : {};
          if (stage === 'PROJECT_ROOT')
            return (await sharedDeleteBatch(tx, s, ['Project']))
              ? { nextStage: 'CORE' }
              : {};
          if (stage === 'CORE')
            return (await this.lifecycle.core(tx, s)) ? { finalize: true } : {};
          throw new ConflictException({ code: 'UNKNOWN_CLEANUP_STAGE' });
        },
      );
      if (result?.transfer) {
        const pass = result.transfer;
        claimedLease = pass.leaseId;
        await this.files.purgeRemove(pass.files);
        await this.lifecycle.ack(
          pass.jobId,
          pass.spaceId,
          pass.leaseId,
          pass.files,
          (tx, s, files) => this.files.purgeAck(tx, s, files),
        );
      }
      return Boolean(result);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 404)
        return false;
      if (
        claimedLease ||
        (error instanceof HttpException && error.getStatus() < 500)
      ) {
        await this.lifecycle.failure(hint, claimedLease);
        return true;
      }
      throw new ServiceUnavailableException({
        code: 'SHARED_LIFECYCLE_RECONCILIATION_REQUIRED',
      });
    }
  }
  recover(
    actor: RequestActor,
    pid: string,
    expected: number,
    generation: number,
    proof: string | undefined,
    password: string,
  ) {
    return this.lifecycle.recover(
      actor,
      pid,
      expected,
      generation,
      proof,
      password,
      async (tx, now) => {
        await tx.project.update({
          where: { id: pid },
          data: { revision: { increment: 1 }, updatedAt: now },
        });
      },
    );
  }
}
