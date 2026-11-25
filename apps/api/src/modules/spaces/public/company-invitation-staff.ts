import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { CompanyTransaction } from './company-transaction.js';
export type InvitationStaffDraft = {
  position?: string | null;
  supervisorMemberId?: string | null;
  supervisorGeneration?: number | null;
};
export type InvitationStaffOwner = {
  validate(
    ctx: CompanyTransaction,
    scopeId: string,
    draft: InvitationStaffDraft,
  ): Promise<InvitationStaffDraft>;
  apply(
    ctx: CompanyTransaction,
    scopeId: string,
    member: { accessId: string; generation: number },
    draft: InvitationStaffDraft,
  ): Promise<void>;
};
/** Company owns staff profiles; Spaces invokes this narrow transactional contract. */
@Injectable()
export class CompanyInvitationStaff {
  private owner?: InvitationStaffOwner;
  register(owner: InvitationStaffOwner) {
    if (this.owner)
      throw new Error('Company invitation staff owner already registered');
    this.owner = owner;
  }
  private require() {
    if (!this.owner)
      throw new ServiceUnavailableException('Company staff owner unavailable');
    return this.owner;
  }
  validate(
    ctx: CompanyTransaction,
    scopeId: string,
    draft: InvitationStaffDraft,
  ) {
    return this.require().validate(ctx, scopeId, draft);
  }
  apply(
    ctx: CompanyTransaction,
    scopeId: string,
    member: { accessId: string; generation: number },
    draft: InvitationStaffDraft,
  ) {
    return this.require().apply(ctx, scopeId, member, draft);
  }
}
