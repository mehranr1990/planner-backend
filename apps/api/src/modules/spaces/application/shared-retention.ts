import { z } from 'zod';
const name = z.string().trim().min(1).max(200);
const rule = z.strictObject({
  retainAfterClosureSeconds: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER),
  audience: z.array(
    z.enum(['OWNER', 'ADMIN', 'MANAGER', 'LEAD', 'MEMBER', 'VIEWER']),
  ),
  exportAuthority: z.array(
    z.enum(['OWNER', 'ADMIN', 'MANAGER', 'LEAD', 'MEMBER', 'VIEWER']),
  ),
  disposalAction: z.enum(['PURGE', 'PSEUDONYMIZE']),
});
const obligation = z
  .strictObject({
    id: z.uuid(),
    basis: name,
    responsibleOperator: name,
    state: z.enum(['OUTSTANDING', 'RELEASED']),
    nextReviewAt: z.iso.datetime(),
    releaseEvidence: name.nullable(),
  })
  .refine((v) => v.state !== 'RELEASED' || v.releaseEvidence !== null);
const hold = z
  .strictObject({
    id: z.uuid(),
    basis: name,
    authority: name,
    scope: name,
    nextReviewAt: z.iso.datetime(),
    state: z.enum(['ACTIVE', 'RELEASED']),
    releaseEvidence: name.nullable(),
  })
  .refine((v) => v.state !== 'RELEASED' || v.releaseEvidence !== null);
export const SharedRetentionSchema = z
  .strictObject({
    policyVersion: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
    approvalReference: name,
    accountableOperator: name,
    applicableContexts: z
      .array(
        z.enum([
          'PROJECT',
          'TEAM',
          'COMPANY',
          'CONVERSATION',
          'MEETING',
          'SOCIAL_GROUP',
        ]),
      )
      .min(1)
      .max(6)
      .refine((v) => new Set(v).size === v.length),
    marketScope: name,
    sharedRecoverySeconds: z.literal(2592000),
    classRules: z.strictObject({
      workContent: rule,
      commentsHistory: rule,
      filesDerivatives: rule,
      exports: rule,
      accessAuditLifecycle: rule,
    }),
    obligations: z.array(obligation).max(1000),
    holds: z.array(hold).max(1000),
    backupPolicyReference: name,
  })
  .superRefine((policy, ctx) => {
    const ids = new Set<string>();
    for (const kind of ['holds', 'obligations'] as const) {
      policy[kind].forEach((item, index) => {
        if (ids.has(item.id.toLowerCase()))
          ctx.addIssue({
            code: 'custom',
            path: [kind, index, 'id'],
            message:
              'Retention item IDs must be unique across holds and obligations',
          });
        ids.add(item.id.toLowerCase());
      });
    }
  });
