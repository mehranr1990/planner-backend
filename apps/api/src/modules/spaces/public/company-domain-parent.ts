import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
/** Companies owns Department/Unit ancestry; Spaces consumes only authorized boundary coordinates. */
@Injectable()
export class CompanyDomainParent {
  private owner?: (
    tx: Prisma.TransactionClient,
    companyId: string,
    parentScopeId: string,
  ) => Promise<string[]>;
  register(owner: NonNullable<CompanyDomainParent['owner']>) {
    if (this.owner)
      throw new Error('Company domain parent owner already registered');
    this.owner = owner;
  }
  ancestors(
    tx: Prisma.TransactionClient,
    companyId: string,
    parentScopeId: string,
  ) {
    if (!this.owner)
      throw new ServiceUnavailableException({
        code: 'COMPANY_DOMAIN_PARENT_UNAVAILABLE',
      });
    return this.owner(tx, companyId, parentScopeId);
  }
}
