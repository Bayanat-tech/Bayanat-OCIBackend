import { QueryExecutor } from "../../database/QueryExecutor";
import { Request, Response } from "express";

function formatResultDates(row: any): any {
  if (!row || typeof row !== "object") return row;

  const formattedRow = { ...row };
  for (const [key, value] of Object.entries(formattedRow)) {
    if (!key.includes("DATE") || !value) continue;

    try {
      const date = value instanceof Date ? value : typeof value === "string" && value.includes("T") ? new Date(value) : null;
      if (!date || Number.isNaN(date.getTime())) continue;

      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const year = date.getFullYear();
      formattedRow[key] = `${day}-${month}-${year}`;
    } catch (error) {
      console.error(`Error formatting ${key}:`, error);
    }
  }

  return formattedRow;
}

export const executeRawSql = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    let rawSql: string = req.body?.raw_sql || req.body?.sql || req.query?.sql;

    if (!rawSql || typeof rawSql !== "string") {
      res.status(400).json({ success: false, error: "Missing or invalid raw SQL string" });
      return;
    }

    rawSql = rawSql
      .trim()
      .replace(/;$/, "")
      .replace(/\bLEVEL\b(?=\s*[><=])/g, '"LEVEL"');

    if (!/^\s*(SELECT|WITH)\b/i.test(rawSql)) {
      res.status(400).json({ success: false, error: "Only SELECT queries are allowed for HR raw SQL" });
      return;
    }

    console.log("Executing rawSql:", rawSql);
    const result = await QueryExecutor.executeRawQuery(rawSql);
    const rows = result.rows || result;
    const formattedRows = Array.isArray(rows) ? rows.map((row) => formatResultDates(row)) : rows;

    res.json({
      success: true,
      data: formattedRows,
      totalCount: Array.isArray(formattedRows) ? formattedRows.length : 0,
    });
  } catch (error: any) {
    console.error("SQL Execution Error:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to execute SQL", details: error.message });
  }
};

export const executeRawSqlbody = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { query_parameter, query_where, query_updatevalues } = req.body;

    if (!query_parameter || !query_where) {
      res.status(400).json({
        error: "Missing query_parameter or query_where",
      });
      return;
    }

    const cleanWhere = query_where.replace(/`/g, "").trim();
    const cleanUpdate = (query_updatevalues || "").replace(/`/g, "").trim();

    console.log("Final WHERE string:", cleanWhere);
    console.log("Final UPDATE values string:", cleanUpdate);

    const procResult = await QueryExecutor.executeRawQuery(
      `BEGIN SP_CREATE_SQL_change(:query_parameter, :query_where, :query_updatevalues, :out_sql); END;`,
      {
        query_parameter,
        query_where: cleanWhere,
        query_updatevalues: cleanUpdate,
        out_sql: {
          dir: require("oracledb").BIND_OUT,
          type: require("oracledb").STRING,
          maxSize: 4000,
        },
      }
    );

    let rawSql: string = procResult.outBinds?.out_sql || procResult.out_sql;
    if (!rawSql) {
      res.status(500).json({ error: "Procedure did not return SQL" });
      return;
    }

    rawSql = rawSql.trim().replace(/;$/, "");
    console.log("Generated rawSql:", rawSql);

    const result = await QueryExecutor.executeRawQuery(rawSql);
    const rows = result.rows || result;

    res.json({
      success: true,
      data: rows,
      totalCount: rows.length,
    });
  } catch (error: any) {
    console.error("SQL Execution Error:", error);
    res.status(500).json({
      error: "Failed to execute SQL",
      details: error.message,
    });
  }
};
