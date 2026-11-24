import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AdminCommand } from '../../../platform/admin/admin-command.js';
import { SharedIdentity } from '../../../platform/auth/shared-identity.js';
import { InvitationMailService } from './invitation-mail.service.js';
import { SharedKernel } from './shared-kernel.service.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { CollaborationLimit } from './collaboration-limit.js';
import { roleInContext } from '../domain/shared-policy.js';
import type { MemberRole } from '../domain/shared-policy.js';
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const safe = <T>(v: T) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
@Injectable()
export class AdminCollaboration {
  constructor(
    @Inject(InvitationMailService) private readonly mail: InvitationMailService,
    @Inject(SharedIdentity) private readonly identity: SharedIdentity,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CollaborationLimit) private readonly limit: CollaborationLimit,
  ) {}
  async invitation(
    command: AdminCommand,
    selector: string,
    input: { userId: string; role: string },
  ) {
    command.require('admin.memberships.add');
    const id = randomUUID();
    return this.kernel.administer(
      command,
      selector,
      [input.userId],
      async (tx, attribution, audit) => {
        const custody = await this.kernel.lifecycleCustody(tx, selector);
        if (
          !roleInContext(input.role as MemberRole, custody.kind) ||
          input.role === 'OWNER'
        )
          throw new BadRequestException();
        await this.kernel.verifiedRecipient(tx, input.userId);
        await this.kernel.featureGrowth(
          tx,
          custody.spaceId,
          selector === custody.spaceId
            ? 'shared.membership'
            : 'company.context-membership',
        );
        const root = await tx.sharedCustody.findUniqueOrThrow({
          where: { spaceId: custody.spaceId },
        });
        const issuer = await tx.contextAccess.findUniqueOrThrow({
          where: { id: root.primaryOwnerAccessId! },
        });
        const local = await tx.sharedActor.findFirst({
          where: {
            spaceId: custody.spaceId,
            userId: input.userId,
            state: 'ACTIVE',
          },
        });
        const target = local
          ? await tx.contextAccess.findUnique({
              where: {
                spaceId_scopeId_actorId: {
                  spaceId: custody.spaceId,
                  scopeId: selector,
                  actorId: local.id,
                },
              },
            })
          : null;
        if (target && ['ACTIVE', 'SUSPENDED', 'ERASED'].includes(target.state))
          throw new ConflictException({
            code: 'EXPLICIT_READMISSION_REQUIRED',
          });
        const recipientRoot = local
          ? await tx.contextAccess.findUnique({
              where: {
                spaceId_scopeId_actorId: {
                  spaceId: custody.spaceId,
                  scopeId: custody.spaceId,
                  actorId: local.id,
                },
              },
            })
          : null;
        if (
          selector !== custody.spaceId &&
          (recipientRoot?.state !== 'ACTIVE' || !recipientRoot.memberRole)
        )
          throw new ConflictException({
            code: 'COMPANY_ROOT_ADMISSION_REQUIRED',
          });
        if (
          await tx.contextInvitation.findFirst({
            where: {
              spaceId: custody.spaceId,
              scopeId: custody.kind === 'COMPANY' ? custody.spaceId : selector,
              companyScopeId: custody.kind === 'COMPANY' ? selector : null,
              recipientUserId: input.userId,
              state: 'PENDING',
              expiresAt: { gt: new Date() },
            },
          })
        )
          throw new ConflictException({ code: 'INVITATION_PENDING' });
        await this.limit.take('invitation.context:' + selector, 20, tx);
        const proof = randomBytes(32).toString('base64url');
        const now = (
          await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
        )[0]!.now;
        const row = await tx.contextInvitation.create({
          data: {
            id,
            spaceId: custody.spaceId,
            scopeId: custody.kind === 'COMPANY' ? custody.spaceId : selector,
            inviterAccessId:
              custody.kind === 'COMPANY'
                ? issuer.id
                : custody.primaryOwnerAccessId!,
            inviterGeneration:
              custody.kind === 'COMPANY'
                ? issuer.generation
                : (
                    await tx.contextAccess.findUniqueOrThrow({
                      where: { id: custody.primaryOwnerAccessId! },
                    })
                  ).generation,
            initiatedByAdminId: command.adminId,
            recipientUserId: input.userId,
            memberRole: input.role,
            recipientAccessId: target?.id ?? null,
            recipientGeneration: target?.generation ?? null,
            recipientRevision: target?.revision ?? null,
            keyHash: hash(command.adminId + command.key),
            fingerprint: hash(JSON.stringify(input)),
            proofHash: hash(proof),
            createdAt: now!,
            expiresAt: new Date(now!.getTime() + 604800000),
            ...(custody.kind === 'TEAM' && selector !== custody.spaceId
              ? {
                  companyRecipientRootAccessId: recipientRoot!.id,
                  companyRecipientRootGeneration: recipientRoot!.generation,
                  companyRestoreGeneration: (
                    await tx.accessScope.findUniqueOrThrow({
                      where: { id: custody.spaceId },
                    })
                  ).restoreGeneration,
                }
              : {}),
            ...(custody.kind === 'COMPANY'
              ? {
                  companyScopeId: selector,
                  companyAdmissionVersion: 1,
                  companyIssuerAccessId: issuer.id,
                  companyIssuerGeneration: issuer.generation,
                  companyTargetAccessId: target?.id ?? null,
                  companyTargetGeneration: target?.generation ?? null,
                  companyTargetRevision: target?.revision ?? null,
                  companyRecipientRootAccessId:
                    selector !== custody.spaceId ? recipientRoot!.id : null,
                  companyRecipientRootGeneration:
                    selector !== custody.spaceId
                      ? recipientRoot!.generation
                      : null,
                  companyRestoreGeneration: (
                    await tx.accessScope.findUniqueOrThrow({
                      where: { id: custody.spaceId },
                    })
                  ).restoreGeneration,
                }
              : {}),
          },
        });
        const recipient = await this.identity.current(tx, input.userId);
        if (!recipient?.emailVerified)
          throw new ConflictException({ code: 'RECIPIENT_INELIGIBLE' });
        await this.mail.queueAdmin(
          tx,
          command.auditId,
          id,
          recipient.email,
          input.userId,
          proof,
        );
        await this.kernel.adminEffect(
          tx,
          command,
          selector,
          attribution,
          audit,
          'invitation.create',
          id,
        );
        await command.recordChange(tx, null, {
          id,
          state: row.state,
          role: input.role,
          recipientUserId: input.userId,
        });
        return safe({
          id,
          state: row.state,
          revision: row.revision,
          expiresAt: row.expiresAt,
        });
      },
      { action: 'invitation.create', resourceId: id },
    );
  }
  async membership(
    command: AdminCommand,
    selector: string,
    input: {
      membershipId: string;
      revision: number;
      role?: string | undefined;
    },
    remove: boolean,
  ) {
    command.require(
      remove ? 'admin.memberships.remove' : 'admin.memberships.update_role',
    );
    const hint = await this.db.client.contextAccess.findUnique({
      where: { id: input.membershipId },
      include: { SharedActor: true },
    });
    return this.kernel.administer(
      command,
      selector,
      hint?.SharedActor.userId ? [hint.SharedActor.userId] : [],
      async (tx, attribution, audit) => {
        const custody = await this.kernel.lifecycleCustody(tx, selector),
          root = await tx.sharedCustody.findUniqueOrThrow({
            where: { spaceId: custody.spaceId },
          });
        const row = await tx.contextAccess.findFirst({
          where: {
            id: input.membershipId,
            spaceId: custody.spaceId,
            scopeId: selector,
          },
        });
        if (!row) throw new NotFoundException();
        if (
          row.revision !== input.revision ||
          !['ACTIVE', 'SUSPENDED'].includes(row.state) ||
          !row.memberRole
        )
          throw new ConflictException({ code: 'STALE_MEMBERSHIP' });
        if (
          row.id === custody.primaryOwnerAccessId ||
          row.id === root.primaryOwnerAccessId
        )
          throw new ConflictException({
            code: 'CUSTODIAN_SUCCESSION_REQUIRED',
          });
        const role = remove ? row.memberRole : input.role!;
        if (
          role === 'OWNER' ||
          !roleInContext(role as MemberRole, custody.kind)
        )
          throw new BadRequestException();
        if (selector !== custody.spaceId) {
          const rootSeat = await tx.contextAccess.findUnique({
            where: {
              spaceId_scopeId_actorId: {
                spaceId: custody.spaceId,
                scopeId: custody.spaceId,
                actorId: row.actorId,
              },
            },
          });
          const binding = await tx.companyContextAdmission.findUnique({
            where: {
              accessId_generation: {
                accessId: row.id,
                generation: row.generation,
              },
            },
          });
          if (
            rootSeat?.state !== 'ACTIVE' ||
            binding?.rootAccessId !== rootSeat.id ||
            binding.rootGeneration !== rootSeat.generation
          )
            throw new ConflictException({ code: 'STALE_ROOT_ADMISSION' });
        }
        if (root.kind === 'COMPANY' && remove) {
          const allocations = await tx.companyResourceAllocation.count({
            where: {
              spaceId: custody.spaceId,
              memberAccessId: row.id,
              state: 'ALLOCATED',
              endAt: { gt: new Date() },
            },
          });
          const requests = await tx.companyResourceRequest.count({
            where: {
              spaceId: custody.spaceId,
              requesterAccessId: row.id,
              state: 'ACTIVE',
            },
          });
          const reviews = await tx.companyExpenseVersion.count({
            where: {
              spaceId: custody.spaceId,
              reviewerAccessId: row.id,
              state: 'SUBMITTED',
            },
          });
          const assets = await tx.companyAssetCustody.count({
            where: {
              spaceId: custody.spaceId,
              memberAccessId: row.id,
              returnedAt: null,
            },
          });
          if (allocations + requests + reviews + assets)
            throw new ConflictException({ code: 'MEMBERSHIP_DEPENDENCIES' });
        }
        const changed = await tx.contextAccess.update({
          where: { id: row.id },
          data: {
            memberRole: role,
            ...(remove ? { state: 'REVOKED', endedAt: new Date() } : {}),
            revision: { increment: 1 },
          },
        });
        if (remove)
          await tx.contextAccessInterval.update({
            where: {
              accessId_generation: {
                accessId: row.id,
                generation: row.generation,
              },
            },
            data: { endedAt: changed.endedAt },
          });
        await this.kernel.adminEffect(
          tx,
          command,
          selector,
          attribution,
          audit,
          'membership.change',
          row.id,
          remove
            ? {
                actorId: row.actorId,
                feature:
                  selector === custody.spaceId
                    ? 'shared.membership'
                    : 'company.context-membership',
                delta: -1,
              }
            : undefined,
        );
        if (hint?.SharedActor.userId)
          await tx.adminDelivery.create({
            data: {
              auditId: command.auditId,
              targetUserId: hint.SharedActor.userId,
              kind: 'MEMBERSHIP_CHANGED',
              payload: { workspaceId: selector },
            },
          });
        await command.recordChange(
          tx,
          {
            id: row.id,
            state: row.state,
            role: row.memberRole,
            revision: row.revision,
            generation: row.generation,
          },
          {
            id: changed.id,
            state: changed.state,
            role: changed.memberRole,
            revision: changed.revision,
            generation: changed.generation,
          },
        );
        return safe({
          id: changed.id,
          revision: changed.revision,
          state: changed.state,
          role: changed.memberRole,
        });
      },
      { action: 'membership.change', resourceId: input.membershipId },
    );
  }
  async invitationAction(
    command: AdminCommand,
    selector: string,
    input: { invitationId: string; revision: number },
    resend: boolean,
  ) {
    command.require('admin.memberships.invitations.manage');
    return this.kernel.administer(
      command,
      selector,
      [],
      async (tx, attribution, audit) => {
        const custody = await this.kernel.lifecycleCustody(tx, selector);
        const row = await tx.contextInvitation.findFirst({
          where: {
            id: input.invitationId,
            spaceId: custody.spaceId,
            OR: [
              { companyScopeId: selector },
              { scopeId: selector, companyScopeId: null },
            ],
          },
        });
        if (!row) throw new NotFoundException();
        if (
          row.revision !== input.revision ||
          row.state !== 'PENDING' ||
          row.expiresAt <= new Date()
        )
          throw new ConflictException({ code: 'INVITATION_NOT_PENDING' });
        await this.limit.take('invitation.context:' + selector, 20, tx);
        const newProof = resend ? randomBytes(32).toString('base64url') : null;
        const changed = await tx.contextInvitation.update({
          where: { id: row.id },
          data: resend
            ? {
                proofHash: hash(newProof!),
                resentAt: new Date(),
                revision: { increment: 1 },
              }
            : {
                state: 'REVOKED',
                endedAt: new Date(),
                recipientUserId: null,
                recipientEmail: null,
                proofHash: null,
                revision: { increment: 1 },
              },
        });
        if (resend) {
          const recipient = row.recipientUserId
            ? await this.identity.current(tx, row.recipientUserId)
            : row.recipientEmail
              ? await this.identity.byEmail(tx, row.recipientEmail)
              : null;
          if (!recipient && !row.recipientEmail)
            throw new ConflictException({ code: 'RECIPIENT_ACCOUNT_REQUIRED' });
          await this.mail.queueAdmin(
            tx,
            command.auditId,
            row.id,
            row.recipientEmail ?? recipient!.email,
            recipient?.id ?? null,
            newProof!,
          );
        }
        await this.kernel.adminEffect(
          tx,
          command,
          selector,
          attribution,
          audit,
          resend ? 'invitation.resend' : 'invitation.revoke',
          row.id,
        );
        await command.recordChange(
          tx,
          { id: row.id, state: row.state, revision: row.revision },
          { id: changed.id, state: changed.state, revision: changed.revision },
        );
        return safe({
          id: row.id,
          state: changed.state,
          revision: changed.revision,
          expiresAt: changed.expiresAt,
        });
      },
      {
        action: resend ? 'invitation.resend' : 'invitation.revoke',
        resourceId: input.invitationId,
      },
    );
  }
  async handover(
    command: AdminCommand,
    selector: string,
    input: { successorAccessId: string; revision: number },
  ) {
    command.require('admin.workspaces.transfer_owner');
    const id = randomUUID();
    const hint = await this.db.client.contextAccess.findUnique({
      where: { id: input.successorAccessId },
      include: { SharedActor: true },
    });
    if (!hint?.SharedActor.userId) throw new NotFoundException();
    const successorId = hint.SharedActor.userId;
    return this.kernel.administer(
      command,
      selector,
      [successorId],
      async (tx, attribution, audit) => {
        const custody = await this.kernel.lifecycleCustody(tx, selector);
        if (custody.revision !== input.revision)
          throw new ConflictException({ code: 'STALE_CUSTODY' });
        await this.kernel.verifiedRecipient(tx, successorId);
        const successor = await tx.contextAccess.findFirst({
          where: {
            id: input.successorAccessId,
            spaceId: custody.spaceId,
            scopeId: selector,
            state: 'ACTIVE',
            memberRole: { not: null },
            SharedActor: { userId: successorId, state: 'ACTIVE' },
          },
        });
        const from = await tx.contextAccess.findUniqueOrThrow({
          where: { id: custody.primaryOwnerAccessId! },
        });
        if (!successor || from.id === successor.id)
          throw new ConflictException({ code: 'SUCCESSOR_INELIGIBLE' });
        if (
          await tx.ownerHandover.findFirst({
            where: {
              spaceId: custody.spaceId,
              scopeId: selector,
              state: 'PENDING',
            },
          })
        )
          throw new ConflictException({ code: 'HANDOVER_ALREADY_PENDING' });
        await this.limit.take('handover.context:' + selector, 5, tx);
        const now = (
          await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
        )[0]!.now;
        const row = await tx.ownerHandover.create({
          data: {
            id,
            spaceId: custody.spaceId,
            scopeId: selector,
            fromAccessId: from.id,
            fromGeneration: from.generation,
            toAccessId: successor.id,
            toGeneration: successor.generation,
            initiatedByAdminId: command.adminId,
            expectedCustodyRevision: custody.revision + 1,
            keyHash: hash(command.adminId + command.key),
            fingerprint: hash(JSON.stringify(input)),
            createdAt: now!,
            expiresAt: new Date(now!.getTime() + 604800000),
          },
        });
        await this.kernel.adminEffect(
          tx,
          command,
          selector,
          attribution,
          audit,
          'handover.propose',
          row.id,
        );
        await tx.adminDelivery.create({
          data: {
            auditId: command.auditId,
            targetUserId: successorId,
            kind: 'OWNERSHIP_OFFER',
            payload: { workspaceId: selector, handoverId: row.id },
          },
        });
        const previousOwner = (
          await tx.sharedActor.findUniqueOrThrow({
            where: { id: from.actorId },
          })
        ).userId;
        if (previousOwner)
          await tx.adminDelivery.create({
            data: {
              auditId: command.auditId,
              targetUserId: previousOwner,
              kind: 'OWNERSHIP_OFFER',
              payload: { workspaceId: selector, handoverId: row.id },
            },
          });
        await command.recordChange(
          tx,
          { ownerAccessId: from.id, custodyRevision: custody.revision },
          {
            ownerAccessId: from.id,
            handoverId: row.id,
            successorAccessId: successor.id,
            state: 'PENDING',
          },
        );
        return safe({
          id: row.id,
          state: row.state,
          revision: row.revision,
          expiresAt: row.expiresAt,
          expectedCustodyRevision: row.expectedCustodyRevision,
        });
      },
      { action: 'handover.propose', resourceId: id },
    );
  }
}
