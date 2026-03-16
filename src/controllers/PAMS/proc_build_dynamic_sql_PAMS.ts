import { Request, Response } from "express";
import { QueryExecutor } from "../../database/QueryExecutor";
import oracledb from "oracledb";

export const proc_build_dynamic_sql_PAMS = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      parameter,
      loginid,
      code1,
      code2,
      code3,
      code4,
      number1,
      number2,
      number3,
      number4,
      date1,
      date2,
      date3,
      date4
    } = req.body;

    console.log('check dynamic sql', req.body);

    if (!parameter) {
      res.status(400).json({ error: "Missing required parameter 'parameter'" });
      return;
    }

    // Call the procedure correctly with OUT bind (Tenant-Aware)
    const result = await QueryExecutor.executeRawQuery(
      `
      BEGIN
        PROC_BUILD_DYNAMIC_SQL_PAMS(
          :parameter,
          :loginid,
          :code1,
          :code2,
          :code3,
          :code4,
          :number1,
          :number2,
          :number3,
          :number4,
          :date1,
          :date2,
          :date3,
          :date4,
          :out_sql
        );
      END;
      `,
      {
        parameter,
        loginid,
        code1,
        code2,
        code3,
        code4,
        number1,
        number2,
        number3,
        number4,
        date1: date1 || null,
        date2: date2 || null,
        date3: date3 || null,
        date4: date4 || null,
        out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 }
      }
    );

    interface ProcOutBinds {
      out_sql: string;
    }

    const outBinds = result.outBinds as ProcOutBinds;
    const rawSql = outBinds?.out_sql;

    if (!rawSql) {
      res.status(500).json({ error: "Procedure did not return SQL" });
      return;
    }

    console.log("Generated SQL:", rawSql);

    let tableData: any[] = [];
    let message: string | undefined;

    // Execute SELECT statements dynamically
    if (/^\s*(SELECT|WITH)/i.test(rawSql))  {
      const dataResult = await QueryExecutor.executeRawQuery(rawSql, []);

      console.log("=== RAW ROWS ===", JSON.stringify(dataResult.rows?.[0]));
      console.log("=== METADATA ===", JSON.stringify(dataResult.metaData));
      console.log("=== ROW TYPE ===", typeof dataResult.rows?.[0], Array.isArray(dataResult.rows?.[0]));

      // tableData = dataResult.rows?.map((row: any) => {
      //   const obj: Record<string, any> = {};
      //   dataResult.metaData?.forEach((col: any, i: number) => {
      //     obj[col.name.toLowerCase()] = row[i];
      //   });
      //   return obj;
      // }) || [];
      tableData = dataResult.rows ?? [];
    } else {
      // For UPDATE/INSERT/DELETE statements or messages
      message = rawSql;
    }

    res.json({
      success: true,
      message,
      data: tableData,
      totalCount: tableData.length
    });

  } catch (error: any) {
    console.error("Oracle Error:", error);
    res.status(500).json({ error: "Failed to execute SQL", details: error.message });
  }
};
