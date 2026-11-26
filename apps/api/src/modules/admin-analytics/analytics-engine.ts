import type { AnalyticsFilter } from '@mehran/api-contracts';
export type AnalyticsEvent = {
  userId: string;
  name: string;
  feature: string;
  meaningful: boolean;
  occurredAt: Date;
};
export const uniqueUsers = (rows: AnalyticsEvent[]) =>
  new Set(rows.map((r) => r.userId)).size;
export function measure(
  key: string,
  value: number,
  users: number,
  minimum: number,
  denominator: number | null = null,
) {
  const suppressed =
    users < minimum || (denominator !== null && denominator < minimum);
  return {
    key,
    value: suppressed ? null : value,
    denominator: suppressed ? null : denominator,
    suppressed,
  };
}
const userTimes = (rows: AnalyticsEvent[]) => {
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const times = map.get(r.userId) ?? [];
    times.push(+r.occurredAt);
    map.set(r.userId, times);
  }
  for (const times of map.values()) times.sort((a, b) => a - b);
  return map;
};
export function analyticsMetrics(
  rows: AnalyticsEvent[],
  filter: AnalyticsFilter,
  minimum: number,
  registrationAnchors?: Map<string, Date>,
) {
  const from = Date.parse(filter.from),
    to = Date.parse(filter.to),
    day = 86400000;
  const period = rows.filter(
      (r) => +r.occurredAt >= from && +r.occurredAt < to,
    ),
    meaningful = period.filter((r) => r.meaningful),
    n = uniqueUsers(meaningful);
  const rolling = (days: number) =>
    uniqueUsers(
      rows.filter(
        (r) =>
          r.meaningful &&
          +r.occurredAt >= to - days * day &&
          +r.occurredAt < to,
      ),
    );
  const activeDays = new Set(
    meaningful.map(
      (r) => r.userId + ':' + r.occurredAt.toISOString().slice(0, 10),
    ),
  ).size;
  const meaningfulTimes = userTimes(rows.filter((r) => r.meaningful));
  const retention = (days: number) => {
    const anchors =
      registrationAnchors ??
      new Map(
        [...meaningfulTimes].flatMap(([id, times]) => {
          const first = times.find((at) => at >= from && at < to);
          return first === undefined ? [] : [[id, new Date(first)] as const];
        }),
      );
    const lower = registrationAnchors
      ? Date.parse(filter.registeredFrom ?? filter.from)
      : from;
    const upper = registrationAnchors
      ? Date.parse(filter.registeredTo ?? filter.to)
      : to;
    const eligible = [...anchors].filter(
      ([, at]) => +at >= lower && +at < upper && +at + (days + 1) * day <= to,
    );
    const returned = eligible.filter(([id, at]) =>
      (meaningfulTimes.get(id) ?? []).some(
        (t) => t >= +at + days * day && t < +at + (days + 1) * day,
      ),
    ).length;
    return measure(
      (registrationAnchors ? 'registration_return_day_' : 'return_day_') + days,
      eligible.length ? returned / eligible.length : 0,
      returned,
      minimum,
      eligible.length,
    );
  };
  return [
    measure('dau', rolling(1), rolling(1), minimum),
    measure('wau', rolling(7), rolling(7), minimum),
    measure('mau', rolling(30), rolling(30), minimum),
    measure('active_users', n, n, minimum),
    measure('meaningful_events', meaningful.length, n, minimum),
    measure(
      'events_per_active_user',
      n ? meaningful.length / n : 0,
      n,
      minimum,
      n,
    ),
    measure('active_days_per_user', n ? activeDays / n : 0, n, minimum, n),
    measure(
      'stickiness_dau_mau',
      rolling(30) ? rolling(1) / rolling(30) : 0,
      rolling(1),
      minimum,
      rolling(30),
    ),
    ...[1, 7, 30].map(retention),
  ];
}
export function definitionMetrics(
  rows: AnalyticsEvent[],
  d: { events: string[]; kind: string; formula: string; windowDays: number },
  minimum: number,
  observationEnd?: Date,
) {
  const steps = d.events.map((name) => rows.filter((r) => r.name === name)),
    base = uniqueUsers(steps[0] ?? []);
  if (d.kind === 'FUNNEL') {
    const firstTimes = userTimes(steps[0] ?? []),
      first = new Map([...firstTimes].map(([id, times]) => [id, times[0]!]));
    let previous = new Map(first);
    return steps.map((events, index) => {
      if (index) {
        const next = new Map<string, number>(),
          times = userTimes(events);
        for (const [id, at] of previous) {
          const match = (times.get(id) ?? []).find(
            (t) => t > at && t <= first.get(id)! + d.windowDays * 86400000,
          );
          if (match !== undefined) next.set(id, match);
        }
        previous = next;
      }
      return measure(
        'step_' + (index + 1),
        previous.size,
        previous.size,
        minimum,
        base,
      );
    });
  }
  if (d.kind === 'COHORT') {
    const initial = userTimes(steps[0] ?? []),
      returns = userTimes(steps[1] ?? rows.filter((r) => r.meaningful));
    const cohort = [...initial].filter(
      ([, times]) =>
        !observationEnd ||
        times[0]! + (d.windowDays + 1) * 86400000 <= +observationEnd,
    );
    const returned = cohort.filter(([id, times]) =>
      (returns.get(id) ?? []).some(
        (t) =>
          t >= times[0]! + d.windowDays * 86400000 &&
          t < times[0]! + (d.windowDays + 1) * 86400000,
      ),
    ).length;
    return [
      measure('cohort_size', cohort.length, cohort.length, minimum),
      measure('returned', returned, returned, minimum, cohort.length),
    ];
  }
  const activeIds = new Set(
    rows.filter((r) => r.meaningful).map((r) => r.userId),
  );
  const selected = rows.filter((r) => d.events.includes(r.name)),
    users = uniqueUsers(selected),
    active = activeIds.size;
  const activeSelected = selected.filter((r) => activeIds.has(r.userId));
  const denominator =
    d.formula === 'RATIO'
      ? uniqueUsers(steps[1] ?? [])
      : d.formula === 'PER_ACTIVE_USER'
        ? active
        : null;
  const value =
    d.formula === 'COUNT'
      ? selected.length
      : d.formula === 'UNIQUE_USERS'
        ? users
        : denominator
          ? (d.formula === 'PER_ACTIVE_USER'
              ? activeSelected.length
              : uniqueUsers(steps[0] ?? [])) / denominator
          : 0;
  const contributors =
    d.formula === 'RATIO'
      ? uniqueUsers(steps[0] ?? [])
      : d.formula === 'PER_ACTIVE_USER'
        ? uniqueUsers(activeSelected)
        : users;
  return [measure('value', value, contributors, minimum, denominator)];
}
export function analyticsCsv(value: unknown) {
  const result = value as {
    metrics?: {
      key: string;
      value: number | null;
      denominator: number | null;
      suppressed: boolean;
    }[];
    trends?: {
      date: string;
      activeUsers: number | null;
      events: number | null;
      suppressed: boolean;
    }[];
    features?: {
      feature: string;
      users: number | null;
      events: number | null;
      suppressed: boolean;
    }[];
    definitions?: {
      id: string;
      values: {
        key: string;
        value: number | null;
        denominator: number | null;
        suppressed: boolean;
      }[];
    }[];
  };
  const records: unknown[][] = [
    ['section', 'key', 'date', 'value', 'denominator', 'suppressed'],
  ];
  for (const row of result.metrics ?? [])
    records.push([
      'metrics',
      row.key,
      '',
      row.value,
      row.denominator,
      row.suppressed,
    ]);
  for (const row of result.trends ?? [])
    for (const metric of ['activeUsers', 'events'] as const)
      records.push([
        'trends',
        metric,
        row.date,
        row[metric],
        '',
        row.suppressed,
      ]);
  for (const row of result.features ?? [])
    for (const metric of ['users', 'events'] as const)
      records.push([
        'features',
        row.feature + '.' + metric,
        '',
        row[metric],
        '',
        row.suppressed,
      ]);
  for (const d of result.definitions ?? [])
    for (const row of d.values)
      records.push([
        'definitions',
        d.id + '.' + row.key,
        '',
        row.value,
        row.denominator,
        row.suppressed,
      ]);
  return encodeCsv(records);
}
function encodeCsv(records: unknown[][]) {
  return (
    records
      .map((row) =>
        row
          .map((cell) => {
            let text = cell === null || cell === undefined ? '' : String(cell);
            if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text))
              text = "'" + text;
            return '"' + text.replaceAll('"', '""') + '"';
          })
          .join(','),
      )
      .join('\r\n') + '\r\n'
  );
}

export function financialAnalyticsCsv(value: unknown) {
  const data = value as {
    suppressed: boolean;
    report: null | {
      currencies: {
        currency: string;
        payments: string;
        refunds: string;
        netCash: string;
        receivables: string;
        invoiceCharges: string;
        mrr: string;
        arr: string;
        conversionNumerator: number;
        conversionDenominator: number;
        byProduct: { productId: string; collected: string }[];
      }[];
    };
    prices: {
      currency: string;
      priceId: string;
      collected: string;
      payingCustomers: number;
    }[];
    economics: {
      currency: string;
      paidAtStart: number | null;
      churned: number | null;
      churnRate: number | null;
      freeToPaid: number | null;
      conversionDenominator: number | null;
      suppressed: boolean;
    }[];
  };
  const rows: unknown[][] = [
    ['section', 'key', 'currency', 'value', 'denominator', 'suppressed'],
  ];
  rows.push(['report', 'suppressed', '', '', '', data.suppressed]);
  for (const currency of data.report?.currencies ?? []) {
    for (const key of [
      'payments',
      'refunds',
      'netCash',
      'receivables',
      'invoiceCharges',
      'mrr',
      'arr',
      'conversionNumerator',
      'conversionDenominator',
    ] as const)
      rows.push([
        'financial',
        key,
        currency.currency,
        currency[key],
        '',
        false,
      ]);
    for (const p of currency.byProduct)
      rows.push([
        'products',
        p.productId + '.collected',
        currency.currency,
        p.collected,
        '',
        false,
      ]);
  }
  for (const price of data.prices)
    rows.push([
      'prices',
      price.priceId + '.collected',
      price.currency,
      price.collected,
      price.payingCustomers,
      false,
    ]);
  for (const row of data.economics)
    for (const key of [
      'paidAtStart',
      'churned',
      'churnRate',
      'freeToPaid',
    ] as const)
      rows.push([
        'economics',
        key,
        row.currency,
        row[key],
        row.conversionDenominator,
        row.suppressed,
      ]);
  return encodeCsv(rows);
}
