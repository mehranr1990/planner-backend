-- Existing sessions deliberately remain unverified and must complete a new MFA sign-in.
ALTER TABLE "AdminSession" ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3);
