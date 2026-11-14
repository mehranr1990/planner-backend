import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type {
  ProductivityTask,
  ProductivityTaskPatch,
  TaskCategoryView,
} from '@mehran/api-contracts';
export const TASK_PRODUCTIVITY = Symbol('TASK_PRODUCTIVITY');
export interface TaskProductivityTransaction {
  read(id: string): Promise<ProductivityTask & { unavailable: boolean }>;
  update(
    id: string,
    revision: number,
    input: ProductivityTaskPatch,
  ): Promise<ProductivityTask>;
  /** B4: the explicit Personal Task category. */
  category(id: string): Promise<TaskCategoryView & { unavailable: boolean }>;
  setCategory(
    id: string,
    revision: number,
    category: TaskCategoryView['category'],
  ): Promise<TaskCategoryView>;
}
export interface TaskProductivityPort {
  run<T>(
    scope: AuthorizedSpace,
    work: (tx: TaskProductivityTransaction) => Promise<T>,
  ): Promise<T>;
}
