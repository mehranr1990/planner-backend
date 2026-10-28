import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { PlanningTaskSnapshot } from '../../tasks/public/index.js';
import type { GoalHabitSnapshot } from '../../habits/public/index.js';
export type Area = z.infer<typeof c.LifeAreaSchema>;
export type Kind = 'milestones' | 'metrics' | 'tasks' | 'habits';
export type Collections = {
  milestones: Array<z.infer<typeof c.GoalMilestoneSchema>>;
  metrics: Array<z.infer<typeof c.GoalMetricSchema>>;
  tasks: Array<z.infer<typeof c.GoalTaskLinkSchema>>;
  habits: Array<z.infer<typeof c.GoalHabitLinkSchema>>;
};
export type Review = z.infer<typeof c.GoalReviewSchema>;
export type PageQuery = {
  limit?: string | undefined;
  cursor?: string | undefined;
};
export type GoalQuery = z.infer<typeof c.GoalListQuerySchema>;
export type ReviewQuery = z.infer<typeof c.GoalReviewQuerySchema>;
export const GOALS_REPOSITORY = Symbol('GOALS_REPOSITORY');
export interface GoalsTransaction {
  timezone(): Promise<string>;
  area(id: string): Promise<Area>;
  areas(q: PageQuery): Promise<{ items: Area[]; nextCursor: string | null }>;
  createArea(input: c.LifeAreaCreate): Promise<Area>;
  updateArea(before: Area, input: c.LifeAreaPatch): Promise<Area>;
  goal(id: string): Promise<c.Goal>;
  goals(q: GoalQuery): Promise<{ items: c.Goal[]; nextCursor: string | null }>;
  hierarchy(): Promise<Array<{ id: string; parentGoalId: string | null }>>;
  createGoal(input: c.GoalCreate, timezone: string): Promise<c.Goal>;
  updateGoal(before: c.Goal, input: c.GoalPatch): Promise<c.Goal>;
  children(id: string): Promise<Collections>;
  writeChild(
    goalId: string,
    kind: Kind,
    data: object,
    childId?: string,
  ): Promise<void>;
  removeChild(goalId: string, kind: Kind, childId: string): Promise<void>;
  task(id: string): Promise<PlanningTaskSnapshot>;
  habit(
    id: string,
    range: { from: string; to: string },
    now: Date,
  ): Promise<GoalHabitSnapshot>;
  review(
    goalId: string,
    kind: 'SNAPSHOT' | 'REVIEW',
    reflection: string | null,
    snapshot: c.GoalProgress,
  ): Promise<Review>;
  reviews(
    goalId: string,
    q: ReviewQuery,
  ): Promise<{ items: Review[]; nextCursor: string | null }>;
  audit(
    action:
      | 'LIFE_AREA_CREATE'
      | 'LIFE_AREA_UPDATE'
      | 'GOAL_CREATE'
      | 'GOAL_UPDATE'
      | 'GOAL_LINK_CHANGE'
      | 'GOAL_REVIEW_CREATE',
    id: string,
  ): Promise<void>;
  event(goalId: string): Promise<void>;
}
export interface GoalsPort {
  run<T>(
    scope: AuthorizedSpace,
    work: (tx: GoalsTransaction) => Promise<T>,
  ): Promise<T>;
  once<T extends { id: string }>(
    scope: AuthorizedSpace,
    operation: string,
    key: string,
    request: unknown,
    work: (tx: GoalsTransaction) => Promise<T>,
  ): Promise<T>;
}
