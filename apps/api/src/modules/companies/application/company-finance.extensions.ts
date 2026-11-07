import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { CompanyExpenseVersion } from '../../../generated/prisma/client.js';
import type { StaffContext } from './company-staff.context.js';
type Guard = (
  s: StaffContext,
  versionId: string,
  final: boolean,
) => Promise<void>;
type Cancel = (
  s: StaffContext,
  target: { expenseVersionId?: string; reimbursementId?: string },
) => Promise<void>;
type Changed = (
  s: StaffContext,
  expenseId: string,
  version: CompanyExpenseVersion | null,
) => Promise<void>;
/** Transaction-local source hooks avoid nested fences and circular service injection. */
@Injectable()
export class CompanyFinanceExtensions {
  private guard?: Guard;
  private cancellation?: Cancel;
  private effective?: Changed;
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
    target: { expenseVersionId?: string; reimbursementId?: string },
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
