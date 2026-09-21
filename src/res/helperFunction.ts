import oracledb from "oracledb";

type ReportRow = Record<string, any>;
interface DynamicProcParams {
  [key: string]: string | number | Date | null | undefined;
}
interface ProcOut {
  out_sql: string | null;
}

function normalize<T extends ReportRow = ReportRow>(rows: any[] = []): T[] {
  return rows.map((row) =>
    Object.keys(row).reduce((acc: ReportRow, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {}),
  ) as T[];
}

async function execDynamicProc<T extends ReportRow = ReportRow>(
  conn: oracledb.Connection,
  procedureName: string,
  params: DynamicProcParams
): Promise<T[]> {

  const paramEntries = Object.entries(params);

  const procedureParams = paramEntries
    .map(([key]) => `:${key}`)
    .join(", ");

  const bindParams: Record<string, any> = {
    ...params,
    out_sql: {
      dir: oracledb.BIND_OUT,
      type: oracledb.STRING,
      maxSize: 32767,
    },
  };

  const result = await conn.execute(
    `
    DECLARE
      v_sql CLOB;
    BEGIN
      ${procedureName}(
        ${procedureParams},
        v_sql
      );

      :out_sql := v_sql;
    END;
    `,
    bindParams
  );

  const dynamicSql = (result.outBinds as ProcOut)?.out_sql;

  if (!dynamicSql) {
    throw Object.assign(
      new Error("Procedure returned no SQL"),
      { status: 400 }
    );
  }

  console.log(`Dynamic SQL [${procedureName}]:`, dynamicSql);

  const dataResult = await conn.execute(
    dynamicSql,
    [],
    {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    }
  );

  return normalize<T>(dataResult.rows as any[]);
}

// Values (functions) exported normally...
export { execDynamicProc, normalize };
// ...types exported separately, required when isolatedModules is on
export type { ReportRow, DynamicProcParams };