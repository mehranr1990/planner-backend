import { z } from 'zod';
export const TeamCustodyPreviewSchema = z.strictObject({
  companyId: z.uuid(),
  parentScopeId: z.uuid(),
});
export const TeamCustodyApplySchema = z.strictObject({
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.number().int().positive(),
  password: z.string().min(1).max(1024),
});
export const TeamCustodyConsentSchema = TeamCustodyApplySchema.extend({
  purpose: z.enum(['SOURCE_OWNER', 'COMPANY_OWNER', 'PARTICIPANT']),
});
export const TeamCustodyTransferSchema = z.strictObject({
  id: z.uuid(),
  teamId: z.uuid(),
  companyId: z.uuid(),
  parentScopeId: z.uuid(),
  state: z.enum(['PREVIEWED', 'APPLYING', 'APPLIED', 'REVOKED']),
  revision: z.number().int().positive(),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime(),
  appliedAt: z.iso.datetime().nullable(),
});
export const teamCustodyPaths: Record<string, Record<string, unknown>> = {};
for (const [suffix, schema] of [
  ['preview', TeamCustodyPreviewSchema],
  ['{transferId}/consent', TeamCustodyConsentSchema],
  ['{transferId}/apply', TeamCustodyApplySchema],
] as const) {
  const path = '/api/v1/teams/{id}/company-custody/' + suffix;
  teamCustodyPaths[path] = {
    post: {
      operationId: 'teamCompanyCustody' + suffix.replace(/[^a-zA-Z]/g, '_'),
      tags: ['teams'],
      security: [{ sessionCookie: [] }],
      description:
        'One-way Independent Team → Company-owned Team. A 30-minute immutable preview, explicit fresh password consents from both owners and the source participant, current Company root/parent admissions and unchanged eligible dependency graph are mandatory. Currently only an ordinary-created Team with one original owner and no additional resource/dependency graph is eligible; unsupported records are preserved and rejected. No detach, Company-to-Company or Project transfer.',
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        ...(suffix === 'preview'
          ? [
              {
                name: 'Idempotency-Key',
                in: 'header',
                required: true,
                schema: { type: 'string', minLength: 1, maxLength: 128 },
              },
            ]
          : [
              {
                name: 'transferId',
                in: 'path',
                required: true,
                schema: { type: 'string', format: 'uuid' },
              },
            ]),
      ],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: z.toJSONSchema(schema) } },
      },
      responses: {
        '200': {
          description:
            'Persisted preview, explicit consent or atomic applied receipt',
          content: {
            'application/json': {
              schema: z.toJSONSchema(TeamCustodyTransferSchema),
            },
          },
        },
        '400': { description: 'Invalid input or missing idempotency key' },
        '401': { description: 'Verified current ordinary session required' },
        '403': {
          description: 'Ownership, consent or provider reauthentication denied',
        },
        '404': { description: 'Unavailable identity or context' },
        '409': {
          description:
            'TEAM_CUSTODY_REQUIRES_INDEPENDENT_TEAM, TEAM_CUSTODY_DEPENDENCIES_UNSUPPORTED, TEAM_CUSTODY_PARTICIPANT_GRAPH_UNSUPPORTED, TEAM_CUSTODY_PARENT_ADMISSION_REQUIRED, TEAM_CUSTODY_PREVIEW_CHANGED, TEAM_CUSTODY_CONSENT_REQUIRED, TEAM_CUSTODY_TRANSFER_PENDING or IDEMPOTENCY_CONFLICT',
        },
        '429': { description: 'Existing shared abuse limit' },
      },
    },
  };
}
