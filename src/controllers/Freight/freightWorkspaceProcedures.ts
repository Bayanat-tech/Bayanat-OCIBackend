import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

type Connection = oracledb.Connection;

export const frtDashboard = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = String(req.body.company_code ?? req.body.COMPANY_CODE ?? "BSG");
    const userId = String(req.body.user_id ?? req.body.USER_ID ?? req.body.loginid ?? req.body.LOGINID ?? "");
    const year = Number(req.body.year ?? req.body.YEAR) || new Date().getFullYear();
    const month = Number(req.body.month ?? req.body.MONTH) || new Date().getMonth() + 1;

    try {
      const result = await connection.execute(
        `BEGIN
           PROC_FRT_DASHBOARD(
             :p_company_code,
             :p_user_id,
             :p_year,
             :p_month,
             :p_summary,
             :p_monthly,
             :p_top_principals,
             :p_attention
           );
         END;`,
        {
          p_company_code: companyCode,
          p_user_id: userId,
          p_year: year,
          p_month: month,
          p_summary: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
          p_monthly: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
          p_top_principals: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
          p_attention: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      const outBinds = result.outBinds as any;
      const summaryRows = await rowsFromCursor(outBinds.p_summary);
      const monthly = await rowsFromCursor(outBinds.p_monthly);
      const topPrincipals = await rowsFromCursor(outBinds.p_top_principals);
      const attention = await rowsFromCursor(outBinds.p_attention);

      // Enhance with available years and companies
      const metadata = await getDashboardMetadata(connection, companyCode, year);

      res.json({
        success: true,
        data: {
          summary: summaryRows[0] ?? {},
          monthly,
          topPrincipals,
          attention,
          ...metadata,
        },
      });
    } catch (error: any) {
      const message = String(error?.message || "");
      if (message.includes("PLS-00201") || message.includes("ORA-06550") || message.includes("PROC_FRT_DASHBOARD")) {
        // Procedure missing in tenant schema - seamlessly execute direct dynamic query
        const data = await runDynamicDashboard(connection, companyCode, userId, year, month);
        res.json({ success: true, data });
        return;
      }
      throw error;
    }
  });
};

export const frtWorkspaceSummary = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = String(req.body.company_code ?? req.body.COMPANY_CODE ?? "BSG");
    const userId = String(req.body.user_id ?? req.body.USER_ID ?? req.body.loginid ?? req.body.LOGINID ?? "");

    try {
      const result = await connection.execute(
        `BEGIN
           PROC_FRT_WORKSPACE_SUMMARY(
             :p_company_code,
             :p_user_id,
             :p_summary,
             :p_recent_jobs
           );
         END;`,
        {
          p_company_code: companyCode,
          p_user_id: userId,
          p_summary: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
          p_recent_jobs: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      const outBinds = result.outBinds as any;
      const summaryRows = await rowsFromCursor(outBinds.p_summary);
      const recentJobs = await rowsFromCursor(outBinds.p_recent_jobs);
      res.json({ success: true, data: { summary: summaryRows[0] ?? {}, recentJobs } });
    } catch (error: any) {
      const message = String(error?.message || "");
      if (message.includes("PLS-00201") || message.includes("ORA-06550") || message.includes("PROC_FRT_WORKSPACE_SUMMARY")) {
        const data = await runDynamicWorkspaceSummary(connection, companyCode);
        res.json({ success: true, data });
        return;
      }
      throw error;
    }
  });
};

export const frtJobSearch = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = String(req.body.company_code ?? req.body.COMPANY_CODE ?? "BSG");
    const userId = req.body.user_id ?? req.body.USER_ID ?? req.body.loginid ?? req.body.LOGINID;
    const jobNo = req.body.job_no ?? req.body.JOB_NO ?? null;
    const jobDate = toDate(req.body.job_date ?? req.body.JOB_DATE);
    const fyPeriod = req.body.fy_period ?? req.body.FY_PERIOD ?? req.body.fy ?? req.body.FY ?? null;

    try {
      const result = await connection.execute(
        `BEGIN
           PROC_FRT_JOB_SEARCH(
             :p_company_code,
             :p_user_id,
             :p_job_no,
             :p_job_date,
             :p_fy_period,
             :p_result
           );
         END;`,
        {
          p_company_code: companyCode,
          p_user_id: userId,
          p_job_no: jobNo,
          p_job_date: jobDate,
          p_fy_period: fyPeriod,
          p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      const rows = await rowsFromCursor((result.outBinds as any).p_result);
      res.json({ success: true, data: rows, totalCount: rows.length });
    } catch (error: any) {
      const message = String(error?.message || "");
      if (message.includes("PLS-00201") || message.includes("ORA-06550") || message.includes("PROC_FRT_JOB_SEARCH")) {
        const rows = await runDynamicJobSearch(connection, companyCode, jobNo, jobDate);
        res.json({ success: true, data: rows, totalCount: rows.length });
        return;
      }
      throw error;
    }
  });
};

export const frtGlobalSearch = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = String(req.body.company_code ?? req.body.COMPANY_CODE ?? "BSG");
    const userId = req.body.user_id ?? req.body.USER_ID ?? req.body.loginid ?? req.body.LOGINID;
    const search = req.body.search ?? req.body.SEARCH ?? req.body.q ?? req.body.Q ?? null;

    try {
      const result = await connection.execute(
        `BEGIN
           PROC_FRT_GLOBAL_SEARCH(
             :p_company_code,
             :p_user_id,
             :p_search,
             :p_result
           );
         END;`,
        {
          p_company_code: companyCode,
          p_user_id: userId,
          p_search: search,
          p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      const rows = await rowsFromCursor((result.outBinds as any).p_result);
      res.json({ success: true, data: rows, totalCount: rows.length });
    } catch (error: any) {
      const message = String(error?.message || "");
      if (message.includes("PLS-00201") || message.includes("ORA-06550") || message.includes("PROC_FRT_GLOBAL_SEARCH")) {
        const rows = await runDynamicGlobalSearch(connection, companyCode, search);
        res.json({ success: true, data: rows, totalCount: rows.length });
        return;
      }
      throw error;
    }
  });
};

// ─── Resilient Dynamic SQL Queries for Any Tenant Schema ───

async function getDashboardMetadata(connection: Connection, companyCode: string, year: number) {
  let availableYears: number[] = [];
  let availableCompanies: { company_code: string; company_name: string }[] = [];
  let latestActiveMonth: number = new Date().getMonth() + 1;

  try {
    const yearsRes = await connection.execute(
      `SELECT DISTINCT EXTRACT(YEAR FROM JOB_DATE) AS YR
       FROM TI_JOB
       WHERE JOB_DATE IS NOT NULL AND UPPER(COMPANY_CODE) = UPPER(:company_code)
       ORDER BY YR DESC`,
      { company_code: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    availableYears = (yearsRes.rows as any[])
      .map((r) => Number(r.YR))
      .filter((y) => Number.isFinite(y) && y > 1900);
  } catch (err) {
    console.warn("Could not query available years:", err);
  }

  try {
    const compRes = await connection.execute(
      `SELECT DISTINCT C.COMPANY_CODE, NVL(C.COMPANY_NAME, C.COMPANY_CODE) AS COMPANY_NAME
       FROM MS_COMPANY C
       WHERE C.COMPANY_CODE IS NOT NULL
       ORDER BY C.COMPANY_CODE`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    availableCompanies = (compRes.rows as any[]).map((r) => ({
      company_code: String(r.COMPANY_CODE),
      company_name: String(r.COMPANY_NAME),
    }));
  } catch {
    // If MS_COMPANY is not available, fallback to distinct company from TI_JOB
    try {
      const compRes2 = await connection.execute(
        `SELECT DISTINCT COMPANY_CODE FROM TI_JOB WHERE COMPANY_CODE IS NOT NULL`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      availableCompanies = (compRes2.rows as any[]).map((r) => ({
        company_code: String(r.COMPANY_CODE),
        company_name: String(r.COMPANY_CODE),
      }));
    } catch {}
  }

  try {
    const latestRes = await connection.execute(
      `SELECT NVL(MAX(EXTRACT(MONTH FROM JOB_DATE)), :cur_month) AS LATEST_MONTH
       FROM TI_JOB
       WHERE EXTRACT(YEAR FROM JOB_DATE) = :year
         AND UPPER(COMPANY_CODE) = UPPER(:company_code)`,
      {
        year,
        company_code: companyCode,
        cur_month: new Date().getMonth() + 1,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const m = Number((latestRes.rows as any[])[0]?.LATEST_MONTH);
    if (m >= 1 && m <= 12) latestActiveMonth = m;
  } catch {}

  return { availableYears, availableCompanies, latestActiveMonth };
}

async function runDynamicDashboard(
  connection: Connection,
  companyCode: string,
  _userId: string,
  year: number,
  month: number
) {
  const monthStartStr = `${year}-${String(month).padStart(2, "0")}-01`;
  const yearStartStr = `${year}-01-01`;

  // 1. Summary Metrics
  const summaryRes = await connection.execute(
    `WITH params AS (
       SELECT 
         TO_DATE(:month_start, 'YYYY-MM-DD') AS v_month_start,
         ADD_MONTHS(TO_DATE(:month_start, 'YYYY-MM-DD'), 1) AS v_month_end,
         ADD_MONTHS(TO_DATE(:month_start, 'YYYY-MM-DD'), -1) AS v_prev_start
       FROM DUAL
     )
     SELECT
       (SELECT COUNT(*) FROM TF_ENQUIRY E, params 
        WHERE UPPER(E.COMPANY_CODE) = UPPER(:company_code) 
          AND UPPER(NVL(E.ENQUIRY_TYPE, 'EQI')) IN ('EQI', 'ENQ', 'ENQUIRY') 
          AND E.ENQUIRY_DATE >= params.v_month_start AND E.ENQUIRY_DATE < params.v_month_end) AS ENQUIRIES,
       (SELECT COUNT(*) FROM TF_ENQUIRY E, params 
        WHERE UPPER(E.COMPANY_CODE) = UPPER(:company_code) 
          AND UPPER(NVL(E.ENQUIRY_TYPE, 'EQI')) IN ('EQI', 'ENQ', 'ENQUIRY') 
          AND E.ENQUIRY_DATE >= params.v_prev_start AND E.ENQUIRY_DATE < params.v_month_start) AS PREV_ENQUIRIES,
       (SELECT COUNT(*) FROM TF_ENQUIRY E, params 
        WHERE UPPER(E.COMPANY_CODE) = UPPER(:company_code) 
          AND UPPER(E.ENQUIRY_TYPE) = 'RFQ' 
          AND E.ENQUIRY_DATE >= params.v_month_start AND E.ENQUIRY_DATE < params.v_month_end) AS RFQS,
       (SELECT COUNT(*) FROM TF_ENQUIRY E, params 
        WHERE UPPER(E.COMPANY_CODE) = UPPER(:company_code) 
          AND UPPER(E.ENQUIRY_TYPE) = 'RFQ' 
          AND E.ENQUIRY_DATE >= params.v_prev_start AND E.ENQUIRY_DATE < params.v_month_start) AS PREV_RFQS,
       (SELECT COUNT(*) FROM TF_QUOTATION Q, params 
        WHERE UPPER(Q.COMPANY_CODE) = UPPER(:company_code) 
          AND Q.QUOTATION_DATE >= params.v_month_start AND Q.QUOTATION_DATE < params.v_month_end) AS QUOTATIONS,
       (SELECT COUNT(*) FROM TF_QUOTATION Q, params 
        WHERE UPPER(Q.COMPANY_CODE) = UPPER(:company_code) 
          AND Q.QUOTATION_DATE >= params.v_prev_start AND Q.QUOTATION_DATE < params.v_month_start) AS PREV_QUOTATIONS,
       (SELECT COUNT(*) FROM TI_JOB J, params 
        WHERE UPPER(J.COMPANY_CODE) = UPPER(:company_code) 
          AND J.JOB_DATE >= params.v_month_start AND J.JOB_DATE < params.v_month_end) AS NEW_JOBS,
       (SELECT COUNT(*) FROM TI_JOB J, params 
        WHERE UPPER(J.COMPANY_CODE) = UPPER(:company_code) 
          AND J.JOB_DATE >= params.v_prev_start AND J.JOB_DATE < params.v_month_start) AS PREV_NEW_JOBS,
       (SELECT COUNT(*) FROM TI_JOB J 
        WHERE UPPER(J.COMPANY_CODE) = UPPER(:company_code) 
          AND NVL(J.CANCELED, 'N') <> 'Y' AND J.COMPLETE_DATE IS NULL) AS OPEN_JOBS,
       (SELECT COUNT(*) FROM TI_JOB J, params 
        WHERE UPPER(J.COMPANY_CODE) = UPPER(:company_code) 
          AND NVL(J.CANCELED, 'N') <> 'Y' 
          AND J.COMPLETE_DATE >= params.v_month_start AND J.COMPLETE_DATE < params.v_month_end) AS COMPLETED_JOBS,
       (SELECT COUNT(*) FROM TI_JOB J, params 
        WHERE UPPER(J.COMPANY_CODE) = UPPER(:company_code) 
          AND NVL(J.CANCELED, 'N') <> 'Y' 
          AND J.INVOICE_DATE >= params.v_month_start AND J.INVOICE_DATE < params.v_month_end) AS INVOICED_JOBS,
       (SELECT COUNT(*) FROM TI_JOB J 
        WHERE UPPER(J.COMPANY_CODE) = UPPER(:company_code) 
          AND NVL(J.CANCELED, 'N') <> 'Y' AND J.COMPLETE_DATE IS NULL 
          AND NVL(J.ETA, J.SCHEDULE_DATE) < TRUNC(SYSDATE)) AS OVERDUE_JOBS,
       (SELECT COUNT(*) FROM TI_JOB J, params 
        WHERE UPPER(J.COMPANY_CODE) = UPPER(:company_code) 
          AND J.JOB_DATE >= params.v_month_start AND J.JOB_DATE < params.v_month_end 
          AND UPPER(NVL(J.TRANSPORT_MODE, '-')) IN ('A', 'AIR', 'AIR FREIGHT')) AS AIR_JOBS,
       (SELECT COUNT(*) FROM TI_JOB J, params 
        WHERE UPPER(J.COMPANY_CODE) = UPPER(:company_code) 
          AND J.JOB_DATE >= params.v_month_start AND J.JOB_DATE < params.v_month_end 
          AND UPPER(NVL(J.TRANSPORT_MODE, '-')) IN ('S', 'SEA', 'SEA FREIGHT')) AS SEA_JOBS,
       (SELECT COUNT(*) FROM TI_JOB J, params 
        WHERE UPPER(J.COMPANY_CODE) = UPPER(:company_code) 
          AND J.JOB_DATE >= params.v_month_start AND J.JOB_DATE < params.v_month_end 
          AND UPPER(NVL(J.TRANSPORT_MODE, '-')) IN ('R', 'L', 'ROAD', 'LAND', 'ROAD FREIGHT')) AS ROAD_JOBS,
       (SELECT COUNT(*) FROM TI_JOB J, params 
        WHERE UPPER(J.COMPANY_CODE) = UPPER(:company_code) 
          AND J.JOB_DATE >= params.v_month_start AND J.JOB_DATE < params.v_month_end 
          AND UPPER(NVL(J.TRANSPORT_MODE, '-')) NOT IN ('A', 'AIR', 'AIR FREIGHT', 'S', 'SEA', 'SEA FREIGHT', 'R', 'L', 'ROAD', 'LAND', 'ROAD FREIGHT')) AS OTHER_JOBS
     FROM params`,
    { company_code: companyCode, month_start: monthStartStr },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );

  // 2. 12 Monthly Trends
  const monthlyRes = await connection.execute(
    `WITH months AS (
       SELECT LEVEL AS MONTH_NO, ADD_MONTHS(TO_DATE(:year_start, 'YYYY-MM-DD'), LEVEL - 1) AS MONTH_START
       FROM DUAL CONNECT BY LEVEL <= 12
     )
     SELECT 
       m.MONTH_NO,
       TO_CHAR(m.MONTH_START, 'Mon') AS MONTH_LABEL,
       (SELECT COUNT(*) FROM TI_JOB j 
        WHERE UPPER(j.COMPANY_CODE) = UPPER(:company_code) 
          AND j.JOB_DATE >= m.MONTH_START AND j.JOB_DATE < ADD_MONTHS(m.MONTH_START, 1)) AS JOBS,
       (SELECT COUNT(*) FROM TI_JOB j 
        WHERE UPPER(j.COMPANY_CODE) = UPPER(:company_code) 
          AND j.COMPLETE_DATE >= m.MONTH_START AND j.COMPLETE_DATE < ADD_MONTHS(m.MONTH_START, 1)) AS COMPLETED,
       (SELECT COUNT(*) FROM TF_ENQUIRY e 
        WHERE UPPER(e.COMPANY_CODE) = UPPER(:company_code) 
          AND UPPER(NVL(e.ENQUIRY_TYPE, 'EQI')) IN ('EQI', 'ENQ', 'ENQUIRY') 
          AND e.ENQUIRY_DATE >= m.MONTH_START AND e.ENQUIRY_DATE < ADD_MONTHS(m.MONTH_START, 1)) AS ENQUIRIES,
       (SELECT COUNT(*) FROM TF_ENQUIRY e 
        WHERE UPPER(e.COMPANY_CODE) = UPPER(:company_code) 
          AND UPPER(e.ENQUIRY_TYPE) = 'RFQ' 
          AND e.ENQUIRY_DATE >= m.MONTH_START AND e.ENQUIRY_DATE < ADD_MONTHS(m.MONTH_START, 1)) AS RFQS,
       (SELECT COUNT(*) FROM TF_QUOTATION q 
        WHERE UPPER(q.COMPANY_CODE) = UPPER(:company_code) 
          AND q.QUOTATION_DATE >= m.MONTH_START AND q.QUOTATION_DATE < ADD_MONTHS(m.MONTH_START, 1)) AS QUOTATIONS
     FROM months m
     ORDER BY m.MONTH_NO`,
    { company_code: companyCode, year_start: yearStartStr },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );

  // 3. Top 5 Principals
  const principalsRes = await connection.execute(
    `SELECT * FROM (
       SELECT 
         J.PRIN_CODE,
         NVL(P.PRIN_NAME, J.PRIN_CODE) AS PRIN_NAME,
         COUNT(*) AS JOB_COUNT,
         ROUND(100 * RATIO_TO_REPORT(COUNT(*)) OVER (), 1) AS SHARE_PERCENT
       FROM TI_JOB J
       LEFT JOIN MS_PRINCIPAL P ON P.COMPANY_CODE = J.COMPANY_CODE AND P.PRIN_CODE = J.PRIN_CODE
       WHERE UPPER(J.COMPANY_CODE) = UPPER(:company_code)
         AND J.JOB_DATE >= TO_DATE(:month_start, 'YYYY-MM-DD')
         AND J.JOB_DATE < ADD_MONTHS(TO_DATE(:month_start, 'YYYY-MM-DD'), 1)
       GROUP BY J.PRIN_CODE, NVL(P.PRIN_NAME, J.PRIN_CODE)
       ORDER BY JOB_COUNT DESC, PRIN_NAME
     ) WHERE ROWNUM <= 5`,
    { company_code: companyCode, month_start: monthStartStr },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );

  // 4. Operations Attention
  const attentionRes = await connection.execute(
    `SELECT * FROM (
       SELECT 
         J.JOB_NO AS REFERENCE_NO,
         NVL(P.PRIN_NAME, J.PRIN_CODE) AS PRIN_NAME,
         NVL(J.ETA, J.SCHEDULE_DATE) AS EVENT_DATE,
         NVL(J.PORT_CODE, '-') || ' -> ' || NVL(J.DESTINATION_PORT, '-') AS ROUTE_LABEL,
         CASE WHEN NVL(J.ETA, J.SCHEDULE_DATE) < TRUNC(SYSDATE) THEN 'Overdue' ELSE 'Upcoming' END AS STATUS,
         CASE 
           WHEN UPPER(NVL(J.TRANSPORT_MODE, 'A')) IN ('S', 'SEA', 'SEA FREIGHT') THEN 'sea' 
           WHEN UPPER(NVL(J.TRANSPORT_MODE, 'A')) IN ('R', 'L', 'ROAD', 'LAND', 'ROAD FREIGHT') THEN 'road' 
           ELSE 'air' 
         END AS MODE_CODE
       FROM TI_JOB J
       LEFT JOIN MS_PRINCIPAL P ON P.COMPANY_CODE = J.COMPANY_CODE AND P.PRIN_CODE = J.PRIN_CODE
       WHERE UPPER(J.COMPANY_CODE) = UPPER(:company_code)
         AND NVL(J.CANCELED, 'N') <> 'Y'
         AND J.COMPLETE_DATE IS NULL
         AND NVL(J.ETA, J.SCHEDULE_DATE) IS NOT NULL
         AND NVL(J.ETA, J.SCHEDULE_DATE) < TRUNC(SYSDATE) + 15
       ORDER BY NVL(J.ETA, J.SCHEDULE_DATE), J.JOB_NO
     ) WHERE ROWNUM <= 8`,
    { company_code: companyCode },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );

  // Metadata
  const metadata = await getDashboardMetadata(connection, companyCode, year);

  return {
    summary: (summaryRes.rows as any[])[0] ?? {},
    monthly: monthlyRes.rows ?? [],
    topPrincipals: principalsRes.rows ?? [],
    attention: attentionRes.rows ?? [],
    ...metadata,
  };
}

async function runDynamicWorkspaceSummary(connection: Connection, companyCode: string) {
  const summaryRes = await connection.execute(
    `SELECT
       (SELECT COUNT(*) FROM TI_JOB J 
        WHERE UPPER(J.COMPANY_CODE) = UPPER(:company_code) 
          AND NVL(J.CANCELED, 'N') <> 'Y' AND J.COMPLETE_DATE IS NULL) AS OPEN_JOBS,
       (SELECT COUNT(*) FROM TF_ENQUIRY E 
        WHERE UPPER(E.COMPANY_CODE) = UPPER(:company_code) 
          AND UPPER(NVL(E.ENQUIRY_TYPE, 'EQI')) IN ('EQI', 'ENQ', 'ENQUIRY') 
          AND NVL(E.INDSTATUS, 'N') NOT IN ('A', 'C')) AS PENDING_ENQUIRIES,
       (SELECT COUNT(*) FROM TF_ENQUIRY E 
        WHERE UPPER(E.COMPANY_CODE) = UPPER(:company_code) 
          AND UPPER(E.ENQUIRY_TYPE) = 'RFQ' 
          AND NVL(E.INDSTATUS, 'N') NOT IN ('A', 'C')) AS ACTIVE_RFQ,
       (SELECT COUNT(*) FROM TF_QUOTATION Q 
        WHERE UPPER(Q.COMPANY_CODE) = UPPER(:company_code) 
          AND NVL(Q.INDSTATUS, 'N') NOT IN ('C', 'R')) AS ACTIVE_QUOTATIONS
     FROM DUAL`,
    { company_code: companyCode },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );

  const recentJobsRes = await connection.execute(
    `SELECT * FROM (
       SELECT J.JOB_NO, J.JOB_DATE, J.PRIN_CODE, P.PRIN_NAME, J.TRANSPORT_MODE, J.JOB_TYPE,
              J.PORT_CODE AS ORIGIN_PORT, J.DESTINATION_PORT,
              COALESCE(J.HAWB, J.DOC_REF) AS HOUSE_BL_NO,
              CASE 
                WHEN NVL(J.CANCELED, 'N') = 'Y' THEN 'Cancelled'
                WHEN NVL(J.COMPLETED, 'N') = 'Y' OR J.COMPLETE_DATE IS NOT NULL THEN 'Completed'
                WHEN NVL(J.INVOICED, 'N') = 'Y' OR J.INVOICE_DATE IS NOT NULL THEN 'Invoiced'
                ELSE 'Open'
              END AS STATUS
       FROM TI_JOB J
       LEFT JOIN MS_PRINCIPAL P ON P.COMPANY_CODE = J.COMPANY_CODE AND P.PRIN_CODE = J.PRIN_CODE
       WHERE UPPER(J.COMPANY_CODE) = UPPER(:company_code)
       ORDER BY J.JOB_DATE DESC NULLS LAST, J.JOB_NO DESC
     ) WHERE ROWNUM <= 10`,
    { company_code: companyCode },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );

  return {
    summary: (summaryRes.rows as any[])[0] ?? {},
    recentJobs: recentJobsRes.rows ?? [],
  };
}

async function runDynamicGlobalSearch(connection: Connection, companyCode: string, search: unknown) {
  const term = typeof search === "string" ? search.trim() : null;

  const res = await connection.execute(
    `SELECT * FROM (
       SELECT 'JOB' AS RECORD_TYPE, J.JOB_NO AS RECORD_NO, J.JOB_DATE AS RECORD_DATE,
              J.PRIN_CODE, P.PRIN_NAME, J.DEPT_CODE, J.TRANSPORT_MODE, J.JOB_TYPE,
              J.PORT_CODE AS ORIGIN_PORT, J.DESTINATION_PORT,
              COALESCE(J.HAWB, J.DOC_REF) AS HOUSE_BL_NO,
              J.QUOTATION_REF AS SOURCE_REF,
              CASE 
                WHEN NVL(J.CANCELED, 'N') = 'Y' THEN 'Cancelled'
                WHEN NVL(J.COMPLETED, 'N') = 'Y' OR J.COMPLETE_DATE IS NOT NULL THEN 'Completed'
                WHEN NVL(J.INVOICED, 'N') = 'Y' OR J.INVOICE_DATE IS NOT NULL THEN 'Invoiced'
                ELSE 'Open'
              END AS STATUS,
              CASE 
                WHEN J.TRANSPORT_MODE = 'A' THEN 'freight/freight_air/'
                WHEN J.TRANSPORT_MODE = 'S' THEN 'freight/freight_sea/'
                ELSE 'freight/freight_road/'
              END ||
              CASE 
                WHEN J.JOB_TYPE = 'EXP' THEN 'export'
                WHEN J.JOB_TYPE IN ('IRE', 'REX', 'RE') THEN 'import_ for_reexport'
                ELSE 'import'
              END AS ROUTE_PATH,
              'Freight job / house shipment' AS DESCRIPTION
       FROM TI_JOB J
       LEFT JOIN MS_PRINCIPAL P ON P.COMPANY_CODE = J.COMPANY_CODE AND P.PRIN_CODE = J.PRIN_CODE
       WHERE UPPER(J.COMPANY_CODE) = UPPER(:company_code)
         AND (:search IS NULL OR UPPER(J.JOB_NO || ' ' || NVL(P.PRIN_NAME, '') || ' ' || NVL(J.HAWB, '') || ' ' || NVL(J.DOC_REF, '')) LIKE '%' || UPPER(:search) || '%')

       UNION ALL

       SELECT 'ENQUIRY' AS RECORD_TYPE, E.ENQUIRY_NR AS RECORD_NO, E.ENQUIRY_DATE AS RECORD_DATE,
              E.PRIN_CODE, P.PRIN_NAME, E.DEPT_CODE, E.TRANSPORT_MODE, E.JOB_TYPE,
              E.ORIGIN_PORT, E.DESTINATION_PORT,
              CAST(NULL AS VARCHAR2(50)) AS HOUSE_BL_NO,
              E.REF_ENQUIRY_NR AS SOURCE_REF,
              CASE
                WHEN NVL(E.INDSTATUS, 'N') = 'C' THEN 'Cancelled'
                WHEN NVL(E.INDSTATUS, 'N') = 'A' THEN 'Approved'
                ELSE 'Draft'
              END AS STATUS,
              'freight/request_quote/enquiry' AS ROUTE_PATH,
              'Customer sales enquiry' AS DESCRIPTION
       FROM TF_ENQUIRY E
       LEFT JOIN MS_PRINCIPAL P ON P.COMPANY_CODE = E.COMPANY_CODE AND P.PRIN_CODE = E.PRIN_CODE
       WHERE UPPER(E.COMPANY_CODE) = UPPER(:company_code)
         AND UPPER(NVL(E.ENQUIRY_TYPE, 'EQI')) IN ('EQI', 'ENQ', 'ENQUIRY')
         AND (:search IS NULL OR UPPER(E.ENQUIRY_NR || ' ' || NVL(P.PRIN_NAME, '') || ' ' || NVL(E.COMMODITY, '')) LIKE '%' || UPPER(:search) || '%')

       UNION ALL

       SELECT 'RFQ' AS RECORD_TYPE, E.ENQUIRY_NR AS RECORD_NO, E.ENQUIRY_DATE AS RECORD_DATE,
              E.PRIN_CODE, P.PRIN_NAME, E.DEPT_CODE, E.TRANSPORT_MODE, E.JOB_TYPE,
              E.ORIGIN_PORT, E.DESTINATION_PORT,
              CAST(NULL AS VARCHAR2(50)) AS HOUSE_BL_NO,
              E.REF_ENQUIRY_NR AS SOURCE_REF,
              CASE
                WHEN NVL(E.INDSTATUS, 'N') = 'C' THEN 'Cancelled'
                WHEN NVL(E.INDSTATUS, 'N') = 'A' THEN 'Approved'
                ELSE 'Draft'
              END AS STATUS,
              'freight/request_quote/rfq' AS ROUTE_PATH,
              'Request quote and supplier rates' AS DESCRIPTION
       FROM TF_ENQUIRY E
       LEFT JOIN MS_PRINCIPAL P ON P.COMPANY_CODE = E.COMPANY_CODE AND P.PRIN_CODE = E.PRIN_CODE
       WHERE UPPER(E.COMPANY_CODE) = UPPER(:company_code)
         AND UPPER(E.ENQUIRY_TYPE) = 'RFQ'
         AND (:search IS NULL OR UPPER(E.ENQUIRY_NR || ' ' || NVL(P.PRIN_NAME, '') || ' ' || NVL(E.COMMODITY, '')) LIKE '%' || UPPER(:search) || '%')

       UNION ALL

       SELECT 'QUOTATION' AS RECORD_TYPE, Q.QUOTATION_NR AS RECORD_NO, NVL(Q.QUOTATION_DATE, Q.USER_DATE) AS RECORD_DATE,
              Q.PRIN_CODE, P.PRIN_NAME, Q.DEPT_CODE, Q.TRANSPORT_MODE, Q.JOB_TYPE,
              Q.ORIGIN_PORT, Q.DESTINATION_PORT,
              CAST(NULL AS VARCHAR2(50)) AS HOUSE_BL_NO,
              Q.ENQUIRY_NO AS SOURCE_REF,
              CASE
                WHEN NVL(Q.INDSTATUS, 'N') = 'A' THEN 'Approved'
                WHEN NVL(Q.INDSTATUS, 'N') = 'C' THEN 'Cancelled'
                ELSE 'Draft'
              END AS STATUS,
              'freight/freight_quotation/quotation' AS ROUTE_PATH,
              'Customer selling quotation' AS DESCRIPTION
       FROM TF_QUOTATION Q
       LEFT JOIN MS_PRINCIPAL P ON P.COMPANY_CODE = Q.COMPANY_CODE AND P.PRIN_CODE = Q.PRIN_CODE
       WHERE UPPER(Q.COMPANY_CODE) = UPPER(:company_code)
         AND (:search IS NULL OR UPPER(Q.QUOTATION_NR || ' ' || NVL(P.PRIN_NAME, '') || ' ' || NVL(Q.COMMODITY, '')) LIKE '%' || UPPER(:search) || '%')

       ORDER BY RECORD_DATE DESC NULLS LAST, RECORD_NO DESC
     ) WHERE ROWNUM <= 80`,
    { company_code: companyCode, search: term },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );

  return res.rows ?? [];
}

async function runDynamicJobSearch(connection: Connection, companyCode: string, jobNo: unknown, jobDate: unknown) {
  const term = typeof jobNo === "string" ? jobNo.trim() : null;
  const dateVal = toDate(jobDate);

  const res = await connection.execute(
    `SELECT * FROM (
       SELECT DISTINCT
              j.job_no,
              j.job_date,
              j.prin_code,
              p.prin_name,
              j.transport_mode,
              j.job_type,
              j.container_date AS packlist_date,
              j.confirm_date,
              j.invoice_date,
              CAST(NULL AS VARCHAR2(20)) AS fy_period
         FROM ti_job j
         LEFT JOIN ms_principal p
           ON p.company_code = j.company_code
          AND p.prin_code = j.prin_code
        WHERE UPPER(j.company_code) = UPPER(:company_code)
          AND (
            :search IS NULL
            OR UPPER(j.job_no) LIKE '%' || UPPER(:search) || '%'
            OR UPPER(j.prin_code) LIKE '%' || UPPER(:search) || '%'
            OR UPPER(NVL(p.prin_name, '')) LIKE '%' || UPPER(:search) || '%'
          )
          AND (:job_date IS NULL OR TRUNC(j.job_date) = TRUNC(:job_date))
        ORDER BY j.job_date DESC NULLS LAST, j.job_no DESC
     ) WHERE ROWNUM <= 50`,
    { company_code: companyCode, search: term, job_date: dateVal },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );

  return res.rows ?? [];
}

async function withConnection(res: Response, handler: (connection: Connection) => Promise<void>) {
  let connection: Connection | undefined;
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);
    await handler(connection);
  } catch (error: any) {
    console.error("Freight workspace procedure error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to execute Freight workspace procedure",
      details: error?.message || "Unknown error",
    });
  } finally {
    if (connection) await connection.close();
  }
}

async function rowsFromCursor(cursor: any) {
  if (!cursor) return [];
  try {
    return await cursor.getRows(10000);
  } finally {
    await cursor.close();
  }
}

function toDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
