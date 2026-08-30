import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";

export const frtTaxCategoryList = async (req: Request, res: Response): Promise<void> => {
  await runLookup(req, res, false);
};

export const frtTaxComponentList = async (req: Request, res: Response): Promise<void> => {
  await runLookup(req, res, true);
};

async function runLookup(req: Request, res: Response, components: boolean) {
  const tenantId = getCurrentTenantId();
  if (!tenantId) {
    res.status(400).json({ success: false, message: "Tenant not found" });
    return;
  }

  const companyCode = text(req.body.company_code ?? req.body.COMPANY_CODE);
  const divCode = text(req.body.div_code ?? req.body.DIV_CODE);
  const taxCategory = text(req.body.tx_cat_code ?? req.body.TX_CAT_CODE);
  const activityCode = text(req.body.act_code ?? req.body.ACT_CODE);
  const search = text(req.body.search ?? req.body.SEARCH);
  if (!companyCode || !divCode) {
    res.status(400).json({ success: false, message: "Company and division are required for the tax lookup" });
    return;
  }
  if (components && !taxCategory) {
    res.status(400).json({ success: false, message: "Tax category is required for the tax component lookup" });
    return;
  }

  let connection: oracledb.Connection | undefined;
  try {
    connection = await TenantManager.getConnection(tenantId);
    const result = await connection.execute(
      components
        ? `WITH ranked AS (
             SELECT c.*,
                    ROW_NUMBER() OVER (ORDER BY c.SR_NO, c.TX_COMPNTCAT_CODE) component_pos
               FROM MS_TAX_COMPNTCATEGORY c
              WHERE c.COMPANY_CODE = :company_code
                AND c.DIV_CODE = :div_code
                AND c.TX_CAT_CODE = :tx_cat_code
           )
           SELECT c.DIV_CODE,
                  c.TX_CAT_CODE,
                  c.TX_COMPNTCAT_CODE,
                  c.TX_COMPNTCAT_NAME,
                  c.TX_TYPE,
                  NVL(CASE c.component_pos
                        WHEN 1 THEN a.TX_COMPNT_1_PERC WHEN 2 THEN a.TX_COMPNT_2_PERC
                        WHEN 3 THEN a.TX_COMPNT_3_PERC WHEN 4 THEN a.TX_COMPNT_4_PERC
                      END, NVL(c.TX_PERCNT, 0)) TX_PERCNT
             FROM ranked c
             LEFT JOIN MS_ACTIVITY a ON a.COMPANY_CODE = :company_code AND a.ACTIVITY_CODE = :act_code
            WHERE 1=1
              AND (:search IS NULL
                   OR UPPER(c.TX_COMPNTCAT_CODE || ' ' || c.TX_COMPNTCAT_NAME || ' ' || NVL(c.TX_TYPE, ''))
                      LIKE '%' || UPPER(:search) || '%')
            ORDER BY c.SR_NO, c.TX_COMPNTCAT_CODE`
        : `SELECT c.DIV_CODE,
                  c.TX_CAT_CODE,
                  c.TX_CAT_NAME,
                  c.TX_COMPNT_CODE
             FROM MS_TAX_CATEGORY c
            WHERE c.COMPANY_CODE = :company_code
              AND c.DIV_CODE = :div_code
              AND (:search IS NULL
                   OR UPPER(c.TX_CAT_CODE || ' ' || c.TX_CAT_NAME) LIKE '%' || UPPER(:search) || '%')
            ORDER BY c.TX_CAT_CODE`,
      components
        ? { company_code: companyCode, div_code: divCode, tx_cat_code: taxCategory, act_code: activityCode || null, search: search || null }
        : { company_code: companyCode, div_code: divCode, search: search || null },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    res.json({ success: true, data: result.rows ?? [], totalCount: result.rows?.length ?? 0 });
  } catch (error: any) {
    console.error("Freight tax lookup error:", error);
    res.status(500).json({ success: false, message: "Unable to load Freight tax setup", details: error?.message });
  } finally {
    if (connection) await connection.close();
  }
}

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}
