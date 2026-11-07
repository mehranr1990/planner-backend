import { it, expect } from 'vitest';
import {
  CompanyKnowledgeDocumentCreateSchema,
  CompanyKnowledgeVersionCreateSchema,
  CompanyKnowledgeDocumentPatchSchema,
  CompanyExportInputSchema,
  CompanyReportQuerySchema,
} from './company-knowledge.js';
const id = '12345678-1234-4234-8234-123456789012';
it('accepts bounded explicit reporting windows and rejects ambiguous dates, zones and financial dataset invention', () => {
  const q = {
    fromDate: '2026-11-01',
    toDate: '2026-12-01',
    timezone: 'Asia/Tehran',
  };
  expect(CompanyReportQuerySchema.safeParse(q).success).toBe(true);
  for (const bad of [
    { ...q, toDate: q.fromDate },
    { ...q, toDate: '2027-12-01' },
    { ...q, timezone: 'invented/zone' },
  ])
    expect(CompanyReportQuerySchema.safeParse(bad).success).toBe(false);
  expect(
    CompanyExportInputSchema.safeParse({
      ...q,
      dataset: 'STAFF_CASES',
      format: 'JSON',
    }).success,
  ).toBe(false);
});
it('denies custody, publication and file-rebinding fields and validates safe files', () => {
  expect(
    CompanyKnowledgeDocumentCreateSchema.safeParse({
      id,
      folderId: id,
      title: 'Guide',
      sourceSpaceId: id,
    }).success,
  ).toBe(false);
  expect(
    CompanyKnowledgeDocumentPatchSchema.safeParse({ publishedVersionId: id })
      .success,
  ).toBe(false);
  const file = {
    id,
    filename: 'guide.txt',
    mimeType: 'text/plain',
    expectedSize: 1,
  };
  expect(CompanyKnowledgeVersionCreateSchema.safeParse(file).success).toBe(
    true,
  );
  for (const bad of [
    { ...file, fileId: id },
    { ...file, filename: '../guide.txt' },
    { ...file, mimeType: 'image/svg+xml' },
    { ...file, expectedSize: 104857601 },
  ])
    expect(CompanyKnowledgeVersionCreateSchema.safeParse(bad).success).toBe(
      false,
    );
});
