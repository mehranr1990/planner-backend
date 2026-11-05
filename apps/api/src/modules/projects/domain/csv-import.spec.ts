import { it, expect } from 'vitest';
import { csvRows, formulaCell } from './csv-import.js';
it.each([
  ['title\r\nhello\r\n', [['title'], ['hello']]],
  [
    '\uFEFFtitle,description\n"a,b","c""d"',
    [
      ['title', 'description'],
      ['a,b', 'c"d'],
    ],
  ],
  [
    'title,description\n"a\nb",',
    [
      ['title', 'description'],
      ['a\nb', ''],
    ],
  ],
  ['title\n""', [['title'], ['']]],
])('parses bounded CSV data %s', (text, expected) =>
  expect(csvRows(text as string)).toEqual(expected),
);
it.each([
  'title\n"unclosed',
  'title\na"b',
  'title\n"x"garbage',
  'a\0b',
  Array(18).fill('a').join(','),
])('rejects malformed CSV %s', (s) => expect(() => csvRows(s)).toThrow());
it('bounds bytes and row count', () => {
  expect(() => csvRows('é'.repeat(131073))).toThrow('SIZE');
  expect(() => csvRows(Array(103).fill('row').join('\n'))).toThrow('ROWS');
});
it.each(['=CMD()', ' \t+SUM(1)', '@bad', '-formula'])(
  'rejects formula-shaped cells %s',
  (s) => expect(formulaCell(s)).toBe(true),
);
it('retains ordinary punctuation and escaped quotes', () =>
  expect(formulaCell('Write "a,b"')).toBe(false));
