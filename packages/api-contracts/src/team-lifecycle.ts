import { z } from 'zod';
import { ProjectLifecycleSchema } from './projects.js';
import {
  ProjectLifecycleJobSchema,
  ProjectLifecycleProofSchema,
  ProjectLifecycleRecoverySchema,
  ProjectLifecyclePasswordSchema,
  ProjectLifecycleRecoverSchema,
} from './project-lifecycle.js';
export const TeamLifecycleChangeSchema = z.strictObject({
  id: z.uuid(),
  teamId: z.uuid(),
  revision: z.number().int().positive().max(2147483646),
});
export const TeamLifecycleStatusSchema = ProjectLifecycleSchema;
export const TeamLifecycleJobSchema = ProjectLifecycleJobSchema;
export const TeamLifecycleProofSchema = ProjectLifecycleProofSchema;
export const TeamLifecycleRecoverySchema = ProjectLifecycleRecoverySchema;
export const TeamLifecyclePasswordSchema = ProjectLifecyclePasswordSchema;
export const TeamLifecycleRecoverSchema = ProjectLifecycleRecoverSchema;
