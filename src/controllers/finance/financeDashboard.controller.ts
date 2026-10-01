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
