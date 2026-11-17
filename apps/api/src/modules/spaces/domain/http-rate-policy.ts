export type SharedTraffic = { method: string; route: string };

// Only matched route templates enter keys: never query strings, IDs or proofs.
export function sharedRatePolicy(traffic?: SharedTraffic, preview = false) {
  const route = (traffic?.route ?? '').replace(/^\/api\/v1\//, '/');
  const root = route.split('/')[1] ?? 'spaces';
  const family = /^(projects|project-invitations|resource-invitations)$/.test(
    root,
  )
    ? 'projects'
    : /^(teams|team-invitations)$/.test(root)
      ? 'teams'
      : /^(companies|company-invitations)$/.test(root)
        ? 'companies'
        : /^(conversations|conversation-invitations|messages|messaging|messaging-notifications)$/.test(
              root,
            )
          ? 'messages'
          : /^(meetings|announcements)$/.test(root)
            ? 'meetings'
            : /^(social|social-groups|social-group-invitations)$/.test(root)
              ? 'social'
              : 'spaces';
  const read = ['GET', 'HEAD'].includes(traffic?.method ?? 'POST');
  const sensitive =
    preview ||
    !traffic ||
    /\/(?:proof|discovery|lifecycle|lifecycle-job)(?:\/|$)/.test(route) ||
    (!read &&
      (/\/(?:invitations|[^/]*invitations|ownership-handovers|memberships|members|participants|organizer|grants|resource-grants|access|roles|capabilities|permissions|policy|settings|retention|lifecycle|lifecycle-job|restore-replay|restore-admission|discovery|blocks|contact-block|connections)(?:\/|$)/.test(
        route,
      ) ||
        /\/(?:archive|restore|recover|recovery|close|reopen|erase|purge|transfer|handover|proof|join|leave|admit|admission|approve|approval|reject|decision|reviewer|approvals|approval-workflows|approval-workflow-versions|reimbursements|payment-acknowledgements|acknowledgement-corrections|reimburse|pay)(?:\/|$)/.test(
          route,
        )));
  const expensive =
    /\/(?:[^/]*-)?(?:search|reports|analytics|insights|portfolio|summary|summaries|dashboard|export|exports|download|downloads|bulk|workload|capacity|capacity-days)(?:\/|$)/.test(
      route,
    );
  const kind = sensitive ? 'sensitive' : read ? 'read' : 'write';
  return {
    family,
    kind,
    actor: kind === 'read' ? 600 : kind === 'write' ? 120 : 20,
    ip: kind === 'read' ? 6000 : kind === 'write' ? 1200 : preview ? 30 : 60,
    endpoint: expensive ? `${traffic?.method}:${route}` : undefined,
  };
}
