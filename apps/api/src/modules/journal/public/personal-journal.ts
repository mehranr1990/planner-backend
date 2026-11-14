import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type {
  JournalCreate,
  SearchRequest,
  PersonalSearchHit,
} from '@mehran/api-contracts';
export abstract class PersonalJournal {
  abstract lock(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
  ): Promise<void>;
  abstract create(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    input: JournalCreate,
  ): Promise<{ id: string; revision: number }>;
  abstract search(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    r: SearchRequest,
    kind: 'JOURNAL' | 'MOOD',
  ): Promise<PersonalSearchHit[]>;
  /** B4: current recorded mood entries by local date (mood and energy are 1–5). */
  abstract moods(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    fromDate: string,
    toDate: string,
  ): Promise<{ localDate: string; mood: number; energy: number | null }[]>;
}
