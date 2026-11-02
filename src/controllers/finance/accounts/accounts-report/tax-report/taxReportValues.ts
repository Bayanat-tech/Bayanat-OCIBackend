import oracledb from 'oracledb';

export async function taxReportContext(connection: oracledb.Connection, companyCode: string) {
  const result = await connection.execute<Record<string, any>>(
    `SELECT i.company_name, i.currency, a.base_curr_code, a.lcur_decimal_nos
       FROM ms_companyinfo i LEFT JOIN ms_ac_setup a ON a.company_code = i.company_code
      WHERE i.company_code = :companyCode AND ROWNUM = 1`,
    { companyCode }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  const row = result.rows?.[0] || {};
  const currency = String(row.BASE_CURR_CODE || row.CURRENCY || '').trim();
  let decimals = Number(row.LCUR_DECIMAL_NOS);
  if (row.LCUR_DECIMAL_NOS == null || !Number.isInteger(decimals) || decimals < 0 || decimals > 8) {
    try { decimals = new Intl.NumberFormat('en', {style:'currency', currency}).resolvedOptions().maximumFractionDigits ?? 3; }
    catch { decimals = 3; }
  }
  return { companyName: String(row.COMPANY_NAME || companyCode), currency, decimals };
}

export function taxInvoiceTotal(row: Record<string, any>): number {
  return Number(row.tot_inv_amount ?? (Number(row.inv_amount || 0) + Number(row.tax_amount || 0))) || 0;
}

export function formatTaxReportMoney(value: number, decimals: number): string {
  const formatted = Math.abs(value).toLocaleString('en-US', {minimumFractionDigits:decimals,maximumFractionDigits:decimals});
  return value < 0 ? `(${formatted})` : formatted;
}
