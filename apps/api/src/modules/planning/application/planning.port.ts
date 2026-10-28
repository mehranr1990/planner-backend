import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type {
  Availability,
  ReviewCreate,
  ReviewQuery,
} from '@mehran/api-contracts';
import type {
  Day,
  Week,
  Review,
  Item,
  ItemWrite,
  PlanningTask,
  Preferences,
} from '../domain/planning.js';
export const PLANNING_REPOSITORY = Symbol('PLANNING_REPOSITORY');
export type PlanningAudit =
  | 'PLANNING_DAY_CREATE'
  | 'PLANNING_SELECTION_UPDATE'
  | 'PLANNING_SELECTION_REMOVE'
  | 'PLANNING_SELECTION_MOVE'
  | 'PLANNING_DAY_REORDER'
  | 'PLANNING_WEEK_CREATE'
  | 'PLANNING_REVIEW_CREATE'
  | 'PLANNING_REVIEW_UPDATE'
  | 'PLANNING_REVIEW_DELETE'
  | 'PLANNING_ROLLOVER';
export interface PlanningTransaction {
  preferences(): Promise<Preferences>;
  setAvailability(
    revision: number,
    availability: Availability | null,
  ): Promise<Preferences>;
  tasks(ids: string[]): Promise<PlanningTask[]>;
  day(localDate: string): Promise<Day | null>;
  createDay(localDate: string, timezone: string): Promise<Day>;
  items(planId: string): Promise<Item[]>;
  writeDay(day: Day, items: ItemWrite[], increment?: boolean): Promise<Day>;
  touchWeeks(dates: string[]): Promise<void>;
  week(weekStartDate: string): Promise<Week | null>;
  createWeek(weekStartDate: string, prefs: Preferences): Promise<Week>;
  review(id: string): Promise<Review>;
  reviews(
    query: ReviewQuery,
  ): Promise<{ items: Review[]; nextCursor: string | null }>;
  createReview(
    input: ReviewCreate,
    context: { timezone: string; firstDayOfWeek: number },
  ): Promise<Review>;
  updateReview(before: Review, reflection: string): Promise<Review>;
  deleteReview(before: Review): Promise<void>;
  audit(action: PlanningAudit, id: string): Promise<void>;
}
export interface PlanningPort {
  run<T>(
    scope: AuthorizedSpace,
    work: (tx: PlanningTransaction) => Promise<T>,
  ): Promise<T>;
  once(
    scope: AuthorizedSpace,
    key: string,
    request: unknown,
    work: (tx: PlanningTransaction) => Promise<Record<string, unknown>>,
  ): Promise<unknown>;
}
