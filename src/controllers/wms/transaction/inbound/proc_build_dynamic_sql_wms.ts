import { oracleDb } from "./../../../../../src/database/connection";
export const proc_build_dynamic_sql = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
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
    } = req.body;

    if (!parameter) {
      res.status(400).json({ error: "Missing required parameter 'parameter'" });
      return;
    }

    // 1️⃣ Build PL/SQL block (uses a RETURNED OUT bind through your wrapper)
    const plsql = `
      DECLARE
        v_raw_sql VARCHAR2(4000);
      BEGIN
        PROC_BUILD_DYNAMIC_SQL(
          :parameter,
          :code1,
          :code2,
          :code3,
          :number1,
          :number2,
          :number3,
          :number4,
          :date1,
          :date2,
          :date3,
          :date4,
          v_raw_sql
        );
        :out_sql := v_raw_sql;
      END;
    `;

    // 2️⃣ Execute the stored procedure using your wrapper
    const procResult = await oracleDb.query(plsql, {
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
      out_sql: { dir: "OUT", type: "STRING", maxSize: 4000 }, // <- works because your wrapper handles this
    });

    const rawSql =
      procResult?.outBinds?.out_sql ||
      procResult?.rows?.out_sql ||
      procResult?.out_sql;

    if (!rawSql) {
      res.status(500).json({ error: "Procedure did not return SQL" });
      return;
    }

    console.log("Generated SQL:", rawSql);

    // 3️⃣ Execute the returned dynamic SQL
    const execResult = await oracleDb.query(rawSql);

    const rows = execResult.rows || execResult;

    // 4️⃣ Format dates (same logic used in executeRawSql)
    const formattedRows = Array.isArray(rows)
      ? rows.map((row) => formatResultDates(row))
      : rows;

    res.json({
      success: true,
      data: formattedRows,
      totalCount: Array.isArray(formattedRows) ? formattedRows.length : 0,
    });
  } catch (error: any) {
    console.error("SQL Execution Error:", error);
    res.status(500).json({
      error: "Failed to execute SQL",
      details: error.message,
    });
  }
};