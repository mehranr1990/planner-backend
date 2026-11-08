import { z } from 'zod';
import { ProjectLifecycleSchema } from './projects.js';
import {
  ProjectLifecycleJobSchema,
  ProjectLifecycleProofSchema,
  ProjectLifecycleRecoverySchema,
  ProjectLifecyclePasswordSchema,
  ProjectLifecycleRecoverSchema,
} from './project-lifecycle.js';
export const CompanyLifecycleChangeSchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  revision: z.number().int().positive().max(2147483646),
});
export const CompanyLifecycleStatusSchema = ProjectLifecycleSchema;
export const CompanyLifecycleJobSchema = ProjectLifecycleJobSchema;
export const CompanyLifecycleProofSchema = ProjectLifecycleProofSchema;
export const CompanyLifecycleRecoverySchema = ProjectLifecycleRecoverySchema;
export const CompanyLifecyclePasswordSchema = ProjectLifecyclePasswordSchema;
export const CompanyLifecycleRecoverSchema = ProjectLifecycleRecoverSchema;
