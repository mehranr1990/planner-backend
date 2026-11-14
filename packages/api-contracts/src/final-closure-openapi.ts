import * as c from './index.js';
import { teamCompletionPaths } from './team-completion-openapi.js';
import type { Operation } from './team-completion-openapi.js';
const co = '/companies/{id}';
const ctx = co + '/contexts/{scopeId}';
/** Final Phase 1–5 closure (2026-11-14): OD-5 unit moves, room booking titles and B4 Task categories. */
export const finalClosureOperations: Operation[] = [
  {
    path: co + '/context-moves/preview',
    method: 'get',
    output: c.ContextMovePreviewSchema,
    query: c.ContextMoveQuerySchema,
  },
  {
    path: co + '/context-moves',
    method: 'post',
    output: c.ContextMoveSchema,
    input: c.ContextMoveCreateSchema,
    revision: true,
  },
  {
    path: ctx + '/allocations/{allocationId}/title',
    method: 'put',
    output: c.RoomBookingTitleSchema,
    input: c.RoomBookingTitlePutSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/tasks/{id}/category',
    method: 'get',
    output: c.TaskCategoryViewSchema,
    etag: true,
  },
  {
    path: '/tasks/{id}/category',
    method: 'put',
    output: c.TaskCategoryViewSchema,
    input: c.TaskCategoryPutSchema,
    revision: true,
    etag: true,
  },
];
export function finalClosurePaths() {
  return teamCompletionPaths(finalClosureOperations, {
    prefix: 'finalClosure',
    tag: 'final-closure',
    description: 'Current authorized result',
  });
}
