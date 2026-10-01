import { Response } from "express";
import oracledb from "oracledb";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid) {
    tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  }
  if (!tenantId) {
    throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
  }
  return TenantManager.getConnection(tenantId);
}

export const getFinanceDashboardData = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;

  try {
    const userRecord = (req.user || {}) as any;
    const body = req.body || {};

    const companyCode = String(body.company_code || userRecord.company_code || "BSG").trim().toUpperCase();
    let fyPeriod = body.fy_period ? String(body.fy_period).trim() : undefined;
    const divCode = body.div_code && body.div_code !== "All" ? String(body.div_code).trim() : undefined;
    const selectedMonth = body.month ? Number(body.month) : undefined; // 1-12 or undefined

    conn = await getConn(req);

    // 1. Fetch available FY Periods for company
    const fyPeriodsRes: any = await conn.execute(
      `SELECT DISTINCT FY_PERIOD 
       FROM VW_AC_HEADER_SEARCH 
       WHERE COMPANY_CODE = :companyCode 
         AND FY_PERIOD IS NOT NULL 
       ORDER BY FY_PERIOD DESC`,
      { companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const availableFyPeriods: string[] = (fyPeriodsRes.rows || []).map((r: any) => String(r.FY_PERIOD));

    // Default to the first (latest) FY_PERIOD if not provided or invalid
    if (!fyPeriod || !availableFyPeriods.includes(fyPeriod)) {
      fyPeriod = availableFyPeriods[0] || "226";
    }

    // 2. Fetch available Divisions for company
    let availableDivisions: Array<{ div_code: string; div_name?: string }> = [];
    try {
      const divRes: any = await conn.execute(
        `SELECT DISTINCT DIV_CODE 
         FROM VW_AC_HEADER_SEARCH 
         WHERE COMPANY_CODE = :companyCode 
           AND DIV_CODE IS NOT NULL 
         ORDER BY DIV_CODE ASC`,
        { companyCode },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      availableDivisions = (divRes.rows || []).map((r: any) => ({
        div_code: String(r.DIV_CODE),
        div_name: `Division ${r.DIV_CODE}`,
      }));
    } catch (e: any) {
      console.warn("Could not load divisions:", e.message);
    }

    // 3. Base filters for queries
    const baseWhere = `
      COMPANY_CODE = :companyCode
      AND (:fyPeriod IS NULL OR FY_PERIOD = :fyPeriod)
      AND (:divCode IS NULL OR DIV_CODE = :divCode)
    `;
    const baseBinds: any = {
      companyCode,
      fyPeriod: fyPeriod || null,
      divCode: divCode || null,
    };

    // 4. KPI Aggregation by DOC_TYPE
    // Also support filtering by selectedMonth for KPIs if requested
    let kpiWhere = baseWhere;
    const kpiBinds: any = { ...baseBinds };
    if (selectedMonth && selectedMonth >= 1 && selectedMonth <= 12) {
      kpiWhere += ` AND TO_CHAR(DOC_DATE, 'MM') = :monthStr`;
      kpiBinds.monthStr = String(selectedMonth).padStart(2, "0");
    }

    const kpiSql = `
      SELECT 
        DOC_TYPE,
        COUNT(*) AS DOC_COUNT,
        NVL(SUM(CASE WHEN CANCELED = 'Y' THEN 0 ELSE AMOUNT END), 0) AS TOTAL_AMOUNT,
        NVL(SUM(CASE WHEN CANCELED = 'Y' THEN 1 ELSE 0 END), 0) AS CANCELED_COUNT
      FROM VW_AC_HEADER_SEARCH
      WHERE ${kpiWhere}
      GROUP BY DOC_TYPE
    `;
    const kpiRes: any = await conn.execute(kpiSql, kpiBinds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const kpiRows: any[] = kpiRes.rows || [];

    // Prior Month KPIs for trend comparison
    let priorKpiRows: any[] = [];
    if (selectedMonth && selectedMonth >= 1 && selectedMonth <= 12) {
      const priorMonth = selectedMonth === 1 ? 12 : selectedMonth - 1;
      const priorBinds = { ...baseBinds, priorMonthStr: String(priorMonth).padStart(2, "0") };
      const priorKpiSql = `
        SELECT 
          DOC_TYPE,
          COUNT(*) AS DOC_COUNT,
          NVL(SUM(CASE WHEN CANCELED = 'Y' THEN 0 ELSE AMOUNT END), 0) AS TOTAL_AMOUNT
        FROM VW_AC_HEADER_SEARCH
        WHERE ${baseWhere} AND TO_CHAR(DOC_DATE, 'MM') = :priorMonthStr
        GROUP BY DOC_TYPE
      `;
      const priorRes: any = await conn.execute(priorKpiSql, priorBinds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      priorKpiRows = priorRes.rows || [];
    }

    const docTypeMap: Record<string, { count: number; amount: number; canceled: number; prevCount: number; prevAmount: number }> = {};
    for (const r of kpiRows) {
      const dt = String(r.DOC_TYPE).toUpperCase();
      docTypeMap[dt] = {
        count: Number(r.DOC_COUNT || 0),
        amount: Number(r.TOTAL_AMOUNT || 0),
        canceled: Number(r.CANCELED_COUNT || 0),
        prevCount: 0,
        prevAmount: 0,
      };
    }
    for (const r of priorKpiRows) {
      const dt = String(r.DOC_TYPE).toUpperCase();
      if (!docTypeMap[dt]) {
        docTypeMap[dt] = { count: 0, amount: 0, canceled: 0, prevCount: 0, prevAmount: 0 };
      }
      docTypeMap[dt].prevCount = Number(r.DOC_COUNT || 0);
      docTypeMap[dt].prevAmount = Number(r.TOTAL_AMOUNT || 0);
    }

    // 5. 12-Month Trends (Inflow vs Outflow, Receipts, Payments, Invoices, Journals)
    const monthlySql = `
      SELECT 
        TO_CHAR(DOC_DATE, 'MM') AS MONTH_NO,
        TO_CHAR(DOC_DATE, 'Mon') AS MONTH_LABEL,
        NVL(SUM(CASE WHEN DOC_TYPE IN ('BR', 'CR', 'SI') AND (CANCELED IS NULL OR CANCELED != 'Y') THEN AMOUNT ELSE 0 END), 0) AS INFLOW,
        NVL(SUM(CASE WHEN DOC_TYPE IN ('BP', 'CP', 'PI') AND (CANCELED IS NULL OR CANCELED != 'Y') THEN AMOUNT ELSE 0 END), 0) AS OUTFLOW,
        NVL(SUM(CASE WHEN DOC_TYPE IN ('BR', 'CR') AND (CANCELED IS NULL OR CANCELED != 'Y') THEN AMOUNT ELSE 0 END), 0) AS RECEIPTS,
        NVL(SUM(CASE WHEN DOC_TYPE IN ('BP', 'CP') AND (CANCELED IS NULL OR CANCELED != 'Y') THEN AMOUNT ELSE 0 END), 0) AS PAYMENTS,
        NVL(SUM(CASE WHEN DOC_TYPE = 'SI' AND (CANCELED IS NULL OR CANCELED != 'Y') THEN AMOUNT ELSE 0 END), 0) AS SALES_INVOICED,
        NVL(SUM(CASE WHEN DOC_TYPE = 'PI' AND (CANCELED IS NULL OR CANCELED != 'Y') THEN AMOUNT ELSE 0 END), 0) AS PURCHASES_BILLED,
        COUNT(CASE WHEN DOC_TYPE IN ('SI', 'PI') THEN 1 END) AS INVOICES_COUNT,
        COUNT(CASE WHEN DOC_TYPE IN ('BP', 'CP', 'BR', 'CR') THEN 1 END) AS PAYMENTS_COUNT,
        COUNT(CASE WHEN DOC_TYPE IN ('JV', 'RJV', 'UJV') THEN 1 END) AS JOURNALS_COUNT
      FROM VW_AC_HEADER_SEARCH
      WHERE ${baseWhere}
        AND DOC_DATE IS NOT NULL
      GROUP BY TO_CHAR(DOC_DATE, 'MM'), TO_CHAR(DOC_DATE, 'Mon')
      ORDER BY TO_CHAR(DOC_DATE, 'MM')
    `;
    const monthlyRes: any = await conn.execute(monthlySql, baseBinds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const monthlyRows: any[] = (monthlyRes.rows || []).map((m: any) => ({
      MONTH_NO: Number(m.MONTH_NO),
      MONTH_LABEL: String(m.MONTH_LABEL || ""),
      INFLOW: Number(m.INFLOW || 0),
      OUTFLOW: Number(m.OUTFLOW || 0),
      RECEIPTS: Number(m.RECEIPTS || 0),
      PAYMENTS: Number(m.PAYMENTS || 0),
      SALES_INVOICED: Number(m.SALES_INVOICED || 0),
      PURCHASES_BILLED: Number(m.PURCHASES_BILLED || 0),
      INVOICES_COUNT: Number(m.INVOICES_COUNT || 0),
      PAYMENTS_COUNT: Number(m.PAYMENTS_COUNT || 0),
      JOURNALS_COUNT: Number(m.JOURNALS_COUNT || 0),
    }));

    // 6. Top 5 Parties by Volume
    const topPartiesSql = `
      SELECT * FROM (
        SELECT 
          AC_NAME,
          COUNT(*) AS VOUCHER_COUNT,
          NVL(SUM(AMOUNT), 0) AS TOTAL_AMOUNT
        FROM VW_AC_HEADER_SEARCH
        WHERE ${baseWhere}
          AND AC_NAME IS NOT NULL
          AND (CANCELED IS NULL OR CANCELED != 'Y')
        GROUP BY AC_NAME
        ORDER BY TOTAL_AMOUNT DESC
      ) WHERE ROWNUM <= 5
    `;
    const topPartiesRes: any = await conn.execute(topPartiesSql, baseBinds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const totalPartiesAmount = (topPartiesRes.rows || []).reduce((sum: number, r: any) => sum + Number(r.TOTAL_AMOUNT || 0), 0);
    const topParties: any[] = (topPartiesRes.rows || []).map((p: any) => {
      const amt = Number(p.TOTAL_AMOUNT || 0);
      return {
        AC_NAME: String(p.AC_NAME || "-"),
        VOUCHER_COUNT: Number(p.VOUCHER_COUNT || 0),
        TOTAL_AMOUNT: amt,
        SHARE_PERCENT: totalPartiesAmount > 0 ? (amt / totalPartiesAmount) * 100 : 0,
      };
    });

    // 7. Attention Queue & Recent Vouchers
    const attentionSql = `
      SELECT * FROM (
        SELECT 
          DOC_TYPE,
          DOC_NO,
          DOC_DATE,
          AC_NAME,
          REMARKS,
          REF_NO,
          AMOUNT,
          CANCELED,
          DIV_CODE
        FROM VW_AC_HEADER_SEARCH
        WHERE ${baseWhere}
        ORDER BY DOC_DATE DESC NULLS LAST, DOC_NO DESC
      ) WHERE ROWNUM <= 10
    `;
    const attentionRes: any = await conn.execute(attentionSql, baseBinds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const attention: any[] = (attentionRes.rows || []).map((r: any) => ({
      DOC_TYPE: String(r.DOC_TYPE || ""),
      DOC_NO: String(r.DOC_NO || ""),
      DOC_DATE: r.DOC_DATE ? new Date(r.DOC_DATE).toISOString().substring(0, 10) : null,
      AC_NAME: String(r.AC_NAME || "-"),
      REMARKS: r.REMARKS ? String(r.REMARKS) : null,
      REF_NO: r.REF_NO ? String(r.REF_NO) : null,
      AMOUNT: Number(r.AMOUNT || 0),
      CANCELED: r.CANCELED === "Y" ? "Y" : "N",
      DIV_CODE: r.DIV_CODE ? String(r.DIV_CODE) : null,
    }));

    // 8. Construct Summary Rollups
    const si = docTypeMap["SI"] || { count: 0, amount: 0, canceled: 0, prevCount: 0, prevAmount: 0 };
    const pi = docTypeMap["PI"] || { count: 0, amount: 0, canceled: 0, prevCount: 0, prevAmount: 0 };
    const bp = docTypeMap["BP"] || { count: 0, amount: 0, canceled: 0, prevCount: 0, prevAmount: 0 };
    const br = docTypeMap["BR"] || { count: 0, amount: 0, canceled: 0, prevCount: 0, prevAmount: 0 };
    const cp = docTypeMap["CP"] || { count: 0, amount: 0, canceled: 0, prevCount: 0, prevAmount: 0 };
    const cr = docTypeMap["CR"] || { count: 0, amount: 0, canceled: 0, prevCount: 0, prevAmount: 0 };
    const cn = docTypeMap["CN"] || { count: 0, amount: 0, canceled: 0, prevCount: 0, prevAmount: 0 };
    const dn = docTypeMap["DN"] || { count: 0, amount: 0, canceled: 0, prevCount: 0, prevAmount: 0 };
    const jv = docTypeMap["JV"] || { count: 0, amount: 0, canceled: 0, prevCount: 0, prevAmount: 0 };
    const ujv = docTypeMap["UJV"] || { count: 0, amount: 0, canceled: 0, prevCount: 0, prevAmount: 0 };

    const totalInflow = br.amount + cr.amount + si.amount;
    const prevInflow = br.prevAmount + cr.prevAmount + si.prevAmount;
    const totalOutflow = bp.amount + cp.amount + pi.amount;
    const prevOutflow = bp.prevAmount + cp.prevAmount + pi.prevAmount;
    const netCashFlow = (br.amount + cr.amount) - (bp.amount + cp.amount);
    const prevNetCashFlow = (br.prevAmount + cr.prevAmount) - (bp.prevAmount + cp.prevAmount);

    const totalCanceled = Object.values(docTypeMap).reduce((acc, item) => acc + item.canceled, 0);

    const summary = {
      // Invoicing
      SALES_INVOICE_COUNT: si.count,
      SALES_INVOICE_AMOUNT: si.amount,
      PREV_SALES_INVOICE_AMOUNT: si.prevAmount,
      PURCHASE_INVOICE_COUNT: pi.count,
      PURCHASE_INVOICE_AMOUNT: pi.amount,
      PREV_PURCHASE_INVOICE_AMOUNT: pi.prevAmount,

      // Cash & Bank (Treasury)
      BANK_PAYMENT_COUNT: bp.count,
      BANK_PAYMENT_AMOUNT: bp.amount,
      PREV_BANK_PAYMENT_AMOUNT: bp.prevAmount,
      BANK_RECEIPT_COUNT: br.count,
      BANK_RECEIPT_AMOUNT: br.amount,
      PREV_BANK_RECEIPT_AMOUNT: br.prevAmount,
      CASH_PAYMENT_COUNT: cp.count,
      CASH_PAYMENT_AMOUNT: cp.amount,
      PREV_CASH_PAYMENT_AMOUNT: cp.prevAmount,
      CASH_RECEIPT_COUNT: cr.count,
      CASH_RECEIPT_AMOUNT: cr.amount,
      PREV_CASH_RECEIPT_AMOUNT: cr.prevAmount,

      // Adjustments & Journals
      CREDIT_NOTE_COUNT: cn.count,
      CREDIT_NOTE_AMOUNT: cn.amount,
      DEBIT_NOTE_COUNT: dn.count,
      DEBIT_NOTE_AMOUNT: dn.amount,
      JOURNAL_VOUCHER_COUNT: jv.count,
      UNPOSTED_JOURNAL_COUNT: ujv.count,

      // Rollups
      TOTAL_INFLOW: totalInflow,
      PREV_TOTAL_INFLOW: prevInflow,
      TOTAL_OUTFLOW: totalOutflow,
      PREV_TOTAL_OUTFLOW: prevOutflow,
      NET_CASH_FLOW: netCashFlow,
      PREV_NET_CASH_FLOW: prevNetCashFlow,
      TOTAL_CANCELED_COUNT: totalCanceled,
    };

    res.json({
      success: true,
      data: {
        company_code: companyCode,
        fy_period: fyPeriod,
        available_fy_periods: availableFyPeriods,
        available_divisions: availableDivisions,
        summary,
        monthly: monthlyRows,
        topParties,
        attention,
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
