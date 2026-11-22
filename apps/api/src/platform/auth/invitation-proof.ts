import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
export const invitationProof = () => randomBytes(32).toString('base64url');
export const invitationProofHash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export function invitationProofMatches(
  hash: string | null,
  proof: string | undefined,
) {
  return (
    !!hash &&
    !!proof &&
    /^[A-Za-z0-9_-]{43}$/.test(proof) &&
    timingSafeEqual(
      Buffer.from(hash, 'hex'),
      Buffer.from(invitationProofHash(proof), 'hex'),
    )
  );
}
