/** Shared contract for both LPO create and update. Optional trailing SP arguments
 * keep existing PowerBuilder / legacy callers compatible. */
export const LPO_DETAIL_INSERT_SQL = `BEGIN SP_INSERT_LPO_DETAIL_SINGLE(
  p_company_code => :cc, p_doc_type => :dt, p_doc_no => :dn,
  p_serial_no => :sn, p_ac_code => :ac, p_header_ac_code => :hac,
  p_amount => :am, p_curr_code => :cu, p_ex_rate => :er,
  p_sign_ind => :si, p_div_code => :dv, p_lcur_amount => :la,
  p_qty => :qty, p_price => :pr, p_prod_code => :pc,
  p_cost_code => :pcc, p_other_remarks => :or, p_remarks => :rm,
  p_tx_cat_code => :tcc, p_tx_compntcat_code_1 => :tc,
  p_tx_compnt_perc_1 => :tp, p_tx_compnt_amt_1 => :tm,
  p_doc_date => :dd, p_job_no => :job, p_dept_code => :dept,
  p_tx_compnt_1_expmt => :tax_type, p_tx_compnt_lcuramt_1 => :tax_base
); END;`;

export function buildLpoDetailBindings(
  detail: Record<string, any>, header: Record<string, any>,
  companyCode: string, docType: string, docNo: string | number, index: number,
) {
  const rate = Number(detail.ex_rate ?? header.ex_rate ?? 1);
  const amount = Number(detail.amount ?? 0);
  const taxAmount = Number(detail.tx_compnt_amt_1 ?? 0);
  const taxPercent = Number(detail.tx_compnt_perc_1 ?? 0);
  return {
    cc: companyCode, dt: docType, dn: docNo,
    sn: detail.serial_no ?? index + 1,
    ac: detail.ac_code, hac: header.ac_code,
    am: amount, cu: detail.curr_code ?? header.curr_code, er: rate,
    si: detail.sign_ind ?? 1, dv: detail.div_code ?? header.div_code,
    la: detail.lcur_amount ?? amount * rate,
    qty: Number(detail.qty ?? 1), pr: Number(detail.price ?? 0),
    pc: detail.prod_code ?? null, pcc: detail.cost_code ?? null,
    or: detail.other_remarks ?? null, rm: detail.remarks ?? null,
    tcc: detail.tx_cat_code ?? null, tc: detail.tx_compntcat_code_1 ?? null,
    tp: detail.tx_compnt_perc_1 ?? null, tm: detail.tx_compnt_amt_1 ?? null,
    dd: new Date(detail.doc_date ?? header.doc_date).toISOString().slice(0, 10),
    job: detail.job_no || null, dept: detail.dept_code || null,
    tax_type: detail.tx_compnt_1_expmt || header.tx_compnt_1_expmt || (taxPercent > 0 ? 'S' : 'N'),
    tax_base: detail.tx_compnt_lcuramt_1 ?? taxAmount * rate,
  };
}
