export type TMfBomRowPayload = {
  company_code: string;
  prin_code: string;
  prod_code: string;
  child_prod_code: string;
  p_uom?: string | null;
  p_qty?: number | null;
  l_uom?: string | null;
  l_qty?: number | null;
  user_id?: string | null;
  user_dt?: string | null;
  quantity?: number | null;
  uppp?: number | null;
  bom_type?: string | null;
  unit_price?: number | null;
  prnt_p_code?: string | null;
};

export type TMfBomSaveResult = {
  success: boolean;
  message: string;
  data?: {
    company_code: string;
    prin_code: string;
    prod_code: string;
    records: number;
  };
  details?: string;
};

/**
 * POSTs the full MF_BOM row set for one Principal + Parent Product to
 * PROC_INS_UPD_MF_BOM via the /mf/bom/upsert route. Unlike the HR
 * components proc, this one is array-based — all rows for the BOM go in
 * a single call (the backend enforces they share COMPANY_CODE / PRIN_CODE
 * / PROD_CODE), so there's no per-row looping here.
 */
export async function upsertMfBomApi(bom: TMfBomRowPayload[]): Promise<TMfBomSaveResult> {
  const response = await fetch("/api/mf/bom/upsert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ bom }),
  });

  const result = (await response.json()) as TMfBomSaveResult;

  if (!response.ok || !result.success) {
    throw new Error(result.details || result.message || "Unable to save BOM");
  }

  return result;
}