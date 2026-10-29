export function normalizeAccountingSign(value: unknown, fallback = 1): 1 | -1 {
  if (typeof value === 'string') {
    const sign = value.trim().toLowerCase();
    if (sign === 'dr' || sign === 'debit') return 1;
    if (sign === 'cr' || sign === 'credit') return -1;
  }
  const sign = Number(value);
  return sign === 1 || sign === -1 ? sign : fallback === -1 ? -1 : 1;
}

/** Match the PowerBuilder tax engine: calculate tax, round to 4, then convert. */
export function postingAmounts(detail: Record<string, any>, header: Record<string, any>) {
  const rate = Number(detail.ex_rate ?? header.ex_rate ?? 1);
  const amount = Math.abs(Number(detail.amount ?? 0));
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) {
    throw new Error('Accounting amount and exchange rate must be valid; exchange rate must be positive.');
  }
  const roundTax = (value: number) => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 10000) / 10000;
  const result: Record<string, number> = {
    AMOUNT: amount, EX_RATE: rate,
    LCUR_AMOUNT: Math.abs(Number(detail.lcur_amount ?? amount * rate)),
  };
  for (let component = 1; component <= 4; component++) {
    const treatment = detail[`tx_compnt_${component}_expmt`] ?? detail[`tx_compnt_${component}_exmpt`];
    const withoutTax = ['N', 'Z', 'E'].includes(String(treatment || '').toUpperCase());
    const percent = withoutTax ? 0 : Number(detail[`tx_compnt_perc_${component}`] ?? 0);
    const tax = withoutTax ? 0 : roundTax(Number(detail[`tx_compnt_amt_${component}`] ?? amount * percent / 100));
    const localTax = withoutTax ? 0 : roundTax(Number(detail[`tx_compnt_lcuramt_${component}`] ?? tax * rate));
    if (![percent, tax, localTax].every(Number.isFinite)) throw new Error('Invalid accounting tax amount.');
    result[`TX_COMPNT_AMT_${component}`] = tax;
    result[`TX_COMPNT_LCURAMT_${component}`] = localTax;
    result[`TX_COMPNT_PERC_${component}`] = percent;
  }
  if (!Number.isFinite(result.LCUR_AMOUNT)) throw new Error('Invalid accounting local-currency amount.');
  return result;
}
