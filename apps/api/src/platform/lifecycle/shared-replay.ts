import { z } from 'zod';
const uuid = z.uuid();
const instant = z.iso.datetime();
export const SharedReplaySchema = z.strictObject({
  kind: z.literal('REPLAY'),
  id: uuid,
  spaceId: uuid,
  version: z.string().regex(/^[1-9][0-9]*$/),
  action: z.string().max(80),
  resourceId: uuid.nullable(),
  custody: z.strictObject({
    state: z.string().max(24),
    primaryOwnerAccessId: uuid.nullable(),
    closureGeneration: z.number().int().nonnegative(),
    retentionPolicyVersion: z.string().max(80),
  }),
  policy: z
    .strictObject({
      version: z.number().int().positive(),
      roleDefaults: z.record(z.string(), z.array(z.string())),
      exportMaxRecords: z.number().int().positive().max(10000),
      exportMaxBytes: z.number().int().positive().max(10485760),
      publishedByActorId: uuid,
      auditId: uuid,
    })
    .nullable(),
  accesses: z
    .array(
      z.strictObject({
        id: uuid,
        actorId: uuid,
        state: z.string().max(24),
        memberRole: z.enum(['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER']).nullable(),
        generation: z.number().int().positive(),
        joinedAt: instant,
        endedAt: instant.nullable(),
        erased: z.boolean(),
      }),
    )
    .max(10),
  job: z
    .strictObject({
      id: uuid,
      generation: z.number().int().positive(),
      state: z.string().max(24),
      effectiveDepartureAt: instant,
      recoveryDeadline: instant,
      retentionPolicyVersion: z.string().max(80),
      nextAt: instant,
      revision: z.number().int().positive(),
      progress: z.record(z.string(), z.json()),
    })
    .nullable(),
});
export type SharedReplay = z.infer<typeof SharedReplaySchema>;
export type SharedRestoreScope = {
  spaceId: string;
  verify: (tx: unknown) => void;
};
