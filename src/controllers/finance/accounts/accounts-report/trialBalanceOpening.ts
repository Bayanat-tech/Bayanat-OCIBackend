/** PowerBuilder loads openings separately and adds accounts with no period activity. */
export function mergeTrialBalanceOpenings(periodRows: Record<string, any>[], openingRows: Record<string, any>[], codeField: string): Record<string, any>[] {
  const key = (row: Record<string, any>) => `${row.company_code}|${row[codeField]}`;
  const rows = new Map<string, Record<string, any>>(periodRows.map(row => [key(row), { ...row, opening: 0 }]));
  for (const opening of openingRows) {
    const id = key(opening);
    const row = rows.get(id) || { ...opening, debit_amount: 0, credit_amount: 0, amount: 0, opening: 0 };
    row.opening += Number(opening.amount) || 0;
    rows.set(id, row);
  }
  return [...rows.values()].map<Record<string, any>>(row => ({ ...row, amount: (Number(row.amount) || 0) + row.opening }))
    .sort((a, b) => String(a[codeField]).localeCompare(String(b[codeField]), 'en', { numeric: true }));
}

export function previousReportDate(fromDate: string): string {
  const date = new Date(`${fromDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid report start date');
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
