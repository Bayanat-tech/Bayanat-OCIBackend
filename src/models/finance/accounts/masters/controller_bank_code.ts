import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import TenantManager from "../../../../database/TenantManager";


export const upsertMsAcBankCode = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection: oracledb.Connection | undefined;

  try {
    const rows = Array.isArray(req.body) ? req.body : [];
    let tenantId: string | undefined;

    try {
      tenantId = getCurrentTenantId();
    } catch {
      // tenant may come from body / other context
    }

    // Fallback: resolve tenant from first row if needed
    // Prefer company_code or a user field your TenantManager supports
    if (!tenantId && rows[0]?.company_code) {
      // Optional: map company → tenant if you have such a helper
      // tenantId = await TenantManager.getTenantForCompany(rows[0].company_code);
    }

    if (!tenantId && rows[0]?.user_id) {
      tenantId = await TenantManager.getTenantForUser(rows[0].user_id);
    }

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found",
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const ObjClass = await connection.getDbObjectClass("TR_MS_AC_BANKCODE_OBJ");
    const TabClass = await connection.getDbObjectClass("TR_MS_AC_BANKCODE_TAB");

    const objects = rows.map(
      (row: any) =>
        new ObjClass({
          COMPANY_CODE: row.company_code ?? null,
          AC_CODE: row.ac_code ?? null,
          LAST_CHEQUE_NO: row.last_cheque_no ?? null,
          CHQ_TEMPLATE: row.chq_template ?? null,
          WORDS_LENGTH:
            row.words_length === "" || row.words_length === undefined
              ? null
              : Number(row.words_length),
          BANK_AC_CODE: row.bank_ac_code ?? null,
          BANK_ADDRESS: row.bank_address ?? null,
        })
    );

    const collection = new TabClass(objects);

    await connection.execute(
      `
      BEGIN
        PROC_UPSERT_MS_AC_BANKCODE(:p_data);
      END;
      `,
      {
        p_data: collection,
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Bank code records saved successfully",
    });
  } catch (err: any) {
    console.error(err);

    if (connection) {
      try {
        await connection.rollback();
      } catch {
        // ignore rollback errors
      }
    }

    res.status(500).json({
      success: false,
      message: "Upsert failed",
      details: err.message,
    });
  } finally {
    if (connection) {
      await connection.close().catch(() => {});
    }
  }
};