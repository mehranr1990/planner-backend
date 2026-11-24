import { ForbiddenException } from '@nestjs/common';
/** Public explanation is separately stored/validated; confidential Admin notes never enter identity admission. */
export class AccountSuspendedException extends ForbiddenException {
  readonly publicReason: string;
  constructor(reason: string | null) {
    super({ code: 'ACCOUNT_SUSPENDED', message: 'Forbidden' });
    this.publicReason = (
      reason ?? 'Account access is temporarily restricted'
    ).slice(0, 500);
  }
}
