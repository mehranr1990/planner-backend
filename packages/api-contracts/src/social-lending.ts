import { z } from 'zod';
import { SocialPageQuerySchema } from './social.js';
/**
 * P6-04 Lending and Lost & Found (V3 01/02/03, FR-12, AUD-07). Records are
 * statements between verified accounts: nothing here proves legal ownership,
 * moves money or automates penalties. File evidence content is not accepted
 * (ADR 0057/0063); evidence is descriptive metadata only.
 */
const id = z.uuid();
const Instant = z.iso.datetime();
const Day = z.iso.date();
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item).max(100),
    nextCursor: z.string().nullable(),
  });
const Text = (max: number) => z.string().trim().min(1).max(max);
const Optional = (max: number) => z.string().max(max).nullable().optional();
const Search = z.string().trim().min(1).max(100).optional();

// Assets -----------------------------------------------------------------------
export const SocialAssetAudienceSchema = z.enum([
  'PRIVATE',
  'CONNECTIONS',
  'GROUP',
]);
export const SocialAssetCreateSchema = z
  .strictObject({
    id,
    audience: SocialAssetAudienceSchema,
    groupId: id.nullable().optional(),
    title: Text(200),
    description: Optional(2000),
  })
  .refine((v) => (v.audience === 'GROUP') === !!v.groupId, {
    message: 'groupId is required exactly for GROUP audience',
    path: ['groupId'],
  });
/** Owner only. Changing `audience` revokes the previous audience immediately. */
export const SocialAssetPatchSchema = z
  .strictObject({
    title: Text(200).optional(),
    description: Optional(2000),
    audience: SocialAssetAudienceSchema.optional(),
    groupId: id.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0)
  .refine(
    (v) =>
      v.audience === undefined
        ? v.groupId === undefined
        : (v.audience === 'GROUP') === !!v.groupId,
    { path: ['groupId'] },
  );
export const SocialAssetActionSchema = z.enum(['archive']);
export const SocialAssetListQuerySchema = SocialPageQuerySchema.extend({
  view: z.enum(['MINE', 'CONNECTIONS', 'GROUP']).default('MINE'),
  groupId: id.optional(),
  q: Search,
}).refine((v) => (v.view === 'GROUP') === !!v.groupId);
export const SocialAssetSchema = z.strictObject({
  id,
  ownerUserId: id.nullable(),
  isOwner: z.boolean(),
  audience: SocialAssetAudienceSchema,
  groupId: id.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  state: z.enum(['ACTIVE', 'ARCHIVED']),
  /** True while no accepted or custody-holding loan exists. */
  available: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: Instant,
  updatedAt: Instant,
});
export const SocialAssetPageSchema = page(SocialAssetSchema);

// Loans ------------------------------------------------------------------------
export const SocialLoanStateSchema = z.enum([
  'REQUESTED',
  'OFFERED',
  'ACCEPTED',
  'HANDED_OVER',
  'RETURN_REQUESTED',
  'DISPUTED',
  'RETURNED',
  'LOST',
  'DAMAGED',
  'REJECTED',
  'CANCELED',
]);
export const SocialLoanActionSchema = z.enum([
  'accept',
  'reject',
  'cancel',
  'handover',
  'receive',
  'return',
  'confirm-return',
  'report-lost',
  'report-damaged',
  'accept-outcome',
  'dispute',
  'resume',
  'accept-due',
  'decline-due',
  'withdraw-due',
]);
export const SocialLoanCreateSchema = z
  .strictObject({
    id,
    assetId: id,
    /** REQUEST: the caller asks to borrow. OFFER: the owner proposes a loan to `borrowerUserId`. */
    mode: z.enum(['REQUEST', 'OFFER']),
    borrowerUserId: id.optional(),
    dueAt: Instant.nullable().optional(),
    note: Optional(2000),
    /** OFFER only: the owner states the item is already with the borrower; this is not confirmed custody. */
    alreadyWithBorrower: z.boolean().optional(),
  })
  .refine((v) => (v.mode === 'OFFER') === !!v.borrowerUserId, {
    path: ['borrowerUserId'],
  })
  .refine((v) => v.mode === 'OFFER' || !v.alreadyWithBorrower, {
    path: ['alreadyWithBorrower'],
  });
export const SocialLoanDecisionSchema = z.strictObject({
  note: Optional(2000),
});
/** Either party proposes; the current `dueAt` stays authoritative until the other party accepts. */
export const SocialLoanDueProposalSchema = z.strictObject({
  dueAt: Instant,
  note: Optional(2000),
});
export const SocialLoanListQuerySchema = SocialPageQuerySchema.extend({
  role: z.enum(['ANY', 'LENDER', 'BORROWER']).default('ANY'),
  /** Group Owner/Admin moderation view of loans of currently Group-associated assets. */
  groupId: id.optional(),
  assetId: id.optional(),
  actionRequired: z.enum(['true', 'false']).optional(),
});
export const SocialLoanSchema = z.strictObject({
  id,
  assetId: id,
  assetTitle: z.string(),
  groupId: id.nullable(),
  lenderUserId: id.nullable(),
  borrowerUserId: id.nullable(),
  myRole: z.enum(['LENDER', 'BORROWER', 'MODERATOR']),
  origin: z.enum(['REQUEST', 'OFFER']),
  state: SocialLoanStateSchema,
  dueAt: Instant.nullable(),
  overdue: z.boolean(),
  /** True only after the borrower acknowledged receipt and the lender confirmed handover. */
  custodyConfirmed: z.boolean(),
  note: z.string().nullable(),
  lenderHandoverAt: Instant.nullable(),
  borrowerReceiptAt: Instant.nullable(),
  handedOverAt: Instant.nullable(),
  returnRequestedAt: Instant.nullable(),
  returnedAt: Instant.nullable(),
  closedAt: Instant.nullable(),
  pendingOutcome: z.enum(['LOST', 'DAMAGED']).nullable(),
  pendingOutcomeByUserId: id.nullable(),
  proposedDueAt: Instant.nullable(),
  dueProposedByUserId: id.nullable(),
  dueProposedAt: Instant.nullable(),
  stateBeforeDispute: SocialLoanStateSchema.nullable(),
  disputedByUserId: id.nullable(),
  disputeNote: z.string().nullable(),
  /** A party's account was erased; final treatment is POLICY-GATED (P6-06). */
  orphaned: z.boolean(),
  allowedActions: z.array(SocialLoanActionSchema),
  revision: z.number().int().positive(),
  createdAt: Instant,
  updatedAt: Instant,
});
export const SocialLoanPageSchema = page(SocialLoanSchema);

// Lost & Found -----------------------------------------------------------------
export const SocialLostFoundStateSchema = z.enum([
  'OPEN',
  'RESOLVED',
  'WITHDRAWN',
  'HIDDEN',
]);
export const SocialLostFoundCreateSchema = z
  .strictObject({
    id,
    kind: z.enum(['LOST', 'FOUND']),
    audience: z.enum(['CONNECTIONS', 'GROUP']),
    groupId: id.nullable().optional(),
    title: Text(200),
    description: Optional(2000),
    occurredOn: Day.nullable().optional(),
    /** LOST only: optionally reference one of the caller's own assets. */
    assetId: id.nullable().optional(),
  })
  .refine((v) => (v.audience === 'GROUP') === !!v.groupId, {
    path: ['groupId'],
  })
  .refine((v) => v.kind === 'LOST' || !v.assetId, { path: ['assetId'] });
export const SocialLostFoundActionSchema = z.enum([
  'withdraw',
  'hide',
  'unhide',
]);
export const SocialLostFoundListQuerySchema = SocialPageQuerySchema.extend({
  kind: z.enum(['LOST', 'FOUND']).optional(),
  view: z.enum(['MINE', 'CONNECTIONS', 'GROUP', 'CLAIMED']).default('MINE'),
  groupId: id.optional(),
  q: Search,
}).refine((v) => (v.view === 'GROUP') === !!v.groupId);
export const SocialLostFoundMatchQuerySchema = SocialPageQuerySchema.extend({
  q: Search,
});
export const SocialLostFoundSchema = z.strictObject({
  id,
  kind: z.enum(['LOST', 'FOUND']),
  audience: z.enum(['CONNECTIONS', 'GROUP']),
  groupId: id.nullable(),
  reporterUserId: id.nullable(),
  isReporter: z.boolean(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  occurredOn: Day.nullable(),
  /** Reporter only. */
  assetId: id.nullable(),
  state: SocialLostFoundStateSchema,
  /** Reporter only: more than one open claim, or a disputed claim. */
  contested: z.boolean().nullable(),
  openClaimCount: z.number().int().min(0).nullable(),
  myClaimId: id.nullable(),
  revision: z.number().int().positive(),
  createdAt: Instant,
  updatedAt: Instant,
  closedAt: Instant.nullable(),
});
export const SocialLostFoundPageSchema = page(SocialLostFoundSchema);
export const SocialLostFoundClaimCreateSchema = z.strictObject({
  id,
  note: Text(2000),
  /** The caller's own OPEN report of the opposite kind, linked as a possible match. */
  linkedReportId: id.nullable().optional(),
});
export const SocialLostFoundClaimActionSchema = z.enum([
  'acknowledge',
  'reject',
  'withdraw',
  'handover',
  'receive',
  'dispute',
  'resume',
]);
export const SocialLostFoundClaimSchema = z.strictObject({
  id,
  reportId: id,
  claimantUserId: id.nullable(),
  /** Who holds the item: the claimant for a LOST report, the reporter for a FOUND report. */
  holder: z.enum(['CLAIMANT', 'REPORTER']),
  note: z.string().nullable(),
  linkedReportId: id.nullable(),
  state: z.enum([
    'PENDING',
    'ACKNOWLEDGED',
    'DISPUTED',
    'RESOLVED',
    'REJECTED',
    'WITHDRAWN',
    'SUPERSEDED',
  ]),
  handoverAt: Instant.nullable(),
  receiptAt: Instant.nullable(),
  resolvedAt: Instant.nullable(),
  disputedByUserId: id.nullable(),
  disputeNote: z.string().nullable(),
  /** Always false: a resolved claim records an agreed handover, never legal ownership. */
  ownershipVerified: z.literal(false),
  allowedActions: z.array(SocialLostFoundClaimActionSchema),
  revision: z.number().int().positive(),
  createdAt: Instant,
  updatedAt: Instant,
});
export const SocialLostFoundClaimPageSchema = page(SocialLostFoundClaimSchema);

// Evidence and history ---------------------------------------------------------
export const SocialEvidenceKindSchema = z.enum([
  'CONDITION',
  'HANDOVER',
  'RETURN',
  'DAMAGE',
  'LOSS',
  'IDENTIFYING',
  'OTHER',
]);
export const SocialEvidenceCreateSchema = z.strictObject({
  id,
  kind: SocialEvidenceKindSchema,
  label: Text(200),
  note: Optional(2000),
  observedAt: Instant.nullable().optional(),
});
export const SocialEvidenceSchema = z.strictObject({
  id,
  loanId: id.nullable(),
  reportId: id.nullable(),
  claimId: id.nullable(),
  addedByUserId: id.nullable(),
  kind: SocialEvidenceKindSchema,
  label: z.string(),
  note: z.string().nullable(),
  observedAt: Instant.nullable(),
  /** File content is not available: no Social media pipeline is approved (ADR 0063). */
  content: z.null(),
  createdAt: Instant,
});
export const SocialEvidenceListSchema = z.strictObject({
  items: z.array(SocialEvidenceSchema).max(50),
});
export const SocialLendingEventSchema = z.strictObject({
  id,
  claimId: id.nullable(),
  actorUserId: id.nullable(),
  action: z.string(),
  fromState: z.string().nullable(),
  toState: z.string().nullable(),
  note: z.string().nullable(),
  occurredAt: Instant,
});
/** Chronological; the newest 1,000 events when `truncated`. */
export const SocialLendingHistorySchema = z.strictObject({
  items: z.array(SocialLendingEventSchema).max(1000),
  truncated: z.boolean(),
});
