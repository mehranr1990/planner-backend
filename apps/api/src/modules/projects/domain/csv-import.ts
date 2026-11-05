export class CsvImportError extends Error {
  constructor(readonly code: 'SIZE' | 'ROWS' | 'CSV_SYNTAX') {
    super(code);
  }
}
/** Bounded RFC-4180-style parser. Data only; no spreadsheet evaluation or filesystem access. */
export function csvRows(input: string): string[][] {
  if (new TextEncoder().encode(input).byteLength > 262144)
    throw new CsvImportError('SIZE');
  const text = input.replace(/^\uFEFF/, ''),
    rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false;
  const endCell = () => {
    row.push(cell);
    cell = '';
    closed = false;
    if (row.length > 16) throw new CsvImportError('CSV_SYNTAX');
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
    if (rows.length > 101) throw new CsvImportError('ROWS');
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\0') throw new CsvImportError('CSV_SYNTAX');
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      if (cell || closed) throw new CsvImportError('CSV_SYNTAX');
      quoted = true;
      continue;
    }
    if (ch === ',') {
      endCell();
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
      continue;
    }
    if (closed) throw new CsvImportError('CSV_SYNTAX');
    cell += ch;
  }
  if (quoted) throw new CsvImportError('CSV_SYNTAX');
  if (cell || row.length || closed) endRow();
  return rows;
}
export function formulaCell(value: string) {
  return /^[\s\uFEFF]*[=+\-@]/u.test(value);
}
