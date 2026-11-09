import { ProjectCompanyAssociations } from '../../projects/public/index.js';
import { TeamCompanyAssociations } from '../../teams/public/index.js';
import {
  Inject,
  Injectable,
  ConflictException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma, StoredFile } from '../../../generated/prisma/client.js';
import { MessagingService } from '../../messaging/public/index.js';
import { MeetingKernel } from '../../meetings/public/index.js';
import { sharedDeleteBatch } from '../../../platform/lifecycle/shared-cleanup.js';
import type { SharedCleanupScope } from '../../../platform/lifecycle/shared-cleanup.js';
import { SharedFiles } from '../../../platform/storage/public/index.js';
import {
  SharedLifecycleService,
  SharedKernel,
} from '../../spaces/public/index.js';
import type { LifecycleStep } from '../../spaces/public/index.js';
import { ProjectFinanceReferences } from '../../projects/public/index.js';
@Injectable()
export class CompanyCleanupService {
  constructor(
    @Inject(MessagingService) private readonly messaging: MessagingService,
    @Inject(MeetingKernel) private readonly meetings: MeetingKernel,
    @Inject(ProjectCompanyAssociations)
    private readonly projectAssociations: ProjectCompanyAssociations,
    @Inject(TeamCompanyAssociations)
    private readonly teamAssociations: TeamCompanyAssociations,
    @Inject(ProjectFinanceReferences)
    private readonly projects: ProjectFinanceReferences,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(SharedLifecycleService) readonly lifecycle: SharedLifecycleService,
    @Inject(SharedFiles) private readonly files: SharedFiles,
  ) {}
  async restoreRestrictions(spaceId: string) {
    let rows: StoredFile[] = [];
    const result = await this.kernel.restoreRestrictions(
      spaceId,
      async (tx, scope, id) => {
        rows = await this.files.restoreDeleted(tx, scope, id, true);
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
    if (!(await this.projectAssociations.cleanupCompany(tx, s))) return false;
    if (!(await this.teamAssociations.cleanupCompany(tx, s))) return false;
    if (!(await this.projects.cleanupCompany(tx, s))) return false;
    if (
      await tx.$executeRaw`UPDATE "CompanyKnowledgeDocument" SET "publishedVersionId"=NULL, revision=revision+1, "updatedAt"=clock_timestamp() WHERE id IN (SELECT id FROM "CompanyKnowledgeDocument" WHERE "spaceId"=${s.spaceId}::uuid AND "publishedVersionId" IS NOT NULL ORDER BY id LIMIT 25)`
    )
      return false;
    if (
      !(await sharedDeleteBatch(tx, s, [
        'CompanyKnowledgeVersion',
        'CompanyKnowledgeDocument',
        'CompanyFinancialApprovalEvent',
        'CompanyFinancialApproval',
        'CompanyFinancialWorkflowStep',
        'CompanyFinancialWorkflowVersion',
        'CompanyFinancialWorkflow',
        'CompanyReimbursementEffect',
        'CompanyAcknowledgementCorrection',
        'CompanyPaymentAcknowledgement',
        'CompanyReimbursementRequest',
        'CompanyReimbursementBucket',
        'CompanyExpenseReceipt',
        'CompanyExpenseReviewEvent',
        'CompanyExpenseAllocation',
      ]))
    )
      return false;
    // Self-referencing adjustment history is removed from its leaves, never by arbitrary ID batches.
    if (
      await tx.$executeRaw`DELETE FROM "CompanyBudgetEffect" WHERE id IN (SELECT p.id FROM "CompanyBudgetEffect" p WHERE p."spaceId"=${s.spaceId}::uuid AND NOT EXISTS(SELECT 1 FROM "CompanyBudgetEffect" c WHERE c."reversalOfId"=p.id) ORDER BY p.id LIMIT 200)`
    )
      return false;
    if (
      await tx.$executeRaw`UPDATE "CompanyExpense" SET "effectiveVersionId"=NULL,state='PENDING',revision=revision+1,"updatedAt"=clock_timestamp() WHERE id IN (SELECT id FROM "CompanyExpense" WHERE "spaceId"=${s.spaceId}::uuid AND "effectiveVersionId" IS NOT NULL ORDER BY id LIMIT 25)`
    )
      return false;
    if (
      !(await sharedDeleteBatch(tx, s, [
        'CompanyExpenseVersion',
        'CompanyExpense',
        'CompanyCommitment',
        'CompanyBudgetAdjustment',
        'CompanyBudget',
        'CompanyExpenseCategory',
        'CompanyFinanceProjectReference',
        'CompanyEmployeeCaseEntry',
        'CompanyEmployeeCase',
        'CompanyResourceAllocation',
        'CompanyResource',
        'CompanyAvailabilityDay',
        'CompanyStaffProfile',
      ]))
    )
      return false;
    if (
      await tx.$executeRaw`DELETE FROM "CompanyKnowledgeFolder" WHERE id IN (SELECT p.id FROM "CompanyKnowledgeFolder" p WHERE p."spaceId"=${s.spaceId}::uuid AND NOT EXISTS(SELECT 1 FROM "CompanyKnowledgeFolder" c WHERE c."parentId"=p.id) ORDER BY p.id LIMIT 200)`
    )
      return false;
    return sharedDeleteBatch(tx, s, [
      'CompanyContextAdmission',
      'CompanyScopePolicy',
      'CompanyUnit',
      'CompanyDepartment',
    ]);
  }
  async consume() {
    const hint = await this.lifecycle.next('COMPANY');
    if (!hint?.spaceId) return false;
    const users: string[] = [];
    let claimedLease: string | undefined;
    try {
      const result = await this.lifecycle.advance(
        hint,
        users,
        async (tx, s, stage): Promise<LifecycleStep> => {
          if (stage === 'FILES') {
            const files = await this.files.purgePlan(tx, s, true);
            return files.length ? { files } : { nextStage: 'ADMISSIONS' };
          }
          if (stage === 'ADMISSIONS')
            return (await this.lifecycle.admissions(tx, s))
              ? { nextStage: 'NOTIFICATIONS' }
              : {};
          if (stage === 'NOTIFICATIONS')
            return { nextStage: 'COMPANY_CONTENT' };
          if (stage === 'COMPANY_CONTENT')
            return (await this.content(tx, s)) ? { nextStage: 'STORAGE' } : {};
          if (stage === 'STORAGE')
            return (await this.files.purgeRows(tx, s))
              ? { nextStage: 'COMPANY_ROOT' }
              : {};
          if (stage === 'COMPANY_ROOT')
            return (await sharedDeleteBatch(tx, s, ['Company']))
              ? { nextStage: 'CORE' }
              : {};
          if (stage === 'CORE')
            return (await this.lifecycle.core(tx, s)) ? { finalize: true } : {};
          throw new ConflictException({ code: 'UNKNOWN_CLEANUP_STAGE' });
        },
        'COMPANY',
        async (tx, spaceId) =>
          (await this.meetings.disposalBlocker(tx, spaceId)) ??
          this.messaging.disposalBlocker(tx, spaceId),
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
          (tx, s, files) => this.files.purgeAck(tx, s, files, true),
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
}
