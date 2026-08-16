import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";

// --------------------------------------------------------------------
// PROC_INS_UPD_MS_HR_SEC_PAYCOMP_AC now:
//   1. Validates the whole collection
//   2. Deletes ALL rows for the shared scope (company/div/dept/section + PAY_COMP_TYPE='A')
//   3. Inserts every element of P_PAYCOMP_AC
//   4. COMMITs once
//
// Frontend therefore sends the FULL grid as an array under paycomp_ac.
// --------------------------------------------------------------------

type TPaycompAcRow = {
  company_code: string;
  div_code: string;
  dept_code: string;
  section_code: string;
  pay_comp_id: string;
  ac_code_db?: string | null;
  ac_code_cr?: string | null;
  exp_type_code?: string | null;
  exp_subtype_code?: string | null;
  pay_comp_type?: string | null;
  pay_comp_earn_ded?: string | null;
  sepn_flag?: "Y" | "N" | null;
  remarks?: string | null;
  user_id?: string | null;
  user_dt?: string | null;
};

export const insUpdAccrualAcctSetup = async (
  req: Request,
  res: Response
): Promise<void> => {
  console.log("insUpdAccrualAcctSetup called-------------");
  console.log("req.body:------------------", req.body);

  let connection: oracledb.Connection | undefined;

  try {
    // Accept either:
    //   { paycomp_ac: [ {...}, {...} ] }   ← preferred (array of objects)
    //   { paycomp_ac: { ... } }           ← single object (back-compat)
    //   or the body itself being the array
    const raw =
      req.body?.paycomp_ac !== undefined
        ? req.body.paycomp_ac
        : Array.isArray(req.body)
          ? req.body
          : null;

    if (raw == null) {
      res.status(400).json({
        success: false,
        message: "Pay component accounting data is required (paycomp_ac array)",
      });
      return;
    }

    const paycompAcRows: TPaycompAcRow[] = Array.isArray(raw) ? raw : [raw];

    if (paycompAcRows.length === 0) {
      res.status(400).json({
        success: false,
        message: "At least one pay component accounting record is required",
      });
      return;
    }

    // --------------------------------------------------
    // Resolve Tenant
    // --------------------------------------------------
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found",
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    // --------------------------------------------------
    // Validate mandatory fields per row (mirrors proc)
    // --------------------------------------------------
    for (let i = 0; i < paycompAcRows.length; i++) {
      const row = paycompAcRows[i];
      const rowLabel = `record ${i + 1}`;

      if (!row.company_code) {
        res.status(400).json({ success: false, message: `COMPANY_CODE is required at ${rowLabel}` });
        return;
      }
      if (!row.div_code) {
        res.status(400).json({ success: false, message: `DIV_CODE is required at ${rowLabel}` });
        return;
      }
      if (!row.dept_code) {
        res.status(400).json({ success: false, message: `DEPT_CODE is required at ${rowLabel}` });
        return;
      }
      if (!row.section_code) {
        res.status(400).json({ success: false, message: `SECTION_CODE is required at ${rowLabel}` });
        return;
      }
      if (!row.pay_comp_id) {
        res.status(400).json({ success: false, message: `PAY_COMP_ID is required at ${rowLabel}` });
        return;
      }
    }

    // --------------------------------------------------
    // Build PL/SQL collection binding
    // --------------------------------------------------
    const bindRows = paycompAcRows.map((row) => ({
      COMPANY_CODE: row.company_code,
      DIV_CODE: row.div_code,
      DEPT_CODE: row.dept_code,
      SECTION_CODE: row.section_code,
      PAY_COMP_ID: row.pay_comp_id,
      AC_CODE_DB: row.ac_code_db ?? null,
      USER_ID: row.user_id ?? null,
      USER_DT: row.user_dt ? new Date(row.user_dt) : null,
      REMARKS: row.remarks ?? null,
      AC_CODE_CR: row.ac_code_cr ?? null,
      EXP_TYPE_CODE: row.exp_type_code ?? null,
      EXP_SUBTYPE_CODE: row.exp_subtype_code ?? null,
      PAY_COMP_TYPE: row.pay_comp_type ?? "A",
      PAY_COMP_EARN_DED: row.pay_comp_earn_ded ?? null,
      SEPN_FLAG: row.sepn_flag ?? "N",
    }));

    // --------------------------------------------------
    // Single call – procedure deletes scope then inserts all
    // --------------------------------------------------
    await connection.execute(
      `
      BEGIN
        WMSTST.PROC_INS_UPD_MS_HR_SEC_PAYCOMP_AC(
          :p_paycomp_ac
        );
      END;
      `,
      {
        p_paycomp_ac: {
          type: "WMSTST.MS_HR_SEC_PAYCOMP_AC_TAB",
          val: bindRows,
        },
      },
      { autoCommit: false }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "HR section pay component accounting saved successfully",
      data: {
        rows_saved: bindRows.length,
        rows: paycompAcRows.map((row) => ({
          company_code: row.company_code,
          div_code: row.div_code,
          dept_code: row.dept_code,
          section_code: row.section_code,
          pay_comp_id: row.pay_comp_id,
          sepn_flag: row.sepn_flag ?? "N",
        })),
      },
    });
  } catch (err: any) {
    console.error("MS_HR_SEC_PAYCOMP_AC Oracle Error:", err);

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback Error:", rollbackError);
      }
    }

    res.status(500).json({
      success: false,
      message: "HR section pay component accounting save failed",
      details: err?.message || "Unknown error",
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error("Connection Close Error:", closeError);
      }
    }
  }
};