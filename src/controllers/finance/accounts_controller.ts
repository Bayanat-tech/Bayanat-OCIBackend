import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";

export const proc_common_sql_finance = async (req: Request, res: Response): Promise<void> => {
  let connection;

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

  console.log('check Common sql',req.body);

    if (!parameter) {
      res.status(400).json({ error: "Missing required parameter 'parameter'" });
      return;
    }

    let tenantId: string | undefined;
    try {
      tenantId = getCurrentTenantId();
    } catch (e) {}
    if (!tenantId && (req as any).body?.loginid) {
      tenantId = await TenantManager.getTenantForUser((req as any).body.loginid);
    }

    if (!tenantId) {
      res.status(400).json({ error: "Tenant not found for request" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const result = await connection.execute(
      `
      DECLARE
        v_sql VARCHAR2(32767);
      BEGIN
        PROC_COMMON_SQL_FINANCE(
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

    const dataResult = await connection.execute<any[]>(rawSql, [], {
      outFormat: oracledb.OUT_FORMAT_ARRAY
    });

    const tableData =
      dataResult.rows?.map((row) => {
        const obj: Record<string, any> = {};
        dataResult.metaData?.forEach((col, i) => {
          obj[col.name.toLowerCase()] = row[i];
        });
        return obj;
      }) || [];

    res.json({
      success: true,
      data: tableData,
      totalCount: tableData.length,
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