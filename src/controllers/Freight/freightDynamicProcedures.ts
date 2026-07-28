import { Request, Response } from "express";
import oracledb from "oracledb";
import { QueryExecutor } from "../../database/QueryExecutor";

const codeSlots = Array.from({ length: 10 }, (_, index) => `code${index + 1}`);
const numberSlots = Array.from({ length: 5 }, (_, index) => `number${index + 1}`);
const dateSlots = Array.from({ length: 5 }, (_, index) => `date${index + 1}`);
const valueStringSlots = Array.from({ length: 30 }, (_, index) => `val1s${index + 1}`);
const valueNumberSlots = Array.from({ length: 10 }, (_, index) => `val1n${index + 1}`);
const valueDateSlots = Array.from({ length: 10 }, (_, index) => `val1d${index + 1}`);
const whereStringSlots = Array.from({ length: 10 }, (_, index) => `wval1s${index + 1}`);
const whereNumberSlots = Array.from({ length: 10 }, (_, index) => `wval1n${index + 1}`);
const whereDateSlots = Array.from({ length: 10 }, (_, index) => `wval1d${index + 1}`);

const selectSlots = [...codeSlots, ...numberSlots, ...dateSlots];
const mutationSlots = [
  ...selectSlots,
  ...valueStringSlots,
  ...valueNumberSlots,
  ...valueDateSlots,
  ...whereStringSlots,
  ...whereNumberSlots,
  ...whereDateSlots,
];

type BindValue = string | number | Date | null | undefined | oracledb.BindParameter;

export const proc_build_dynamic_sql_FREIGHT = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawSql = await callSqlBuilder("WMSTST.PROC_BUILD_DYNAMIC_SQL_FREIGHT", req.body, selectSlots);

    if (!rawSql) {
      res.status(500).json({ success: false, message: "Procedure did not return SQL" });
      return;
    }

    if (/^\s*(SELECT|WITH)/i.test(rawSql)) {
      const dataResult = await QueryExecutor.executeRawQuery(rawSql, []);
      res.json({
        success: true,
        data: dataResult.rows ?? [],
        totalCount: dataResult.rows?.length ?? 0,
      });
      return;
    }

    res.json({ success: true, message: rawSql, data: [], totalCount: 0 });
  } catch (error: any) {
    console.error("Freight select procedure error:", error);
    res.status(500).json({ success: false, message: "Failed to execute Freight select procedure", details: error.message });
  }
};

export const proc_build_dynamic_ins_upd_FREIGHT = async (req: Request, res: Response): Promise<void> => {
  try {
    const dynamicSql = await callSqlBuilder("WMSTST.PROC_BUILD_DYNAMIC_INS_UPD_FREIGHT", req.body, mutationSlots);

    if (!dynamicSql) {
      res.status(400).json({ success: false, message: "Procedure returned no SQL" });
      return;
    }

    await QueryExecutor.executeRawQuery(dynamicSql, []);
    res.json({ success: true, message: "Record saved successfully" });
  } catch (error: any) {
    console.error("Freight save procedure error:", error);
    res.status(500).json({ success: false, message: "Failed to execute Freight save procedure", details: error.message });
  }
};

export const proc_build_dynamic_del_FREIGHT = async (req: Request, res: Response): Promise<void> => {
  try {
    const dynamicSql = await callSqlBuilder("WMSTST.PROC_BUILD_DYNAMIC_DEL_FREIGHT", req.body, selectSlots);

    if (!dynamicSql) {
      res.status(400).json({ success: false, message: "Procedure returned no SQL" });
      return;
    }

    await QueryExecutor.executeRawQuery(dynamicSql, []);
    res.json({ success: true, message: "Record deleted successfully" });
  } catch (error: any) {
    console.error("Freight delete procedure error:", error);
    res.status(500).json({ success: false, message: "Failed to execute Freight delete procedure", details: error.message });
  }
};

async function callSqlBuilder(procedureName: string, body: Record<string, unknown>, slots: string[]) {
  const { parameter, loginid } = body;

  if (!parameter) {
    throw new Error("Missing required parameter 'parameter'");
  }

  const bindNames = ["parameter", "loginid", ...slots];
  const bindPlaceholders = bindNames.map((name) => `:${name}`).join(",\n          ");
  const binds = bindNames.reduce<Record<string, BindValue>>(
    (acc, name) => {
      acc[name] = normalizeBindValue(body[name]);
      return acc;
    },
    {
      parameter: String(parameter),
      loginid: loginid == null ? "" : String(loginid),
    }
  );

  const result = await QueryExecutor.executeRawQuery(
    `
      DECLARE
        v_sql CLOB;
      BEGIN
        ${procedureName}(
          ${bindPlaceholders},
          v_sql
        );
        :out_sql := v_sql;
      END;
    `,
    {
      ...binds,
      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    }
  );

  return (result.outBinds as { out_sql?: string | null })?.out_sql;
}

function normalizeBindValue(value: unknown): string | number | Date | null {
  if (value === undefined || value === "NULL") return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" || value === null) return value;
  return String(value);
}
