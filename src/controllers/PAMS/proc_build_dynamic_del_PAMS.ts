import { Request, Response } from "express";
import { QueryExecutor } from "../../database/QueryExecutor";
import oracledb from "oracledb";

export const proc_build_dynamic_del_PAMS = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      parameter,
      loginid,
      code1,
      code2,
      code3,
      code4,
      code5,
      number1,
      number2,
      number3,
      number4,
      date1,
      date2,
      date3,
      date4
    } = req.body;

    console.log('Check dynamic delete request:', req.body);

    if (!parameter) {
      res.status(400).json({ success: false, message: "Missing required parameter 'parameter'" });
      return;
    }

    // Call procedure to get dynamic SQL (Tenant-Aware)
    const result = await QueryExecutor.executeRawQuery(
      `
      DECLARE
        v_sql VARCHAR2(32767);
      BEGIN
        PROC_BUILD_DYNAMIC_DEL_PAMS(
          :parameter,
          :loginid,
          :code1,
          :code2,
          :code3,
          :code4,
          :code5,
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
        loginid,
        code1,
        code2,
        code3,
        code4,
        code5,
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

    console.log("Generated DELETE SQL:", rawSql);

    try {
      // Execute the DELETE SQL (Tenant-Aware)
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
