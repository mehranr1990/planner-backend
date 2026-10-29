export const IDENTITY_ADMISSION = Symbol('IDENTITY_ADMISSION');
/** Implemented by the account/Space owner at the composition root. */
export type IdentityAdmission = (userId: string) => Promise<void>;
