export const SPACES_REPOSITORY = Symbol('SPACES_REPOSITORY');
export type OwnedSpace = {
  id: string;
  kind: string;
  ownerUserId: string;
  createdAt: Date;
  updatedAt: Date;
  accessClosedAt?: Date | null;
};
export interface SpacesPort {
  personalFor(userId: string): Promise<OwnedSpace>;
  findOwned(userId: string, spaceId: string): Promise<OwnedSpace | null>;
}
