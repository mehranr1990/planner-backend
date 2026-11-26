import { createHash } from 'node:crypto';
export type RuleTarget = {
  kind: string;
  scopeType?: string | null;
  workspaceId?: string | null;
  userId?: string | null;
  groupId?: string | null;
};
export type EvaluationSubject = {
  userId?: string | undefined;
  workspaceId?: string | undefined;
  scopeType?: string | undefined;
  groups: readonly string[];
};
export type EvaluationRule = {
  position: number;
  target: RuleTarget;
  value: unknown;
  priority: number;
  basisPoints: number;
  steps: readonly { at: string; basisPoints: number }[];
};
const precedence: Readonly<Record<string, number>> = {
  GLOBAL: 0,
  SCOPE_TYPE: 1,
  GROUP: 2,
  WORKSPACE: 3,
  USER: 4,
};
export function rolloutBucket(definitionId: string, subject: string) {
  return (
    createHash('sha256')
      .update(definitionId + '\0' + subject)
      .digest()
      .readUInt32BE(0) % 10000
  );
}
export function evaluateRules(
  definitionId: string,
  defaultValue: unknown,
  rules: readonly EvaluationRule[],
  subject: EvaluationSubject,
  now = new Date(),
) {
  const id = subject.userId ?? subject.workspaceId,
    bucket = id ? rolloutBucket(definitionId, id) : null;
  const candidates = rules
    .filter((r) => {
      const t = r.target;
      const matches =
        t.kind === 'GLOBAL' ||
        (t.kind === 'SCOPE_TYPE' &&
          !!subject.scopeType &&
          t.scopeType === subject.scopeType) ||
        (t.kind === 'USER' &&
          !!subject.userId &&
          t.userId === subject.userId) ||
        (t.kind === 'WORKSPACE' &&
          !!subject.workspaceId &&
          t.workspaceId === subject.workspaceId) ||
        (t.kind === 'GROUP' &&
          !!t.groupId &&
          subject.groups.includes(t.groupId));
      const subjectId = ['WORKSPACE', 'SCOPE_TYPE'].includes(t.kind)
        ? (subject.workspaceId ?? subject.userId)
        : id;
      const ruleBucket = subjectId
        ? rolloutBucket(definitionId, subjectId)
        : null;
      let bps = r.basisPoints;
      for (const step of r.steps)
        if (Date.parse(step.at) <= +now) bps = step.basisPoints;
      return (
        matches && (bps === 10000 || (ruleBucket !== null && ruleBucket < bps))
      );
    })
    .sort(
      (a, b) =>
        (precedence[b.target.kind] ?? -1) - (precedence[a.target.kind] ?? -1) ||
        b.priority - a.priority ||
        a.position - b.position,
    );
  const winner = candidates[0];
  const winnerId =
    winner && ['WORKSPACE', 'SCOPE_TYPE'].includes(winner.target.kind)
      ? (subject.workspaceId ?? subject.userId)
      : id;
  return {
    value: winner?.value ?? defaultValue,
    source: winner?.target.kind ?? 'DEFAULT',
    rulePosition: winner?.position ?? null,
    bucket: winnerId ? rolloutBucket(definitionId, winnerId) : bucket,
  };
}
export function configurationDiff(before: unknown, after: unknown) {
  const old =
    before && typeof before === 'object'
      ? (before as Record<string, unknown>)
      : { value: before ?? null };
  const next =
    after && typeof after === 'object'
      ? (after as Record<string, unknown>)
      : { value: after ?? null };
  return [...new Set([...Object.keys(old), ...Object.keys(next)])]
    .sort()
    .filter((k) => JSON.stringify(old[k]) !== JSON.stringify(next[k]))
    .map((path) => ({
      path,
      before: old[path] ?? null,
      after: next[path] ?? null,
    }));
}
