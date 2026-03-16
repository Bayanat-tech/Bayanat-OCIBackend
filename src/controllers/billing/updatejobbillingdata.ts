// controllers/invoiceController.ts
import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";

export type TInvoiceDetUpd = {
  company_code: string;
  prin_code: string;
  job_no: string;
  srno: number;
  act_code: string;
  bill?: number;
  cost?: number;
  bill_rate?: number;
  cost_rate?: number;
};

const getNumber = (val: any) => (typeof val === "number" ? val : val ? Number(val) : null);

export async function updatejobbillingdata(req: Request, res: Response): Promise<void> {
  let connection: oracledb.Connection | undefined;
  try {
    if (!Array.isArray(req.body.rows) || req.body.rows.length === 0) {
      res.status(400).json({ error: "rows array is required" });
      return;
    }

    let tenantId = getCurrentTenantId();
    if (!tenantId) {
      console.warn("[updatejobbillingdata] Tenant context not available, resolving from user...");
      const loginid = (req as any).user?.loginid || (req as any).loginid;
      if (!loginid) {
        throw new Error("[updatejobbillingdata] Cannot determine user loginid");
      }
      tenantId = await TenantManager.getTenantForUser(loginid);
    }
    if (!tenantId) {
      throw new Error("[updatejobbillingdata] Unable to determine tenant database");
    }

    connection = await TenantManager.getConnection(tenantId);

    const detailRows = req.body.rows.map((r: TInvoiceDetUpd) => ({
      COMPANY_CODE: r.company_code,
      PRIN_CODE: r.prin_code,
      JOB_NO: r.job_no,
      SRNO: r.srno,
      ACT_CODE: r.act_code,
      BILL: getNumber(r.bill),
      COST: getNumber(r.cost),
      BILL_RATE: getNumber(r.bill_rate),
      COST_RATE: getNumber(r.cost_rate),
    }));

    await connection.execute(
      `
      BEGIN
        PROC_UPDATE_JOBBILING_DATA(:p_invoice_dtl);
      END;
      `,
      {
        p_invoice_dtl: {
          dir: oracledb.BIND_IN,
          type: "T_INVOICE_DET_TAB" as any,
          val: detailRows,
        },
      } as any
    );

    res.status(200).json({ message: "Invoice updated successfully" });
  } catch (err) {
    console.error("Error updating invoice:", err);
    res.status(500).json({ error: "Update failed" });
  } finally {
    if (connection) {
      try { await connection.close(); } catch {}
    }
  }
}
