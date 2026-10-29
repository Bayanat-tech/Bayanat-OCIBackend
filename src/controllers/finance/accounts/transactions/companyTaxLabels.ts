import oracledb from 'oracledb';

export type TaxTreatment = 'N' | 'S' | 'Z' | 'E';
export type TaxTreatmentLabels = Record<TaxTreatment, string>;

export const DEFAULT_TAX_TREATMENT_LABELS: TaxTreatmentLabels = {
  N: 'No Tax', S: 'Std Tax', Z: 'Zero-rated', E: 'Exempt',
};

export async function getCompanyTaxLabels(connection: oracledb.Connection, companyCode: string): Promise<TaxTreatmentLabels> {
  const labels = { ...DEFAULT_TAX_TREATMENT_LABELS };
  try {
    const result = await connection.execute<{ TREATMENT_CODE: string; DISPLAY_LABEL: string }>(
      `SELECT treatment_code, display_label FROM MS_AC_TAX_TREATMENT_LABEL WHERE company_code = :companyCode`,
      { companyCode }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    for (const row of result.rows || []) {
      const code = String(row.TREATMENT_CODE).trim() as TaxTreatment;
      const label = String(row.DISPLAY_LABEL || '').trim();
      if (Object.prototype.hasOwnProperty.call(labels, code) && label) labels[code] = label;
    }
  } catch (error) {
    // Existing tenant schemas can use the normal labels without this optional configuration table.
    if ((error as { errorNum?: number }).errorNum !== 942) throw error;
  }
  return labels;
}
