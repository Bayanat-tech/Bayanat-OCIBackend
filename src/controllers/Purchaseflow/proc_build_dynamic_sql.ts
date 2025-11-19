import { Request, Response } from "express";
import oracledb from "oracledb";
import { oracleDb } from "../../database/connection";   // keep if needed for pool

export const proc_build_dynamic_sql = async (req: Request, res: Response): Promise<void> => {
  let connection;

  try {
    const {
      parameter,
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

    if (!parameter) {
      res.status(400).json({ error: "Missing required parameter 'parameter'" });
      return;
    }

    // 🔥 Get Oracle connection directly
    connection = await oracledb.getConnection();

    // 1️⃣ Call PL/SQL procedure
    const result = await connection.execute(
      `
      DECLARE
        v_sql VARCHAR2(4000);
      BEGIN
        PROC_BUILD_DYNAMIC_SQL(
          :parameter,
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
          v_sql
        );
        :out_sql := v_sql;
      END;
      `,
      {
        parameter,
        code1,
        code2,
        code3,
        number1,
        number2,
        number3,
        number4,
        date1,
        date2,
        date3,
        date4,
        out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
      }
    );

const outBinds = result.outBinds as { out_sql: string };
const rawSql = outBinds?.out_sql;

    if (!rawSql) {
      res.status(500).json({ error: "Procedure did not return SQL" });
      return;
    }

    console.log("Generated SQL:", rawSql);

    // 2️⃣ Execute dynamic SQL
    const queryResult = await connection.execute(rawSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    });

    res.json({
      success: true,
      data: queryResult.rows || [],
      totalCount: queryResult.rows?.length || 0
    });

  } catch (error: any) {
    console.error("Oracle Error:", error);
    res.status(500).json({ error: "Failed to execute SQL", details: error.message });

  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error("Failed to close connection:", closeErr);
      }
    }
  }
};
