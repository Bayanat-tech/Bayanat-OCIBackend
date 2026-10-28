import oracledb from 'oracledb';

export async function loadLedgerCompanyName(connection: oracledb.Connection, companyCode: string): Promise<string> {
  const result = await connection.execute<{ COMPANY_NAME: string }>(
    'SELECT company_name FROM ms_companyinfo WHERE company_code = :companyCode',
    { companyCode }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return result.rows?.[0]?.COMPANY_NAME || companyCode;
}

/** Keep preview and spreadsheet ordering identical to the PowerBuilder ledger. */
export function prepareLedgerRows(rows: any[], chequeDateWise = false): any[] {
  const dateValue = (value: unknown): number => {
    const time = new Date(value as string).getTime();
    return Number.isFinite(time) && time >= Date.UTC(1900, 0, 2) ? time : 0;
  };
  const compare = (a: unknown, b: unknown) => String(a ?? '').localeCompare(String(b ?? ''), 'en', { numeric: true });
  return rows
    .filter(row => String(row.cancelled ?? '').toUpperCase() !== 'Y')
    .map(row => ({ ...row, bank: row.bank ?? row.bank_ac_name ?? row.cheque_desc ?? '' }))
    .sort((a, b) => {
      const group = compare(a.company_code, b.company_code) || compare(a.ac_code, b.ac_code) || compare(a.pdc_ind === 'Y' ? 'Y' : 'N', b.pdc_ind === 'Y' ? 'Y' : 'N');
      const aDate = (chequeDateWise && dateValue(a.cheque_date)) || dateValue(a.doc_date);
      const bDate = (chequeDateWise && dateValue(b.cheque_date)) || dateValue(b.doc_date);
      return group || aDate - bDate || compare(a.doc_type, b.doc_type) || compare(a.doc_no, b.doc_no) || compare(a.serial_no, b.serial_no);
    });
}
