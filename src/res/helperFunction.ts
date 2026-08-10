import oracledb from "oracledb";

type ReportRow = Record<string, any>;
interface DynamicProcParams {
  [key: string]: string | number | Date | null | undefined;
};
interface ProcOut {
  out_sql: string | null;
};

function normalize(rows: any[] = []): ReportRow[] {
  return rows.map((row) =>
    Object.keys(row).reduce((acc: ReportRow, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {}),
  );
}

async function execDynamicProc(
  conn: oracledb.Connection,
  procedureName: string,
  params: DynamicProcParams
): Promise<ReportRow[]> {

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

  return normalize(dataResult.rows as any[]);
}

export { execDynamicProc, normalize, ReportRow, DynamicProcParams };