export class WorkPlanError extends Error {
  constructor(
    readonly code:
      | 'DUPLICATE_ID'
      | 'INVALID_TEMPLATE_LINK'
      | 'TEMPLATE_CYCLE'
      | 'INVALID_OPERATION'
      | 'PLAN_LIMIT',
  ) {
    super(code);
  }
}
type Template = {
  phases: readonly { key: string }[];
  sections: readonly { key: string; phaseKey: string | null }[];
  milestones: readonly { key: string; phaseKey: string | null }[];
  tasks: readonly {
    key: string;
    sectionKey: string | null;
    milestoneKey: string | null;
  }[];
  dependencies: readonly {
    predecessorKey: string;
    successorKey: string;
    kind: string;
  }[];
};
export function validateTemplate(d: Template) {
  const all = [...d.phases, ...d.sections, ...d.milestones, ...d.tasks].map(
    (x) => x.key.toLowerCase(),
  );
  if (new Set(all).size !== all.length) throw new WorkPlanError('DUPLICATE_ID');
  const phases = new Set(d.phases.map((x) => x.key)),
    sections = new Set(d.sections.map((x) => x.key)),
    milestones = new Set(d.milestones.map((x) => x.key)),
    tasks = new Set(d.tasks.map((x) => x.key));
  if (
    [...d.sections, ...d.milestones].some(
      (s) => s.phaseKey && !phases.has(s.phaseKey),
    ) ||
    d.tasks.some(
      (t) =>
        (t.sectionKey && !sections.has(t.sectionKey)) ||
        (t.milestoneKey && !milestones.has(t.milestoneKey)),
    ) ||
    d.dependencies.some(
      (e) =>
        e.predecessorKey === e.successorKey ||
        !tasks.has(e.predecessorKey) ||
        !tasks.has(e.successorKey),
    )
  )
    throw new WorkPlanError('INVALID_TEMPLATE_LINK');
  const seen = new Set<string>();
  for (const e of d.dependencies) {
    const key = e.predecessorKey + ':' + e.successorKey + ':' + e.kind;
    if (seen.has(key)) throw new WorkPlanError('DUPLICATE_ID');
    seen.add(key);
  }
  const incoming = new Map(d.tasks.map((t) => [t.key, 0]));
  for (const e of d.dependencies)
    incoming.set(e.successorKey, incoming.get(e.successorKey)! + 1);
  const ready = [...tasks].filter((t) => incoming.get(t) === 0);
  let count = 0;
  while (ready.length) {
    const id = ready.pop()!;
    count++;
    for (const e of d.dependencies.filter((e) => e.predecessorKey === id)) {
      incoming.set(e.successorKey, incoming.get(e.successorKey)! - 1);
      if (incoming.get(e.successorKey) === 0) ready.push(e.successorKey);
    }
  }
  if (count !== tasks.size) throw new WorkPlanError('TEMPLATE_CYCLE');
}
type Operation = {
  kind: string;
  task?: { id: string };
  taskId?: string;
  component?: { id: string };
  id?: string;
  predecessorId?: string;
  successorId?: string;
};
export function validateOperations(ops: readonly Operation[]) {
  if (!ops.length || ops.length > 200) throw new WorkPlanError('PLAN_LIMIT');
  const ids = ops
    .filter((o) => o.kind !== 'CREATE_DEPENDENCY')
    .map((o) => o.task?.id ?? o.taskId ?? o.component?.id);
  if (
    ids.some((id) => !id) ||
    new Set(ids.map((id) => id!.toLowerCase())).size !== ids.length
  )
    throw new WorkPlanError('DUPLICATE_ID');
  if (
    ops.filter((o) => o.kind === 'CREATE_TASK' || o.kind === 'UPDATE_TASK')
      .length > 100
  )
    throw new WorkPlanError('PLAN_LIMIT');
  const created = new Set(
    ops.filter((o) => o.kind === 'CREATE_TASK').map((o) => o.task!.id),
  );
  for (const op of ops)
    if (
      op.kind === 'CREATE_DEPENDENCY' &&
      (!op.id ||
        !created.has(op.predecessorId!) ||
        !created.has(op.successorId!))
    )
      throw new WorkPlanError('INVALID_OPERATION');
}
