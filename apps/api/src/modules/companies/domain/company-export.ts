/** Export bounds are technical safety ceilings, independent of commercial entitlements. */
export function companyExport(
  dataset: string,
  format: 'JSON' | 'CSV',
  data: unknown,
  rows: unknown[],
  limits = { maxRecords: 10000, maxBytes: 10485760 },
) {
  if (rows.length > Math.min(10000, limits.maxRecords))
    throw new RangeError('Export record limit');
  const cell = (value: unknown) => {
    let text = typeof value === 'string' ? value : JSON.stringify(value);
    if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const body =
    format === 'JSON'
      ? JSON.stringify({ schemaVersion: 1, dataset, data })
      : '"dataset","record"\r\n' +
        rows.map((r) => cell(dataset) + ',' + cell(r) + '\r\n').join('');
  if (Buffer.byteLength(body, 'utf8') > Math.min(10485760, limits.maxBytes))
    throw new RangeError('Export byte limit');
  return body;
}
