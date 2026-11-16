import oracledb from 'oracledb';

/** Check what Oracle actually saved before the caller commits the voucher. */
export async function validateSavedPosting(
  connection: oracledb.Connection, companyCode: string, docType: string, docNo: string
): Promise<void> {
  const result = await connection.execute<{ LINE_COUNT: number; BALANCE: number; MISSING_ACCOUNTS: number }>(
    `SELECT COUNT(*) line_count,
            NVL(SUM(d.lcur_amount * d.sign_ind), 0) balance,
            NVL(SUM(CASE WHEN a.ac_code IS NULL THEN 1 ELSE 0 END), 0) missing_accounts
       FROM TR_AC_DETAIL d
       LEFT JOIN MS_ACCODES a ON TRIM(UPPER(a.company_code))=TRIM(UPPER(d.company_code)) AND TRIM(a.ac_code)=TRIM(d.ac_code)
      WHERE TRIM(UPPER(d.company_code))=TRIM(UPPER(:cc)) AND d.doc_type=:dt AND d.doc_no=:dn
        AND NVL(d.cancelled, 'N') <> 'Y'`,
    { cc: companyCode, dt: docType, dn: docNo },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  const saved = result.rows?.[0];
  if (!saved?.LINE_COUNT) throw Object.assign(new Error('Voucher has no active accounting lines'), { status: 400 });
    if (saved.MISSING_ACCOUNTS) {
    try {
      const missingDetails = await connection.execute<{ SERIAL_NO: number; AC_CODE: string; REMARKS: string }>(
        `SELECT d.serial_no, d.ac_code, d.remarks
           FROM TR_AC_DETAIL d
           LEFT JOIN MS_ACCODES a ON TRIM(UPPER(a.company_code))=TRIM(UPPER(d.company_code)) AND TRIM(a.ac_code)=TRIM(d.ac_code)
          WHERE TRIM(UPPER(d.company_code))=TRIM(UPPER(:cc)) AND d.doc_type=:dt AND d.doc_no=:dn
            AND NVL(d.cancelled, 'N') <> 'Y'
            AND a.ac_code IS NULL`,
        { cc: companyCode, dt: docType, dn: docNo },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const missingList = (missingDetails.rows || []).map(r => `Line #${r.SERIAL_NO} Account [${r.AC_CODE || 'EMPTY'}]`).join(', ');
      throw Object.assign(new Error(`Voucher references an account missing from this company's account master: ${missingList}`), { status: 400 });
    } catch (e: any) {
      if (e.status === 400) throw e;
      throw Object.assign(new Error('Voucher references an account missing from this company’s account master'), { status: 400 });
    }
  }
  if (Math.abs(Number(saved.BALANCE)) > 0.00000001) {
    throw Object.assign(new Error(`Voucher is not balanced in local currency (difference ${saved.BALANCE}). No changes were saved.`), { status: 400 });
  }
}
