import { it, expect } from 'vitest';
import { companyExport } from './company-export.js';
it('bounds record count and encoded UTF-8 output rather than string length', () => {
  expect(() =>
    companyExport('AUDIT', 'CSV', null, Array(10000).fill('safe')),
  ).not.toThrow();
  expect(() =>
    companyExport('AUDIT', 'CSV', null, Array(10001).fill('safe')),
  ).toThrow(RangeError);
  expect(() =>
    companyExport('KNOWLEDGE', 'JSON', { text: 'ی'.repeat(5242880) }, []),
  ).toThrow(RangeError);
  expect(() =>
    companyExport('KNOWLEDGE', 'CSV', null, ['x'.repeat(10485760)]),
  ).toThrow(RangeError);
});
it('escapes formulas, quotes and record delimiters without converting exact money', () => {
  const text = companyExport('FINANCE', 'CSV', null, [
    '=1+1',
    ' +cmd',
    '-2',
    '@SUM(1)',
    '\t=cmd',
    'a"b\r\nc',
    { amount: '0.10', currency: 'USD' },
  ]);
  for (const v of ["'=1+1", "' +cmd", "'-2", "'@SUM(1)", "'\t=cmd", 'a""b'])
    expect(text).toContain(v);
  expect(text).toContain('0.10');
  expect(
    JSON.parse(
      companyExport(
        'FINANCE',
        'JSON',
        { amount: '999999999999999999.0001' },
        [],
      ),
    ).data.amount,
  ).toBe('999999999999999999.0001');
});
