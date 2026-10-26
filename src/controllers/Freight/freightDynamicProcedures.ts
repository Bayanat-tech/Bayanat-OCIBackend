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

function formatExecutableSql(rawSql: string): string {
  let sql = rawSql.trim();
  if (!sql) return sql;

  // If already a PL/SQL block, return as is
  if (/^\s*(BEGIN|DECLARE)/i.test(sql)) {
    return sql;
  }

  // Wrap in BEGIN ... END; to ensure single or multi-statement DML (MERGE, INSERT, UPDATE, DELETE)
  // executes cleanly in Oracle without ORA-00933 (command not properly ended) caused by semicolons
  if (!sql.endsWith(";")) {
    sql += ";";
  }
  return `BEGIN\n${sql}\nEND;`;
}

export const proc_build_dynamic_sql_FREIGHT = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawSql = await callSqlBuilder("PROC_BUILD_DYNAMIC_SQL_FREIGHT", req.body, selectSlots);

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
    const dynamicSql = await callSqlBuilder("PROC_BUILD_DYNAMIC_INS_UPD_FREIGHT", req.body, mutationSlots);

    if (!dynamicSql) {
      res.status(400).json({ success: false, message: "Procedure returned no SQL" });
      return;
    }

    const executableSql = formatExecutableSql(dynamicSql);
    console.log("Executing Freight DML SQL:\n", executableSql);
    await QueryExecutor.executeRawQuery(executableSql, []);
    res.json({ success: true, message: "Record saved successfully" });
  } catch (error: any) {
    console.error("Freight save procedure error:", error);
    res.status(500).json({ success: false, message: "Failed to execute Freight save procedure", details: error.message });
  }
};

export const proc_build_dynamic_del_FREIGHT = async (req: Request, res: Response): Promise<void> => {
  try {
    const dynamicSql = await callSqlBuilder("PROC_BUILD_DYNAMIC_DEL_FREIGHT", req.body, selectSlots);

    if (!dynamicSql) {
      res.status(400).json({ success: false, message: "Procedure returned no SQL" });
      return;
    }

    const executableSql = formatExecutableSql(dynamicSql);
    console.log("Executing Freight DEL SQL:\n", executableSql);
    await QueryExecutor.executeRawQuery(executableSql, []);
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

  // Auto-correct shifted slots for freight_transporter if transporter_type was sent in val1s3
  if (String(parameter).toLowerCase() === "freight_transporter") {
    if (
      body.val1s3 === "SUBCON" ||
      body.val1s3 === "OWN" ||
      (typeof body.val1s3 === "string" && body.val1s3.length > 5)
    ) {
      body.val1s3 = body.val1s4; // country_code
      body.val1s4 = body.val1s5; // trns_city
      body.val1s15 = body.val1s6; // territory_code
      body.val1s13 = body.val1s7; // ac_code
      body.val1s14 = body.val1s8; // trn_no
      body.val1s9 = body.val1s12; // trns_addr1
      body.val1s10 = body.val1s13; // trns_addr2
      body.val1s11 = body.val1s14; // trns_addr3
      body.val1s12 = body.val1s15; // trns_addr4
      body.val1s5 = body.val1s16; // trns_contact1
      body.val1s6 = body.val1s17; // trns_telno1
      body.val1s7 = body.val1s18; // trns_faxno1
      body.val1s8 = body.val1s19; // trns_email1
    }
    if (typeof body.val1s3 === "string") {
      body.val1s3 = body.val1s3.slice(0, 5);
    }
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
