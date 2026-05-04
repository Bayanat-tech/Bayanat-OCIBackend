import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

// Global setting (optional)
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

export const insUpdHrPayCompDepend = async (req: Request, res: Response): Promise<void> => {
  let connection: oracledb.Connection | undefined;

  try {
    /* ================= INPUT ================= */
    const headers = req.body?.header;
    const details = req.body?.details;

    if (!Array.isArray(headers) || headers.length === 0) {
      res.status(400).json({ success: false, message: "Header must be a non-empty array" });
      return;
    }

    if (!Array.isArray(details)) {
      res.status(400).json({ success: false, message: "Details must be an array" });
      return;
    }

    /* ================= TENANT ================= */
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    /* ================= LOAD ORACLE TYPES ================= */
    // Use schema prefix if required: "WMSTST.HR_PAYCOMP_DEP_TAB_V1"
    const HeaderTypeClass = await connection.getDbObjectClass("HR_PAYCOMP_DEP_TAB_V1");
    const DetailTypeClass = await connection.getDbObjectClass("HR_PAYCOMP_DEP_PARAM_TAB_V1");

    /* ================= MAP HEADER ================= */
    const headerRows = headers.map((h: any) => ({
      COMPANY_CODE: h.company_code ?? null,
      PAY_COMP_ID: h.pay_comp_id ?? null,
      PAY_COMP_ID_DEPEND: h.pay_comp_id_depend ?? null,
      PERCENT: Number(h.percent ?? 0),
      REMARKS: h.remarks ?? null,
      STATUS_FLAG: h.status_flag ?? "A",
      USER_ID: h.user_id ?? null,
      USER_DT: h.user_dt ? new Date(h.user_dt) : new Date(),
      EMPR_PERCENT: Number(h.empr_percent ?? 0)
    }));

    /* ================= MAP DETAILS ================= */
    const detailRows = details.map((d: any) => ({
      COMPANY_CODE: d.company_code ?? null,
      PAY_COMP_ID: d.pay_comp_id ?? null,
      PAY_COMP_ID_DEPEND: d.pay_comp_id_depend ?? null,
      NATIONALITY: d.nationality ?? null,
      AGE: Number(d.age ?? 0),
      STATUS: d.status ?? "A",
      USER_ID: d.user_id ?? null,
      USER_DT: d.user_dt ? new Date(d.user_dt) : new Date(),
      REMARKS: d.remarks ?? null,
      AMT_LIMIT: Number(d.amt_limit ?? 0)
    }));

    /* ================= CREATE ORACLE OBJECTS ================= */
    const headerObj = new HeaderTypeClass(headerRows);
    const detailObj = new DetailTypeClass(detailRows);

    /* ================= BINDS (FIX FOR TS ERROR) ================= */
  const binds: oracledb.BindParameters = {
  p_header: {
    dir: oracledb.BIND_IN,
    val: headerObj   // ✅ ONLY THIS
  },
  p_details: {
    dir: oracledb.BIND_IN,
    val: detailObj   // ✅ ONLY THIS
  }
};
    /* ================= EXECUTE ================= */
    await connection.execute(
      `BEGIN
         PROC_INS_UPD_HR_PAYCOMP_DEP(:p_header, :p_details);
       END;`,
      binds,
      { autoCommit: false }
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "HR Pay Component Dependency saved successfully"
    });

  } catch (err: any) {
    console.error("ERROR:", err);

    if (connection) {
      try {
        await connection.rollback();
      } catch (e) {
        console.error("Rollback failed:", e);
      }
    }

    res.status(500).json({
      success: false,
      message: "Transaction failed",
      error: err?.message || "Unknown error"
    });

  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (e) {
        console.error("Connection close failed:", e);
      }
    }
  }
};