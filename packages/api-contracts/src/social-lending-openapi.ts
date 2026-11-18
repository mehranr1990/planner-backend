import * as c from './social-lending.js';
import { SocialEmptySchema } from './social.js';
import { socialPathBuilder } from './social-activities-openapi.js';
const actions: Record<string, string[]> = {
  '/social-assets/{id}/actions/{action}': [
    ...c.SocialAssetActionSchema.options,
  ],
  '/social-loans/{id}/actions/{action}': [...c.SocialLoanActionSchema.options],
  '/social-lost-found/{id}/actions/{action}': [
    ...c.SocialLostFoundActionSchema.options,
  ],
  '/claims/{claimId}/actions/{action}': [
    ...c.SocialLostFoundClaimActionSchema.options,
  ],
};
const text = { type: 'string', minLength: 1, maxLength: 100 };
/** P6-04 Lending and Lost & Found operations. */
export function socialLendingPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  const add = socialPathBuilder(paths, 'socialLending', actions, {
    success:
      'Authorized P6-04 result; records never prove legal ownership, move money or expose file content',
    absent:
      'Safe absence; unauthorized assets, loans, reports, claims and evidence are indistinguishable',
  });
  const empty = SocialEmptySchema,
    write = { key: true, etag: true },
    edit = { key: true, revision: true, etag: true },
    uuid = { type: 'string', format: 'uuid' },
    asset = '/social-assets/{id}',
    loan = '/social-loans/{id}',
    report = '/social-lost-found/{id}',
    claim = report + '/claims/{claimId}';
  add('/social-assets', 'get', c.SocialAssetPageSchema, undefined, {
    page: true,
    query: {
      view: { type: 'string', enum: ['MINE', 'CONNECTIONS', 'GROUP'] },
      groupId: uuid,
      q: text,
    },
  });
  add(
    '/social-assets',
    'post',
    c.SocialAssetSchema,
    c.SocialAssetCreateSchema,
    write,
  );
  add(asset, 'get', c.SocialAssetSchema, undefined, { etag: true });
  add(asset, 'patch', c.SocialAssetSchema, c.SocialAssetPatchSchema, edit);
  add(asset + '/actions/{action}', 'post', c.SocialAssetSchema, empty, edit);
  add('/social-loans', 'get', c.SocialLoanPageSchema, undefined, {
    page: true,
    query: {
      role: { type: 'string', enum: ['ANY', 'LENDER', 'BORROWER'] },
      groupId: uuid,
      assetId: uuid,
      actionRequired: { type: 'string', enum: ['true', 'false'] },
    },
  });
  add(
    '/social-loans',
    'post',
    c.SocialLoanSchema,
    c.SocialLoanCreateSchema,
    write,
  );
  add(loan, 'get', c.SocialLoanSchema, undefined, { etag: true });
  add(
    loan + '/actions/{action}',
    'post',
    c.SocialLoanSchema,
    c.SocialLoanDecisionSchema,
    edit,
  );
  add(
    loan + '/due-date',
    'post',
    c.SocialLoanSchema,
    c.SocialLoanDueProposalSchema,
    edit,
  );
  add(loan + '/history', 'get', c.SocialLendingHistorySchema);
  add(loan + '/evidence', 'get', c.SocialEvidenceListSchema);
  add(
    loan + '/evidence',
    'post',
    c.SocialEvidenceSchema,
    c.SocialEvidenceCreateSchema,
    { key: true },
  );
  add('/social-lost-found', 'get', c.SocialLostFoundPageSchema, undefined, {
    page: true,
    query: {
      kind: { type: 'string', enum: ['LOST', 'FOUND'] },
      view: {
        type: 'string',
        enum: ['MINE', 'CONNECTIONS', 'GROUP', 'CLAIMED'],
      },
      groupId: uuid,
      q: text,
    },
  });
  add(
    '/social-lost-found',
    'post',
    c.SocialLostFoundSchema,
    c.SocialLostFoundCreateSchema,
    write,
  );
  add(report, 'get', c.SocialLostFoundSchema, undefined, { etag: true });
  add(
    report + '/actions/{action}',
    'post',
    c.SocialLostFoundSchema,
    empty,
    edit,
  );
  add(report + '/matches', 'get', c.SocialLostFoundPageSchema, undefined, {
    page: true,
    query: { q: text },
  });
  add(report + '/history', 'get', c.SocialLendingHistorySchema);
  add(report + '/evidence', 'get', c.SocialEvidenceListSchema);
  add(
    report + '/evidence',
    'post',
    c.SocialEvidenceSchema,
    c.SocialEvidenceCreateSchema,
    { key: true },
  );
  add(report + '/claims', 'get', c.SocialLostFoundClaimPageSchema, undefined, {
    page: true,
  });
  add(
    report + '/claims',
    'post',
    c.SocialLostFoundClaimSchema,
    c.SocialLostFoundClaimCreateSchema,
    write,
  );
  add(claim, 'get', c.SocialLostFoundClaimSchema, undefined, { etag: true });
  add(
    claim + '/actions/{action}',
    'post',
    c.SocialLostFoundClaimSchema,
    c.SocialLoanDecisionSchema,
    edit,
  );
  add(claim + '/evidence', 'get', c.SocialEvidenceListSchema);
  add(
    claim + '/evidence',
    'post',
    c.SocialEvidenceSchema,
    c.SocialEvidenceCreateSchema,
    { key: true },
  );
  return paths;
}
