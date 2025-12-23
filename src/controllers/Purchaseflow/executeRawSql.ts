import { Request, Response } from "express";
import oracledb from "oracledb";
import { oracleDb } from "../../../src/database/connection";

export const executeRawSql = async (req: Request, res: Response): Promise<void> => {
  let connection: oracledb.Connection | null = null;

  try {
    const rawSql: string = req.body?.raw_sql || req.query?.sql;
    const binds = req.body?.binds || {}; // optional bind parameters

    if (!rawSql || typeof rawSql !== "string") {
      res.status(400).json({ error: "Missing or invalid raw SQL string" });
      return;
    }

    // ❌ Remove trailing semicolon
    const sanitizedSql = rawSql.trim().replace(/;$/, "");

    connection = await oracleDb.getConnection();
    if (!connection) throw new Error("Failed to get Oracle connection");

    const result = await connection.execute(
      sanitizedSql,
      binds, // Pass bind params safely
      { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: false }
    );

    const rows = result.rows?.map((r) => {
  if (typeof r !== 'object' || r === null) return {};
  const obj: Record<string, any> = {};
  Object.keys(r).forEach(k => {
    obj[k.toLowerCase()] = (r as any)[k];
  });
  return obj;
}) || [];

    const rowsAffected = result.rowsAffected ?? 0;

    if (rowsAffected > 0) await connection.commit();

    res.status(200).json({
      success: true,
      data: rows,
      rowsAffected,
      totalCount: rows.length,
    });

  } catch (error: any) {
    if (connection) {
      try { await connection.rollback(); } catch {}
    }

    console.error("❌ SQL Execution Error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to execute SQL",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    if (connection) {
      try { await connection.close(); } catch {}
    }
  }
};
