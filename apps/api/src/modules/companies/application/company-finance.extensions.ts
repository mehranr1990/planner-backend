import {
  Injectable,
  ServiceUnavailableException,
  ConflictException,
} from '@nestjs/common';
import type { CompanyExpenseVersion } from '../../../generated/prisma/client.js';
import type { StaffContext } from './company-staff.context.js';
type Guard = (
  s: StaffContext,
  versionId: string,
  final: boolean,
) => Promise<void>;
type Cancel = (
  s: StaffContext,
  target: {
    expenseVersionId?: string;
    reimbursementId?: string;
    budgetChangeRequestId?: string;
  },
) => Promise<void>;
type Changed = (
  s: StaffContext,
  expenseId: string,
  version: CompanyExpenseVersion | null,
) => Promise<void>;
/** Transaction-local source hooks avoid nested fences and circular service injection. */
@Injectable()
export class CompanyFinanceExtensions {
  private policy?: (
    s: StaffContext,
    kind: 'EXPENSE' | 'BUDGET_CHANGE',
    facts: { currency: string; amount: string; categoryId: string | null },
  ) => Promise<boolean>;
  submissionPolicies(handler: NonNullable<CompanyFinanceExtensions['policy']>) {
    if (this.policy) throw Error('Submission policy owner already registered');
    this.policy = handler;
  }
  async hasSubmissionPolicy(
    s: StaffContext,
    kind: 'EXPENSE' | 'BUDGET_CHANGE',
    facts: { currency: string; amount: string; categoryId: string | null },
  ) {
    if (!this.policy) throw new ServiceUnavailableException();
    return this.policy(s, kind, facts);
  }
  async requireSubmissionPolicy(
    s: StaffContext,
    kind: 'EXPENSE' | 'BUDGET_CHANGE',
    facts: { currency: string; amount: string; categoryId: string | null },
  ) {
    if (await this.hasSubmissionPolicy(s, kind, facts))
      throw new ConflictException({ code: 'APPROVAL_POLICY_REQUIRED' });
  }
  private guard?: Guard;
  private cancellation?: Cancel;
  private effective?: Changed;
  private alert?: (s: StaffContext) => Promise<void>;
  budgetAlerts(handler: (s: StaffContext) => Promise<void>) {
    if (this.alert) throw Error('Budget alert owner already registered');
    this.alert = handler;
  }
  async evaluateBudgetAlerts(s: StaffContext) {
    if (!this.alert) throw new ServiceUnavailableException();
    await this.alert(s);
  }
  approvals(guard: Guard, cancel: Cancel) {
    if (this.guard) throw Error('Financial approval owner already registered');
    this.guard = guard;
    this.cancellation = cancel;
  }
  reimbursements(changed: Changed) {
    if (this.effective) throw Error('Reimbursement owner already registered');
    this.effective = changed;
  }
  assertExpense(s: StaffContext, id: string, final = false) {
    if (!this.guard) throw new ServiceUnavailableException();
    return this.guard(s, id, final);
  }
  cancel(
    s: StaffContext,
    target: {
      expenseVersionId?: string;
      reimbursementId?: string;
      budgetChangeRequestId?: string;
    },
  ) {
    if (!this.cancellation) throw new ServiceUnavailableException();
    return this.cancellation(s, target);
  }
  changed(
    s: StaffContext,
    expenseId: string,
    version: CompanyExpenseVersion | null,
  ) {
    if (!this.effective) throw new ServiceUnavailableException();
    return this.effective(s, expenseId, version);
  }
}
