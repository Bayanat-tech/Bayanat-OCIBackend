import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

type DocAccodeRow = {
  company_code?: string;
  doc_id?: string;
  hdr_dtl?: string;
  ac_code?: string;
  div_code?: string;
};

async function resolveL4Code(
  connection: oracledb.Connection,
  companyCode: string,
  accountCode: string
) {
  try {
    const result = await connection.execute<{ L4_CODE: string }>(
      `
        SELECT
          COALESCE(
            MAX(CASE WHEN UPPER(TRIM(COMPANY_CODE)) = UPPER(TRIM(:companyCode)) AND AC_CODE = :accountCode THEN L4_CODE END),
            MAX(CASE WHEN AC_CODE = :accountCode THEN L4_CODE END),
            MAX(CASE WHEN L4_CODE = :accountCode THEN L4_CODE END)
          ) AS L4_CODE
        FROM MS_ACCODES
        WHERE (UPPER(TRIM(COMPANY_CODE)) = UPPER(TRIM(:companyCode)) OR :companyCode IS NULL)
          AND (AC_CODE = :accountCode OR L4_CODE = :accountCode)
      `,
      { companyCode, accountCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    return result.rows?.[0]?.L4_CODE || accountCode;
  } catch (_) {
    return accountCode;
  }
}

export const delDocAccodeBulk = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection: oracledb.Connection | undefined;

  try {
    const rows = req.body?.rows;
    const loginId = req.body?.loginId;

    if (!Array.isArray(rows) || !loginId) {
      res.status(400).json({
        success: false,
        message: "rows and loginId required"
      });
      return;
    }

    let tenantId = getCurrentTenantId();
    if (!tenantId && loginId) {
      tenantId = await TenantManager.getTenantForUser(loginId);
    }

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);
    let deleted = 0;

    for (const row of rows as DocAccodeRow[]) {
      const companyCode = String(row.company_code || "").trim();
      const docId = String(row.doc_id || "").trim();
      const hdrDtl = String(row.hdr_dtl || "").trim().toUpperCase().slice(0, 1);
      const accountCode = String(row.ac_code || "").trim();
      const divCode = String(row.div_code || "").trim() || null;

      if (!companyCode || !docId || !hdrDtl || !accountCode) {
        throw new Error("company_code, doc_id, hdr_dtl and ac_code are required for every row");
      }

      // 1. Try deleting by exact account code first
      let result = await connection.execute(
        `
          DELETE FROM MS_AC_SETUP_DOC_ACCODE
          WHERE UPPER(TRIM(COMPANY_CODE)) = UPPER(TRIM(:companyCode))
            AND DOC_ID = :docId
            AND HDR_DTL = :hdrDtl
            AND AC_CODE = :accountCode
            AND (:divCode IS NULL OR DIV_CODE = :divCode OR NVL(DIV_CODE, 'X') = NVL(:divCode, 'X'))
        `,
        { companyCode, docId, hdrDtl, accountCode, divCode }
      );

      // 2. Fallback to resolved L4_CODE if exact match deleted 0 rows (e.g., if saved as L4 group)
      if ((result.rowsAffected || 0) === 0) {
        const l4Code = await resolveL4Code(connection, companyCode, accountCode);
        if (l4Code && l4Code !== accountCode) {
          result = await connection.execute(
            `
              DELETE FROM MS_AC_SETUP_DOC_ACCODE
              WHERE UPPER(TRIM(COMPANY_CODE)) = UPPER(TRIM(:companyCode))
                AND DOC_ID = :docId
                AND HDR_DTL = :hdrDtl
                AND AC_CODE = :l4Code
                AND (:divCode IS NULL OR DIV_CODE = :divCode OR NVL(DIV_CODE, 'X') = NVL(:divCode, 'X'))
            `,
            { companyCode, docId, hdrDtl, l4Code, divCode }
          );
        }
      }

      deleted += result.rowsAffected || 0;
    }

    await connection.commit();

    res.json({
      success: true,
      message: deleted ? "Document account mapping deleted" : "No matching document account mapping found",
      deleted
    });
  } catch (err: any) {
    console.error("Oracle Error:", err);

    if (connection) await connection.rollback();

    res.status(500).json({
      success: false,
      message: "Delete failed",
      details: err?.message || "Unknown error"
    });
  } finally {
    if (connection) await connection.close();
  }
};
