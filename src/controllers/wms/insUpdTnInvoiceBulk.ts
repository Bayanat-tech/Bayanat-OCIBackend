import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import TenantManager from "../../database/TenantManager";

/**
 * Calls PROC_INS_UPD_TN_INVOICE(P_HEADER IN TTE_INVOICE, P_DETAILS IN TTE_INVOICE_DET)
 *
 * NOTE: The procedure REPLACES every TN_INVOICE_DET row for the resolved invoice
 * (DELETE ... then FORALL INSERT), so `details` must be the FULL set of activity
 * billing rows for this invoice/job — not just the edited ones — or you'll wipe
 * out rows that weren't touched this submit.
 */
export const insUpdTnInvoiceBulk = async (
  req: Request,
  res: Response
): Promise<void> => {

  console.log("PROC_INS_UPD_TN_INVOICE called...");
  console.log(req.body);

  console.time("Total API");

  let connection: oracledb.Connection | undefined;

  try {

    const header = req.body?.header;
    const details = req.body?.details || [];

    if (!header || !Array.isArray(details)) {
      res.status(400).json({
        success: false,
        message: "Header and Details are required."
      });
      return;
    }

    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found."
      });
      return;
    }

    console.time("Get Connection");
    connection = await TenantManager.getConnection(tenantId);
    console.timeEnd("Get Connection");

    /******************************************************
     * Header Row - matches TTE_INVOICE attribute order
     ******************************************************/
    console.time("Mapping");
    const headerObj = {
      INVOICE_NO: header.INVOICE_NO || null,
      INVOICE_DATE: header.INVOICE_DATE ? new Date(header.INVOICE_DATE) : null,
      JOB_NO: header.JOB_NO || null,
      INV_TYPE: header.INV_TYPE || null,
      PRIN_CODE: header.PRIN_CODE || null,
      INV_TO: header.INV_TO || null,
      CURR_CODE: header.CURR_CODE || null,
      EX_RATE: Number(header.EX_RATE ?? 1),
      ALLOCATED: header.ALLOCATED || null,
      USER_ID: header.USER_ID || null,
      USER_DT: header.USER_DT ? new Date(header.USER_DT) : null,
      DESPATCHED: header.DESPATCHED || null,
      COMPANY_CODE: header.COMPANY_CODE || null,
      JOB_TYPE: header.JOB_TYPE || null,
      INV_PRINT_COUNT: Number(header.INV_PRINT_COUNT ?? 0),
      INV_PRINTED: header.INV_PRINTED || null,
      INV_GRP_PRINT_COUNT: Number(header.INV_GRP_PRINT_COUNT ?? 0),
      INV_GRP_PRINTED: header.INV_GRP_PRINTED || null,
      FA_UPLOADED: header.FA_UPLOADED || null
    };

    /******************************************************
     * Detail Rows - matches TTE_INVOICE_DET attribute order
     * (INVOICE_NO / COMPANY_CODE / PRIN_CODE are NOT part of
     * this object type - the procedure fills those from the
     * resolved header, not from each detail row)
     ******************************************************/
    const detailRows = details.map((d: any) => ({
      ACT_CODE: d.ACT_CODE ?? null,
      BILL: Number(d.QUANTITY ?? 0) * Number(d.BILL_RATE ?? 0),
      SRNO: Number(d.SRNO ?? 0),
      USER_ID: d.USER_ID ?? header.USER_ID ?? null,
      USER_DT: d.USER_DT ? new Date(d.USER_DT) : null,
      QUANTITY: Number(d.QUANTITY ?? 0),
      BILL_RATE: Number(d.BILL_RATE ?? 0),
      JOB_NO: d.JOB_NO ?? header.JOB_NO ?? null,
      OTHER_SERVICES: d.OTHER_SERVICES ?? null,
      JOB_TYPE: d.JOB_TYPE ?? header.JOB_TYPE ?? null,
      CANCELLED: d.CANCELLED ?? null,
      CONFIRMED: d.CONFIRMED ?? null,
      TXN_DATE: d.TXN_DATE ? new Date(d.TXN_DATE) : null,
      MOC1: d.MOC1 ?? null,
      TX_CAT_CODE: d.TX_CAT_CODE ?? null,
      TX_CAT_CODE_COST: d.TX_CAT_CODE_COST ?? null,
      TX_COMPNTCAT_CODE_1: d.TX_COMPNTCAT_CODE_1 ?? null,
      TX_COMPNTCAT_CODE_2: d.TX_COMPNTCAT_CODE_2 ?? null,
      TX_COMPNTCAT_CODE_3: d.TX_COMPNTCAT_CODE_3 ?? null,
      TX_COMPNTCAT_CODE_4: d.TX_COMPNTCAT_CODE_4 ?? null,
      TX_COMPNT_PERC_1: Number(d.TX_COMPNT_PERC_1 ?? 0),
      TX_COMPNT_PERC_2: Number(d.TX_COMPNT_PERC_2 ?? 0),
      TX_COMPNT_PERC_3: Number(d.TX_COMPNT_PERC_3 ?? 0),
      TX_COMPNT_PERC_4: Number(d.TX_COMPNT_PERC_4 ?? 0),
      TX_COMPNT_AMT_2: Number(d.TX_COMPNT_AMT_2 ?? 0),
      TX_COMPNT_AMT_3: Number(d.TX_COMPNT_AMT_3 ?? 0),
      TX_COMPNT_AMT_4: Number(d.TX_COMPNT_AMT_4 ?? 0),
      TX_COMPNT_LCURAMT_2: Number(d.TX_COMPNT_LCURAMT_2 ?? 0),
      TX_COMPNT_LCURAMT_3: Number(d.TX_COMPNT_LCURAMT_3 ?? 0),
      TX_COMPNT_LCURAMT_4: Number(d.TX_COMPNT_LCURAMT_4 ?? 0),
      TX_COMPNT_1_EXPMT: d.TX_COMPNT_1_EXPMT ?? null,
      TX_COMPNT_2_EXPMT: d.TX_COMPNT_2_EXPMT ?? null,
      TX_COMPNT_3_EXPMT: d.TX_COMPNT_3_EXPMT ?? null,
      TX_COMPNT_4_EXPMT: d.TX_COMPNT_4_EXPMT ?? null,
      TX_COMPNTCAT_CODE_1_COST: d.TX_COMPNTCAT_CODE_1_COST ?? null,
      TX_COMPNTCAT_CODE_2_COST: d.TX_COMPNTCAT_CODE_2_COST ?? null,
      TX_COMPNTCAT_CODE_3_COST: d.TX_COMPNTCAT_CODE_3_COST ?? null,
      TX_COMPNTCAT_CODE_4_COST: d.TX_COMPNTCAT_CODE_4_COST ?? null,
      TX_COMPNT_PERC_1_COST: Number(d.TX_COMPNT_PERC_1_COST ?? 0),
      TX_COMPNT_PERC_2_COST: Number(d.TX_COMPNT_PERC_2_COST ?? 0),
      TX_COMPNT_PERC_3_COST: Number(d.TX_COMPNT_PERC_3_COST ?? 0),
      TX_COMPNT_PERC_4_COST: Number(d.TX_COMPNT_PERC_4_COST ?? 0),
      // TODO: confirm mapping - old raw-SQL wrote COST_RATE/COST which have
      // no direct equivalent in this procedure's insert list. Leaving these
      // at 0 until confirmed which TX_COMPNT_*_COST field (if any) it maps to.
      TX_COMPNT_AMT_1_COST: Number(d.TX_COMPNT_AMT_1_COST ?? 0),
      TX_COMPNT_AMT_2_COST: Number(d.TX_COMPNT_AMT_2_COST ?? 0),
      TX_COMPNT_AMT_3_COST: Number(d.TX_COMPNT_AMT_3_COST ?? 0),
      TX_COMPNT_AMT_4_COST: Number(d.TX_COMPNT_AMT_4_COST ?? 0),
      TX_COMPNT_LCURAMT_1_COST: Number(d.TX_COMPNT_LCURAMT_1_COST ?? 0),
      TX_COMPNT_LCURAMT_2_COST: Number(d.TX_COMPNT_LCURAMT_2_COST ?? 0),
      TX_COMPNT_LCURAMT_3_COST: Number(d.TX_COMPNT_LCURAMT_3_COST ?? 0),
      TX_COMPNT_LCURAMT_4_COST: Number(d.TX_COMPNT_LCURAMT_4_COST ?? 0),
      TX_COMPNT_1_EXPMT_COST: d.TX_COMPNT_1_EXPMT_COST ?? null,
      TX_COMPNT_2_EXPMT_COST: d.TX_COMPNT_2_EXPMT_COST ?? null,
      TX_COMPNT_3_EXPMT_COST: d.TX_COMPNT_3_EXPMT_COST ?? null,
      TX_COMPNT_4_EXPMT_COST: d.TX_COMPNT_4_EXPMT_COST ?? null,
      TX_COMPNT_LCURAMT_1: Number(d.TX_COMPNT_LCURAMT_1 ?? 0),
      TX_COMPNT_AMT_1: Number(d.TX_COMPNT_AMT_1 ?? 0),
      GROSS_WT: Number(d.GROSS_WT ?? 0),
      COST_RATE: Number(d.COST_RATE ?? 0),
    }));
    console.timeEnd("Mapping");

    /******************************************************
     * Execute Oracle Procedure
     ******************************************************/
    console.time("Oracle Execute");
    await connection.execute(
      `
      BEGIN
          PROC_INS_UPD_TN_INVOICE(
              :p_header,
              :p_details
          );
      END;
      `,
      {
        p_header: {
          type: "BTSCMPRD.TTE_INVOICE",
          val: [headerObj]
        },
        p_details: {
          type: "BTSCMPRD.TTE_INVOICE_DET",
          val: detailRows
        }
      },
      {
        autoCommit: false
      }
    );
    console.timeEnd("Oracle Execute");

    /******************************************************
     * Commit
     * NOTE: the procedure itself already COMMITs internally
     * and RAISE_APPLICATION_ERROR's (which ROLLBACKs) on
     * failure, so this second commit is effectively a no-op
     * safety net rather than the thing making the write durable.
     ******************************************************/
    console.time("Commit");
    await connection.commit();
    console.timeEnd("Commit");

    console.time("JSON Response");
    res.json({
      success: true,
      message: "Activity billing updated successfully."
    });
    console.timeEnd("JSON Response");

  } catch (error: any) {
    console.error("PROC_INS_UPD_TN_INVOICE Error:", error);

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback Error:", rollbackError);
      }
    }

    res.status(500).json({
      success: false,
      message: error.message || "Error while saving activity billing."
    });
  } finally {
    console.timeEnd("Total API");

    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error("Connection close error:", closeError);
      }
    }
  }
};