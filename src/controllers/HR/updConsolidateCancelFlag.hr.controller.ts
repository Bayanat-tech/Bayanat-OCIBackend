
import { Request, Response } from "express";
import oracledb from "oracledb";

import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";

const toNumber = (val: any): number | null => {
  if (val === undefined || val === null || val === "") return null;

  const n = Number(val);
  return Number.isNaN(n) ? null : n;
};

export const updateConsolidateCancelFlag = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection: oracledb.Connection | undefined;

  try {
    const data = req.body;

    // Multiple records are expected in data.records
    const records = data?.records;

    if (!Array.isArray(records) || records.length === 0) {
      res.status(400).json({
        success: false,
        message: "At least one record is required in records"
      });
      return;
    }

    // Resolve tenant
    let tenantId: string | undefined;

    try {
      tenantId = getCurrentTenantId();
    } catch {}

    if (!tenantId && data?.loginid) {
      tenantId = await TenantManager.getTenantForUser(data.loginid);
    }

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    // Get Oracle object classes (NO schema prefix)
    const CancelRecObjClass = await connection.getDbObjectClass(
      "TY_CONSOLIDATE_CANCEL_REC"
    );

    const CancelTabObjClass = await connection.getDbObjectClass(
      "TY_CONSOLIDATE_CANCEL_TAB"
    );

    // Validate and create Oracle record objects
    const objectRecords = records.map((record: any, index: number) => {
      if (
        !record.company_code &&
        !data.company_code
      ) {
        throw new Error(
          `company_code is required for record ${index + 1}`
        );
      }

      if (
        !record.doc_type ||
        record.doc_no === undefined ||
        record.doc_no === null ||
        record.doc_no === "" ||
        !record.pay_comp_id ||
        record.serial_no === undefined ||
        record.serial_no === null ||
        record.serial_no === "" ||
        !record.updated_by ||
        record.cancel_status === undefined ||
        record.cancel_status === null
      ) {
        throw new Error(
          `DOC_TYPE, DOC_NO, PAY_COMP_ID, SERIAL_NO, UPDATED_BY and CANCEL_STATUS are required for record ${index + 1}`
        );
      }

      return new CancelRecObjClass({
        COMPANY_CODE: record.company_code || data.company_code,
        DOC_TYPE: record.doc_type,
        DOC_NO: toNumber(record.doc_no),
        PAY_COMP_ID: record.pay_comp_id,
        SERIAL_NO: toNumber(record.serial_no),
        UPDATED_BY: record.updated_by,
        CANCEL_STATUS: record.cancel_status
      });
    });

    // Create Oracle collection containing multiple records
    const obj: any = new CancelTabObjClass(objectRecords);

    // Call procedure (NO schema prefix)
    // Call procedure (NO schema prefix)
    const binds: oracledb.BindParameters = {
      p_records: {
        dir: oracledb.BIND_IN,
        type: CancelTabObjClass as any,
        val: obj,
      },
    };

    await connection.execute(
      `BEGIN
         PROC_UPDATE_CONSOLIDATE_CANCEL_FLAG(:p_records);
       END;`,
      binds
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Cancel flag updated successfully",
      total_records_received: records.length
    });

  } catch (err: any) {
    if (connection) {
      await connection.rollback().catch(() => {});
    }

    console.error("Oracle error:", err);

    res.status(500).json({
      success: false,
      message: "Failed to update consolidate cancel flag",
      details: err.message
    });

  } finally {
    if (connection) {
      await connection.close().catch(() => {});
    }
  }
};
