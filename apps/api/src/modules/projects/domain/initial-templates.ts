/** Versioned setup definitions; no work, dates, assignees, automations or sprints are fabricated. */
export const initialProjectTemplates = [
  { id: 'BLANK', version: 1, name: 'Blank', sections: [], workflow: null },
  {
    id: 'KANBAN',
    version: 1,
    name: 'Kanban',
    sections: [],
    workflow: 'BASE_TASK_STATUSES',
  },
  {
    id: 'SCRUM',
    version: 1,
    name: 'Scrum',
    sections: ['Backlog', 'Ready'],
    workflow: 'BASE_TASK_STATUSES',
  },
] as const;
