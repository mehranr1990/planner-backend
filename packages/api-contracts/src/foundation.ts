import { z } from 'zod';

// Reusable future list contracts; no new HTTP list endpoint in P0-03.
export const CursorQuerySchema = z.strictObject({
  limit: z
    .string()
    .regex(/^(?:[1-9]|[1-9][0-9]|100)$/)
    .optional(),
  cursor: z
    .string()
    .min(1)
    .max(1024)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});
export const IfMatchSchema = z.string().regex(/^"[1-9][0-9]{0,9}"$/);
