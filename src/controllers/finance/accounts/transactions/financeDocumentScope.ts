/** A tenant schema can contain several companies; payload keys are not authorization. */
export function validateFinanceDocumentScope(
  companyCode: string | undefined,
  header: Record<string, any>,
  rowGroups: unknown[]
): void {
  const fail = (message: string, status = 400): never => {
    throw Object.assign(new Error(message), { status });
  };
  if (!companyCode) fail('Authenticated company is required', 401);
  if (header.company_code && String(header.company_code).trim() !== companyCode) {
    fail('Document company does not match the signed-in company', 403);
  }
  for (const rows of rowGroups) {
    if (!Array.isArray(rows)) fail('Document lines must be arrays');
    for (const row of rows as Record<string, any>[]) {
      if (!row || typeof row !== 'object') fail('Invalid document line');
      if (row.company_code && String(row.company_code).trim() !== companyCode) {
        fail('A document line belongs to a different company', 403);
      }
      if (row.doc_type && row.doc_type !== header.doc_type) fail('Line document type must match the header');
    }
  }
  header.company_code = companyCode;
  for (const rows of rowGroups as Record<string, any>[][]) {
    for (const row of rows) {
      row.company_code = companyCode;
      row.doc_type = header.doc_type;
    }
  }
}
