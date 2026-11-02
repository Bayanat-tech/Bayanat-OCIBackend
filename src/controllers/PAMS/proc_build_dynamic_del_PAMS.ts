import { Response } from "express";
import { QueryExecutor } from "../../database/QueryExecutor";
import { RequestWithUser } from "../../interfaces/common.interface";
import oracledb from "oracledb";
import { getPamsLoginId, getPamsTenantSchema, validatePamsGeneratedSql } from "./pamsTenantSafety";

export const proc_build_dynamic_del_PAMS = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const {
      parameter,
      loginid,
      code1,
      code2,
      code3,
      code4,
      code5,
      code6,
      code7,
      number1,
      number2,
      number3,
      number4,
      date1,
      date2,
      date3,
      date4
    } = req.body;

    if (!parameter) {
      res.status(400).json({ success: false, message: "Missing required parameter 'parameter'" });
      return;
    }

    const tenantSchema = await getPamsTenantSchema();

    // Call procedure to get dynamic SQL (Tenant-Aware)
    const result = await QueryExecutor.executeRawQuery(
      `
      DECLARE
        v_sql VARCHAR2(32767);
      BEGIN
        ${tenantSchema}.PROC_BUILD_DYNAMIC_DEL_PAMS(
          :parameter,
          :loginid,
          :code1,
          :code2,
          :code3,
          :code4,
          :code5,
          :code6,         
          :code7,
          :number1,
          :number2,
          :number3,
          :number4,
          :date1,
          :date2,
          :date3,
          :date4,
          v_sql
        );
        :out_sql := v_sql;
      END;
      `,
      {
        parameter,
        loginid: getPamsLoginId(req),
        code1,
        code2,
        code3,
        code4,
        code5,
        code6,
        code7,
        number1,
        number2,
        number3,
        number4,
        date1,
        date2,
        date3,
        date4,
        out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 }
      }
    );

    // TypeScript typing for out binds
    interface ProcOutBinds {
      out_sql: string | null;
    }

    const outBinds = result.outBinds as ProcOutBinds;
    const rawSql = outBinds?.out_sql;

    if (!rawSql) {
      res.status(400).json({ success: false, message: "Invalid delete parameter or procedure returned nothing" });
      return;
    }

    try {
      // Execute the DELETE SQL (Tenant-Aware)
      validatePamsGeneratedSql(rawSql, "delete");
      await QueryExecutor.executeRawQuery(rawSql, []);

      res.json({
        success: true,
        message: "Record Deleted Successfully"
      });
    } catch (deleteError: any) {
      console.error("Failed to execute DELETE SQL:", deleteError);
      res.status(500).json({
        success: false,
        message: "Record not deleted successfully",
        details: deleteError.message
      });
    }

  } catch (error: any) {
    console.error("Oracle Error:", error);
    res.status(500).json({ success: false, message: "Failed to execute procedure", details: error.message });
  }
};
