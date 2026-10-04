import { Request, Response } from "express";
import oracledb from "oracledb";
import constants from "../../helpers/constants";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";

async function getConn(req: Request): Promise<oracledb.Connection> {
  const user = (req as any).user || {};
  const body = req.body || {};
  const loginid = body.user_id || body.USER_ID || body.loginid || body.LOGINID || user.loginid || user.LOGINID || "ADMIN";

  let tenantId = getCurrentTenantId();
  if (!tenantId && loginid) {
    tenantId = await TenantManager.getTenantForUser(loginid);
  }
  if (!tenantId) {
    throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
  }
  return TenantManager.getConnection(tenantId);
}

async function rowsFromCursor(cursor: any): Promise<any[]> {
  if (!cursor) return [];
  const rows: any[] = [];
  try {
    let row: any;
    while ((row = await cursor.getRow())) {
      rows.push(row);
    }
  } finally {
    try {
      await cursor.close();
    } catch (_) {}
  }
  return rows;
}

export const getFinanceDashboardData = async (req: Request, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;

  try {
    const user = (req as any).user || {};
    const body = req.body || {};

    const companyCode = String(body.company_code || body.COMPANY_CODE || user.company_code || "BSG").trim().toUpperCase();
    const userId = String(body.user_id || body.USER_ID || body.loginid || body.LOGINID || user.loginid || "ADMIN").trim();
    const fyPeriod = body.fy_period ? String(body.fy_period).trim() : null;
    const divCode = body.div_code && body.div_code !== "All" ? String(body.div_code).trim() : null;
    const month = body.month != null && Number(body.month) > 0 ? Number(body.month) : null;

    conn = await getConn(req);

    // Call stored procedure PROC_FIN_DASHBOARD
    const result = await conn.execute(
      `BEGIN
         PROC_FIN_DASHBOARD(
           :p_company_code,
           :p_user_id,
           :p_fy_period,
           :p_div_code,
           :p_month,
           :p_summary,
           :p_monthly,
           :p_top_parties,
           :p_attention,
           :p_meta
         );
       END;`,
      {
        p_company_code: companyCode,
        p_user_id: userId,
        p_fy_period: fyPeriod,
        p_div_code: divCode,
        p_month: month,
        p_summary: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        p_monthly: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        p_top_parties: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        p_attention: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        p_meta: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const outBinds = result.outBinds as any;
    const summaryRows = await rowsFromCursor(outBinds.p_summary);
    const monthly = await rowsFromCursor(outBinds.p_monthly);
    const topParties = await rowsFromCursor(outBinds.p_top_parties);
    const attention = await rowsFromCursor(outBinds.p_attention);
    const metaRows = await rowsFromCursor(outBinds.p_meta);

    let topCustomers: any[] = [];
    let topSuppliers: any[] = [];
    let exposureSummary = {
      RECEIVABLE_OUTSTANDING: 0,
      RECEIVABLE_OVERDUE: 0,
      PAYABLE_OUTSTANDING: 0,
      PAYABLE_OVERDUE: 0,
    };
    let currencyCode = "";
    let currencySymbol = "";
    let currencyDecimals: number | null = null;

    try {
      const exposureResult = await conn.execute(
        `WITH PARTY_EXPOSURE AS (
           SELECT
             CASE WHEN UPPER(v.ORG_DOCTYPE) = 'SI' THEN 'CUSTOMER' ELSE 'SUPPLIER' END AS PARTY_TYPE,
             v.AC_CODE,
             NVL(MAX(a.AC_NAME), v.AC_CODE) AS AC_NAME,
             COUNT(DISTINCT v.INV_NO) AS OPEN_INVOICE_COUNT,
             SUM(ABS(NVL(v.LCUR_AMOUNT, 0))) AS OUTSTANDING_AMOUNT,
             SUM(CASE
                   WHEN NVL(v.DUE_DATE, v.INV_DATE) < TRUNC(SYSDATE)
                   THEN ABS(NVL(v.LCUR_AMOUNT, 0))
                   ELSE 0
                 END) AS OVERDUE_AMOUNT,
             MIN(NVL(v.DUE_DATE, v.INV_DATE)) AS OLDEST_DUE_DATE
           FROM V_INV_OUTSTANDING_WITHUNALLOC v
           LEFT JOIN MS_ACCODES a
             ON a.COMPANY_CODE = v.COMPANY_CODE
            AND a.AC_CODE = v.AC_CODE
           WHERE v.COMPANY_CODE = :companyCode
             AND UPPER(v.ORG_DOCTYPE) IN ('SI', 'PI')
             AND v.UNALLOCATED_FLAG = 'A'
             AND ABS(NVL(v.LCUR_AMOUNT, 0)) > 0.0001
             AND (:divCode IS NULL OR v.DIV_CODE = :divCode)
           GROUP BY
             CASE WHEN UPPER(v.ORG_DOCTYPE) = 'SI' THEN 'CUSTOMER' ELSE 'SUPPLIER' END,
             v.AC_CODE
         ), RANKED AS (
           SELECT p.*,
                  ROW_NUMBER() OVER (
                    PARTITION BY PARTY_TYPE
                    ORDER BY OUTSTANDING_AMOUNT DESC, AC_NAME
                  ) AS PARTY_RANK
           FROM PARTY_EXPOSURE p
         )
         SELECT * FROM RANKED
         WHERE PARTY_RANK <= 5
         ORDER BY PARTY_TYPE, PARTY_RANK`,
        { companyCode, divCode },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      const exposureRows = (exposureResult.rows || []) as any[];
      topCustomers = exposureRows.filter((row) => row.PARTY_TYPE === "CUSTOMER");
      topSuppliers = exposureRows.filter((row) => row.PARTY_TYPE === "SUPPLIER");

      const exposureTotals = await conn.execute(
        `SELECT
           NVL(SUM(CASE WHEN UPPER(ORG_DOCTYPE) = 'SI' THEN ABS(NVL(LCUR_AMOUNT, 0)) ELSE 0 END), 0) AS RECEIVABLE_OUTSTANDING,
           NVL(SUM(CASE WHEN UPPER(ORG_DOCTYPE) = 'SI' AND NVL(DUE_DATE, INV_DATE) < TRUNC(SYSDATE)
                        THEN ABS(NVL(LCUR_AMOUNT, 0)) ELSE 0 END), 0) AS RECEIVABLE_OVERDUE,
           NVL(SUM(CASE WHEN UPPER(ORG_DOCTYPE) = 'PI' THEN ABS(NVL(LCUR_AMOUNT, 0)) ELSE 0 END), 0) AS PAYABLE_OUTSTANDING,
           NVL(SUM(CASE WHEN UPPER(ORG_DOCTYPE) = 'PI' AND NVL(DUE_DATE, INV_DATE) < TRUNC(SYSDATE)
                        THEN ABS(NVL(LCUR_AMOUNT, 0)) ELSE 0 END), 0) AS PAYABLE_OVERDUE
         FROM V_INV_OUTSTANDING_WITHUNALLOC
         WHERE COMPANY_CODE = :companyCode
           AND UPPER(ORG_DOCTYPE) IN ('SI', 'PI')
           AND UNALLOCATED_FLAG = 'A'
           AND ABS(NVL(LCUR_AMOUNT, 0)) > 0.0001
           AND (:divCode IS NULL OR DIV_CODE = :divCode)`,
        { companyCode, divCode },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      exposureSummary = { ...exposureSummary, ...((exposureTotals.rows?.[0] as any) || {}) };
    } catch (exposureError) {
      console.warn("Finance dashboard exposure query unavailable:", exposureError);
    }

    try {
      // 1. Try MS_AC_SETUP for this company
      const acSetupRes = await conn.execute(
        `SELECT BASE_CURR_CODE, AMOUNT_DECIMAL_NOS, LCUR_DECIMAL_NOS
         FROM MS_AC_SETUP
         WHERE TRIM(UPPER(COMPANY_CODE)) = TRIM(UPPER(:companyCode))
           AND BASE_CURR_CODE IS NOT NULL
           AND ROWNUM = 1`,
        { companyCode },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const acRow = acSetupRes.rows?.[0] as any;
      if (acRow?.BASE_CURR_CODE) {
        currencyCode = String(acRow.BASE_CURR_CODE).trim().toUpperCase();
        if (acRow.LCUR_DECIMAL_NOS != null || acRow.AMOUNT_DECIMAL_NOS != null) {
          currencyDecimals = Number(acRow.LCUR_DECIMAL_NOS ?? acRow.AMOUNT_DECIMAL_NOS);
        }
      }

      // 2. If not found in MS_AC_SETUP, check MS_COMPANY for country / company name
      let companyCountry = "";
      let companyDbName = "";
      if (!currencyCode) {
        const compRes = await conn.execute(
          `SELECT COMPANY_NAME, COUNTRY
           FROM MS_COMPANY
           WHERE TRIM(UPPER(COMPANY_CODE)) = TRIM(UPPER(:companyCode))
             AND ROWNUM = 1`,
          { companyCode },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const compRow = compRes.rows?.[0] as any;
        if (compRow) {
          companyCountry = String(compRow.COUNTRY || "").trim().toUpperCase();
          companyDbName = String(compRow.COMPANY_NAME || "").trim().toUpperCase();
        }

        const bodyCompName = String(body.company_name || user.company_name || "").trim().toUpperCase();
        const fullCompText = `${companyCode} ${companyCountry} ${companyDbName} ${bodyCompName}`;

        if (companyCountry === "INDIA" || fullCompText.includes("INDIA") || ["GNL", "GRL", "BTIND"].includes(companyCode)) {
          currencyCode = "INR";
        } else if (companyCountry === "OMAN" || fullCompText.includes("OMAN") || ["BSG", "SNL", "PRL"].includes(companyCode)) {
          currencyCode = "OMR";
        } else if (companyCountry === "UAE" || fullCompText.includes("UAE") || fullCompText.includes("EMIRATES") || fullCompText.includes("DUBAI")) {
          currencyCode = "AED";
        } else if (companyCountry === "SAUDI" || companyCountry === "KSA" || fullCompText.includes("SAUDI")) {
          currencyCode = "SAR";
        } else if (companyCountry === "QATAR" || fullCompText.includes("QATAR")) {
          currencyCode = "QAR";
        } else if (companyCountry === "KUWAIT" || fullCompText.includes("KUWAIT")) {
          currencyCode = "KWD";
        } else if (companyCountry === "BAHRAIN" || fullCompText.includes("BAHRAIN")) {
          currencyCode = "BHD";
        } else if (companyCountry === "USA" || companyCountry === "UNITED STATES") {
          currencyCode = "USD";
        } else if (companyCountry === "UK" || companyCountry === "UNITED KINGDOM") {
          currencyCode = "GBP";
        }
      }

      // 3. If still not determined, inspect TR_AC_HEADER transactions
      if (!currencyCode) {
        const trCurrRes = await conn.execute(
          `SELECT CURR_CODE, COUNT(*) AS CNT
           FROM TR_AC_HEADER
           WHERE TRIM(UPPER(COMPANY_CODE)) = TRIM(UPPER(:companyCode))
             AND CURR_CODE IS NOT NULL
           GROUP BY CURR_CODE
           ORDER BY CNT DESC`,
          { companyCode },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const trRow = trCurrRes.rows?.[0] as any;
        if (trRow?.CURR_CODE) {
          currencyCode = String(trRow.CURR_CODE).trim().toUpperCase();
        }
      }

      // 4. Default fallback: check if company name or user tenant has India
      if (!currencyCode) {
        const tenantHint = String((req as any).user?.tenantId || (req as any).user?.tenant_name || "").toUpperCase();
        if (tenantHint.includes("IND")) {
          currencyCode = "INR";
        } else {
          currencyCode = "OMR";
        }
      }

      // 5. Look up currency symbol and decimal places from MS_CURRENCY
      const currMasterRes = await conn.execute(
        `SELECT CURR_SIGN, SUBDIVISION
         FROM MS_CURRENCY
         WHERE TRIM(UPPER(CURR_CODE)) = TRIM(UPPER(:currCode))
         ORDER BY CASE WHEN TRIM(UPPER(COMPANY_CODE)) = TRIM(UPPER(:companyCode)) THEN 0 ELSE 1 END, ROWNUM`,
        { currCode: currencyCode, companyCode },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const currMasterRow = currMasterRes.rows?.[0] as any;
      if (currMasterRow) {
        const rawSign = String(currMasterRow.CURR_SIGN || "").trim();
        // Ignore invalid characters like '?' or unprintable characters
        if (rawSign && !rawSign.includes("?") && rawSign.toUpperCase() !== currencyCode) {
          currencySymbol = rawSign;
        }
        if (currencyDecimals == null && currMasterRow.SUBDIVISION != null) {
          currencyDecimals = Number(currMasterRow.SUBDIVISION);
        }
      }

      // Known currency symbols map (clean UTF-8)
      const KNOWN_SYMBOLS: Record<string, string> = {
        INR: "₹",
        OMR: "ر.ع.",
        AED: "د.إ",
        USD: "$",
        EUR: "€",
        GBP: "£",
        SAR: "ر.س",
        QAR: "ر.ق",
        KWD: "د.ك",
        KD: "د.ك",
        BHD: "ب.د",
        JPY: "¥",
        CNY: "¥",
        SGD: "S$",
        CAD: "CA$",
        AUD: "A$",
      };

      if (!currencySymbol && KNOWN_SYMBOLS[currencyCode]) {
        currencySymbol = KNOWN_SYMBOLS[currencyCode];
      }

      // Decimals precision determination:
      // 3 decimals for OMR, BHD, KWD, JOD, TND
      // 2 decimals for INR, USD, AED, SAR, QAR, EUR, GBP
      // 0 decimals for JPY, KRW
      if (currencyDecimals == null || isNaN(currencyDecimals)) {
        if (["OMR", "BHD", "KWD", "KD", "JOD", "TND"].includes(currencyCode)) {
          currencyDecimals = 3;
        } else if (["JPY", "KRW"].includes(currencyCode)) {
          currencyDecimals = 0;
        } else {
          currencyDecimals = 2;
        }
      }
    } catch (currencyError) {
      console.warn("Finance dashboard currency lookup unavailable:", currencyError);
      if (!currencyCode) currencyCode = "OMR";
      if (!currencySymbol) currencySymbol = currencyCode === "INR" ? "₹" : (currencyCode === "OMR" ? "ر.ع." : currencyCode);
      if (currencyDecimals == null) currencyDecimals = currencyCode === "OMR" ? 3 : 2;
    }

    // Also fetch available FY periods and divisions for filter dropdowns
    let availableFyPeriods: string[] = [];
    let availableDivisions: Array<{ div_code: string; div_name?: string }> = [];

    try {
      const pRes = await conn.execute(
        `SELECT DISTINCT FY_PERIOD FROM VW_AC_HEADER_SEARCH WHERE COMPANY_CODE = :companyCode AND FY_PERIOD IS NOT NULL ORDER BY FY_PERIOD DESC`,
        { companyCode },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      availableFyPeriods = (pRes.rows || []).map((r: any) => String(r.FY_PERIOD));

      try {
        const dRes = await conn.execute(
          `SELECT d.DIV_CODE, NVL(m.DIV_NAME, d.DIV_CODE) AS DIV_NAME
           FROM (
             SELECT DISTINCT DIV_CODE 
             FROM VW_AC_HEADER_SEARCH 
             WHERE COMPANY_CODE = :companyCode AND DIV_CODE IS NOT NULL
             UNION
             SELECT DISTINCT DIV_CODE 
             FROM MS_HR_DIVISION 
             WHERE (COMPANY_CODE = :companyCode OR COMPANY_CODE IS NULL)
           ) d
           LEFT JOIN MS_HR_DIVISION m 
             ON TRIM(m.DIV_CODE) = TRIM(d.DIV_CODE)
           ORDER BY d.DIV_CODE ASC`,
          { companyCode },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        availableDivisions = (dRes.rows || []).map((r: any) => ({
          div_code: String(r.DIV_CODE),
          div_name: r.DIV_NAME ? String(r.DIV_NAME).trim() : `Division ${r.DIV_CODE}`,
        }));
      } catch (divErr) {
        const dRes = await conn.execute(
          `SELECT DISTINCT DIV_CODE FROM VW_AC_HEADER_SEARCH WHERE COMPANY_CODE = :companyCode AND DIV_CODE IS NOT NULL ORDER BY DIV_CODE ASC`,
          { companyCode },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        availableDivisions = (dRes.rows || []).map((r: any) => ({
          div_code: String(r.DIV_CODE),
          div_name: `Division ${r.DIV_CODE}`,
        }));
      }
    } catch (_) {}

    const selectedFy = metaRows[0]?.SELECTED_FY_PERIOD || fyPeriod || availableFyPeriods[0] || "226";

    res.json({
      success: true,
      data: {
        company_code: companyCode,
        fy_period: selectedFy,
        available_fy_periods: availableFyPeriods,
        available_divisions: availableDivisions,
        summary: summaryRows[0] || {},
        monthly,
        topParties,
        topCustomers,
        topSuppliers,
        exposureSummary,
        attention,
        currency_code: currencyCode,
        currency_symbol: currencySymbol,
        currency_decimals: currencyDecimals,
      },
    });
  } catch (err: any) {
    console.error("Finance dashboard error:", err);
    res.status(err.status || constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: err.message || "Failed to load finance dashboard data",
    });
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch (e: any) {
        console.warn("Close conn error:", e);
      }
    }
  }
};
