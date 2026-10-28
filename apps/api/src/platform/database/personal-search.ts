import type { SearchRequest, PersonalSearchHit } from '@mehran/api-contracts';
export function searchAfter(
  request: SearchRequest,
  kind: PersonalSearchHit['kind'],
  logical = true,
) {
  const p = request.after;
  if (!p) return {};
  const key = logical ? 'logicalId' : 'id';
  return {
    OR: [
      { createdAt: { gt: new Date(p.createdAt) } },
      { createdAt: new Date(p.createdAt), [key]: { gt: p.id } },
      ...(kind > p.kind
        ? [{ createdAt: new Date(p.createdAt), [key]: p.id }]
        : []),
    ],
  };
}
export const literalSearch = (text: string) =>
  text.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
export const searchSnippet = (text: string) =>
  Array.from(text).slice(0, 120).join('');
