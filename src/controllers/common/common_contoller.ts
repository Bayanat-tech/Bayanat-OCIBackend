import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import { scopeAlmsApprovalQuery } from "../../utils/workflowVisibility";

export const procBuildCommonProcedurewmc = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection;

  try {
    const body = req.body;
    console.log('inside procBuildCommon 1')
    if (!body?.parameter || !body?.loginid) {
      res.status(400).json({
        success: false,
        message: "parameter and loginid are required"
      });
      return;
    }
    console.log('inside procBuildCommon 2')
    let tenantId: string | undefined;
    try {
      tenantId = getCurrentTenantId();
    } catch (e) { }
    if (!tenantId && (req as any).body?.loginid) {
      tenantId = await TenantManager.getTenantForUser((req as any).body.loginid);
    }
    console.log('inside procBuildCommon 3')
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found for request" });
      return;
    }
    console.log('inside procBuildCommon 4')
    connection = await TenantManager.getConnection(tenantId);
    console.log('inside procBuildCommon 5')
    const result = await connection.execute(
      `
      DECLARE
        v_msg CLOB;
      BEGIN
        PROC_BUILD_COMMON_PROCEDURE_WMS(
          :parameter,
          :loginid,

          :val1s1, :val1s2, :val1s3, :val1s4, :val1s5,
          :val1s6, :val1s7, :val1s8, :val1s9, :val1s10,
          :val1s11, :val1s12, :val1s13, :val1s14, :val1s15,
          :val1s16, :val1s17, :val1s18, :val1s19, :val1s20,

          :val1n1, :val1n2, :val1n3, :val1n4, :val1n5,
          :val1n6, :val1n7, :val1n8, :val1n9, :val1n10,

          v_msg
        );

        :out_msg := v_msg;
      END;
      `,
      {
        parameter: body.parameter,
        loginid: body.loginid,

        // STRING VALUES
        val1s1: body.val1s1, val1s2: body.val1s2,
        val1s3: body.val1s3, val1s4: body.val1s4,
        val1s5: body.val1s5, val1s6: body.val1s6,
        val1s7: body.val1s7, val1s8: body.val1s8,
        val1s9: body.val1s9, val1s10: body.val1s10,
        val1s11: body.val1s11, val1s12: body.val1s12,
        val1s13: body.val1s13, val1s14: body.val1s14,
        val1s15: body.val1s15, val1s16: body.val1s16,
        val1s17: body.val1s17, val1s18: body.val1s18,
        val1s19: body.val1s19, val1s20: body.val1s20,

        // NUMBER VALUES
        val1n1: body.val1n1, val1n2: body.val1n2,
        val1n3: body.val1n3, val1n4: body.val1n4,
        val1n5: body.val1n5, val1n6: body.val1n6,
        val1n7: body.val1n7, val1n8: body.val1n8,
        val1n9: body.val1n9, val1n10: body.val1n10,

        out_msg: {
          dir: oracledb.BIND_OUT,
          type: oracledb.STRING,
          maxSize: 32767
        }
      }
    );

    const message = (result.outBinds as any)?.out_msg;

    res.json({
      success: !message?.toLowerCase().includes("unsuccess"),
      message: message ?? "Procedure executed"
    });

  } catch (err: any) {
    console.error("Oracle error:", err);
    res.status(500).json({
      success: false,
      message: "Procedure execution failed",
      details: err.message
    });
  } finally {
    if (connection) await connection.close().catch(() => { });
  }
};

export const proc_build_dynamic_del_common = async (req: Request, res: Response): Promise<void> => {
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

    console.log('Check dynamic delete request:', req.body);

    if (!parameter) {
      res.status(400).json({ success: false, message: "Missing required parameter 'parameter'" });
      return;
    }

    let tenantId: string | undefined;
    try {
      tenantId = getCurrentTenantId();
    } catch (e) { }
    if (!tenantId && (req as any).body?.loginid) {
      tenantId = await TenantManager.getTenantForUser((req as any).body.loginid);
    }

    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found for request" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    if (await handleCityDropdown(connection, req, res)) {
      return;
    }

    const result = await connection.execute(
      `
      DECLARE
        v_sql VARCHAR2(32767);
      BEGIN
        PROC_BUILD_DYNAMIC_DEL_common(
          :parameter,
          :loginid,
          :code1,
          :code2,
          :code3,
          :code4,
          null,
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

    // TypeScript typing for out binds
    interface ProcOutBinds {
      out_sql: string | null;
    }

    const outBinds = result.outBinds as ProcOutBinds;
    const rawSql = outBinds?.out_sql;

    if (!rawSql) {
      res.status(400).json({ success: false, message: "Invalid delete parameter or procedure returned nothing" });
      return;
    }

    console.log("Generated DELETE SQL:", rawSql);

    try {
      // Execute the DELETE SQL
      await connection.execute(rawSql, [], { autoCommit: true });

      res.json({
        success: true,
        message: "Record Deleted Successfully"
      });
    } catch (deleteError: any) {
      console.error("Failed to execute DELETE SQL:", deleteError);
      res.status(500).json({
        success: false,
        message: "Record not deleted successfully",
        details: deleteError.message
      });
    }

  } catch (error: any) {
    console.error("Oracle Error:", error);
    res.status(500).json({ success: false, message: "Failed to execute procedure", details: error.message });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error("Failed to close Oracle connection:", closeErr);
      }
    }
  }
};


export const proc_build_dynamic_ins_upd_common = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection;

  try {
    const {
      parameter,
      loginid,

      // INSERT / UPDATE VALUES
      val1s1,
      val1s2,
      val1s3,
      val1s4,
      val1s5,
      val1s6,
      val1s7,
      val1s8,
      val1s9,
      val1s10,

      val1n1,
      val1n2,
      val1n3,
      val1n4,
      val1n5,

      val1d1,
      val1d2,
      val1d3,
      val1d4,
      val1d5,

      // WHERE VALUES
      wval1s1,
      wval1s2,
      wval1s3,
      wval1s4,
      wval1s5,

      wval1n1,
      wval1n2,
      wval1n3,
      wval1n4,
      wval1n5,

      wval1d1,
      wval1d2,
      wval1d3,
      wval1d4,
      wval1d5
    } = req.body;

    if (!parameter) {
      res.status(400).json({
        success: false,
        message: "Missing required parameter 'parameter'"
      });
      return;
    }

    let tenantId: string | undefined;
    try {
      tenantId = getCurrentTenantId();
    } catch (e) { }
    if (!tenantId && (req as any).body?.loginid) {
      tenantId = await TenantManager.getTenantForUser((req as any).body.loginid);
    }

    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found for request" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    if (await handleCityDropdown(connection, req, res)) {
      return;
    }

    const result = await connection.execute(
      `
      DECLARE
        v_sql CLOB;
      BEGIN
        PROC_BUILD_DYNAMIC_INS_UPD_common(
          :parameter,
          :loginid,

          :val1s1, :val1s2, :val1s3, :val1s4, :val1s5,
          :val1s6, :val1s7, :val1s8, :val1s9, :val1s10,

          :val1n1, :val1n2, :val1n3, :val1n4, :val1n5,

          :val1d1, :val1d2, :val1d3, :val1d4, :val1d5,

          :wval1s1, :wval1s2, :wval1s3, :wval1s4, :wval1s5,

          :wval1n1, :wval1n2, :wval1n3, :wval1n4, :wval1n5,

          :wval1d1, :wval1d2, :wval1d3, :wval1d4, :wval1d5,

          v_sql
        );
        :out_sql := v_sql;
      END;
      `,
      {
        parameter,
        loginid,

        val1s1,
        val1s2,
        val1s3,
        val1s4,
        val1s5,
        val1s6,
        val1s7,
        val1s8,
        val1s9,
        val1s10,

        val1n1,
        val1n2,
        val1n3,
        val1n4,
        val1n5,

        val1d1,
        val1d2,
        val1d3,
        val1d4,
        val1d5,

        wval1s1,
        wval1s2,
        wval1s3,
        wval1s4,
        wval1s5,

        wval1n1,
        wval1n2,
        wval1n3,
        wval1n4,
        wval1n5,

        wval1d1,
        wval1d2,
        wval1d3,
        wval1d4,
        wval1d5,

        out_sql: {
          dir: oracledb.BIND_OUT,
          type: oracledb.STRING,
          maxSize: 32767
        }
      }
    );

    interface ProcOut {
      out_sql: string | null;
    }

    const outBinds = result.outBinds as ProcOut;
    const dynamicSql = outBinds?.out_sql;

    if (!dynamicSql) {
      res.status(400).json({
        success: false,
        message: "Procedure returned no SQL"
      });
      return;
    }

    console.log("Generated INSERT/UPDATE SQL:", dynamicSql);

    // Execute INSERT / UPDATE
    await connection.execute(dynamicSql, [], { autoCommit: true });

    res.json({
      success: true,
      message: "Record inserted / updated successfully"
    });

  } catch (error: any) {
    console.error("Oracle Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to execute insert/update",
      details: error.message
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Connection close error:", err);
      }
    }
  }
};



async function handleCityDropdown(connection: oracledb.Connection, req: Request, res: Response): Promise<boolean> {
  const param = String(req.body.parameter || "").trim();
  if (param.toUpperCase() !== "DROP_DOWN_CITY") return false;

  let countryCode = String(
    req.body.country_code ||
    req.body.COUNTRY_CODE ||
    (req.body.code1 && req.body.code1 !== req.body.company_code && req.body.code1 !== "01" ? req.body.code1 : req.body.code2) ||
    ""
  ).trim().toUpperCase();

  if (countryCode && countryCode.includes("-")) {
    countryCode = countryCode.split("-")[0].trim();
  }

  let query = `
    SELECT CITY_NAME AS "label", CITY_NAME AS "value", MIN(CITY_CODE) AS "city_code", MIN(COUNTRY_CODE) AS "country_code", MIN(STATE_PROVINCE) AS "state"
    FROM CUSTOMERS.MS_CITY
    WHERE IS_ACTIVE = 'Y'
  `;
  const binds: any = {};
  if (countryCode) {
    query += ` AND (
      UPPER(COUNTRY_CODE) = :cc
      OR UPPER(COUNTRY_CODE) = SUBSTR(:cc, 1, 2)
      OR UPPER(COUNTRY_CODE) IN (SELECT UPPER(COUNTRY_CODE) FROM MS_COUNTRY WHERE UPPER(COUNTRY_CODE) = :cc OR UPPER(COUNTRY_NAME) = :cc)
    )`;
    binds.cc = countryCode;
  }
  query += ` GROUP BY CITY_NAME ORDER BY CITY_NAME ASC`;

  try {
    const cityRes = await connection.execute(query, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const rows = (cityRes.rows as any[]) || [];
    res.json({
      success: true,
      data: rows,
      totalCount: rows.length,
    });
    return true;
  } catch (err: any) {
    console.error("Error executing DROP_DOWN_CITY query:", err);
    res.status(500).json({ success: false, error: "Failed to load cities", details: err.message });
    return true;
  }
}

export const proc_build_dynamic_sql_common = async (req: Request, res: Response): Promise<void> => {
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
    console.log('check dynamic sql', req.body);
    if (!parameter) {
      res.status(400).json({ error: "Missing required parameter 'parameter'" });
      return;
    }

    let param = parameter;
    if (param === "Account_Currency_CODE_Search") {
      param = "Account_Currency_CODE_Serach";
    }

    let tenantId: string | undefined;
    try {
      tenantId = getCurrentTenantId();
    } catch (e) { }
    if (!tenantId && (req as any).body?.loginid) {
      tenantId = await TenantManager.getTenantForUser((req as any).body.loginid);
    }

    if (!tenantId) {
      res.status(400).json({ error: "Tenant not found for request" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    if (await handleCityDropdown(connection, req, res)) {
      return;
    }

    const result = await connection.execute(
      `
      DECLARE
        v_sql VARCHAR2(32767);
      BEGIN
        PROC_BUILD_DYNAMIC_SQL_common(
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
        parameter: param,
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

    const scoped = scopeAlmsApprovalQuery(param, rawSql, (req as any).user);
    const dataResult = await connection.execute<any[]>(scoped.sql, scoped.binds, {
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


export const proc_build_dynamic_sql_common20 = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection;

  try {

    const {
      parameter,
      loginid,

      code1,
      code2,
      code3,
      code4,
      code5,
      code6,
      code7,
      code8,
      code9,
      code10,
      code11,
      code12,
      code13,
      code14,
      code15,
      code16,
      code17,
      code18,
      code19,
      code20,

      number1,
      number2,
      number3,
      number4,

      date1,
      date2,
      date3,
      date4

    } = req.body;

    console.log('check dynamic sql common20', req.body);

    if (!parameter) {
      res.status(400).json({
        error: "Missing required parameter 'parameter'"
      });
      return;
    }

    let tenantId: string | undefined;

    try {
      tenantId = getCurrentTenantId();
    } catch (e) { }

    if (!tenantId && (req as any).body?.loginid) {
      tenantId = await TenantManager.getTenantForUser(
        (req as any).body.loginid
      );
    }

    if (!tenantId) {
      res.status(400).json({
        error: "Tenant not found for request"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    if (await handleCityDropdown(connection, req, res)) {
      return;
    }

    const result = await connection.execute(

      `
      DECLARE
        v_sql VARCHAR2(32767);
      BEGIN

        PROC_BUILD_DYNAMIC_SQL_COMMON20(

          :parameter,
          :loginid,

          :code1,
          :code2,
          :code3,
          :code4,
          :code5,
          :code6,
          :code7,
          :code8,
          :code9,
          :code10,
          :code11,
          :code12,
          :code13,
          :code14,
          :code15,
          :code16,
          :code17,
          :code18,
          :code19,
          :code20,

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
        code5: (code5 && typeof code5 === 'string' && (code5.includes('NaN') || code5.trim() === '' || code5.toLowerCase() === 'null' || code5.toLowerCase() === 'undefined')) ? null : (code5 || null),
        code6: (code6 && typeof code6 === 'string' && (code6.includes('NaN') || code6.trim() === '' || code6.toLowerCase() === 'null' || code6.toLowerCase() === 'undefined')) ? null : (code6 || null),
        code7: (code7 && typeof code7 === 'string' && (code7.includes('NaN') || code7.trim() === '' || code7.toLowerCase() === 'null' || code7.toLowerCase() === 'undefined')) ? null : (code7 || null),
        code8: (code8 && typeof code8 === 'string' && (code8.includes('NaN') || code8.trim() === '' || code8.toLowerCase() === 'null' || code8.toLowerCase() === 'undefined')) ? null : (code8 || null),
        code9,
        code10,
        code11,
        code12,
        code13,
        code14,
        code15,
        code16,
        code17,
        code18,
        code19,
        code20,

        number1,
        number2,
        number3,
        number4,

        date1,
        date2,
        date3,
        date4,

        out_sql: {
          dir: oracledb.BIND_OUT,
          type: oracledb.STRING,
          maxSize: 32767
        }

      }

    );

    interface ProcOutBinds {
      out_sql: string;
    }

    const outBinds = result.outBinds as ProcOutBinds;

    const rawSql = outBinds?.out_sql
      ?.replace(/[\r\n]+/g, " ")
      ?.replace(/\s+/g, " ")
      ?.trim();

    if (!rawSql) {

      res.status(500).json({
        error: "Procedure did not return SQL"
      });

      return;
    }

    console.log("Generated SQL:", rawSql);

    if (code20?.toUpperCase() === 'RAWSQL') {

      res.json({
        success: true,
        rawSql
      });

      return;
    }


    const dataResult = await connection.execute<any[]>(
      rawSql,
      [],
      {
        outFormat: oracledb.OUT_FORMAT_ARRAY
      }
    );

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
      totalCount: tableData.length

    });

  } catch (error: any) {

    console.error("Oracle Error:", error);

    res.status(500).json({

      error: "Failed to execute SQL",
      details: error.message

    });

  } finally {

    if (connection) {

      try {

        await connection.close();

      } catch (closeErr) {

        console.error(
          "Failed to close connection:",
          closeErr
        );

      }

    }

  }

};

export const proc_build_dynamic_ins_upd_column90 = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection;

  try {
    const { parameter, loginid } = req.body;

    if (!parameter) {
      res.status(400).json({
        success: false,
        message: "Missing required parameter 'parameter'"
      });
      return;
    }

    // Resolve tenantId from context or fallback to loginid lookup
    let tenantId: string | undefined;
    try {
      tenantId = getCurrentTenantId();
    } catch (e) { }
    if (!tenantId && (req as any).body?.loginid) {
      tenantId = await TenantManager.getTenantForUser((req as any).body.loginid);
    }

    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found for request" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    let dynamicSql: string | null = null;

    if (String(parameter).trim().toLowerCase() === "ms_companyinfo_ins_upd") {
      // Call dedicated procedure for Company Info
      const binds: Record<string, any> = {
        loginid: loginid || "USER_PM",
        out_sql: {
          dir: oracledb.BIND_OUT,
          type: oracledb.STRING,
          maxSize: 32767
        }
      };

      const validCompanyIndices = [
        ...Array.from({ length: 42 }, (_, i) => i + 1),
        ...Array.from({ length: 26 }, (_, i) => i + 45), // 45..70
        ...Array.from({ length: 6 }, (_, i) => i + 72),  // 72..77
      ];

      const bindDefs: string[] = ["P_LOGINID => :loginid"];
      for (const idx of validCompanyIndices) {
        const key = `val1s${idx}`;
        const val = req.body[key];
        binds[key] = val != null ? String(val) : null;
        bindDefs.push(`P_${key.toUpperCase()} => :${key}`);
      }

      // Safeguard: Preserve existing NOT NULL columns if not passed in req.body
      if (binds.val1s1) {
        try {
          const existingRes = await connection.execute(
            `SELECT COMPANY_NAME, ADDRESS1, ADDRESS2, CITY, COUNTRY, EMAIL FROM MS_COMPANYINFO WHERE COMPANY_CODE = :cc AND ROWNUM = 1`,
            { cc: binds.val1s1 },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );
          if (existingRes.rows && existingRes.rows.length > 0) {
            const row: any = existingRes.rows[0];
            const cName = row.COMPANY_NAME ?? row[0];
            const a1 = row.ADDRESS1 ?? row[1];
            const a2 = row.ADDRESS2 ?? row[2];
            const city = row.CITY ?? row[3];
            const ctry = row.COUNTRY ?? row[4];
            const email = row.EMAIL ?? row[5];

            if (!binds.val1s2) binds.val1s2 = cName;
            if (!binds.val1s3) binds.val1s3 = a1 || "Address 1";
            if (!binds.val1s4) binds.val1s4 = a2 || "Address 2";
            if (!binds.val1s6) binds.val1s6 = city || "City";
            if (!binds.val1s7) binds.val1s7 = ctry || "Country";
            if (!binds.val1s8) binds.val1s8 = email || "info@bayanat.com";
          }
        } catch (fetchErr) {
          console.warn("Could not fetch existing MS_COMPANYINFO for fallback:", fetchErr);
        }
      }

      // Hard fallback defaults for required NOT NULL fields in MS_COMPANYINFO
      if (!binds.val1s3) binds.val1s3 = "Address 1";
      if (!binds.val1s4) binds.val1s4 = "Address 2";
      if (!binds.val1s6) binds.val1s6 = "City";
      if (!binds.val1s7) binds.val1s7 = "OMAN";
      if (!binds.val1s8) binds.val1s8 = "info@bayanat.com";

      for (let i = 1; i <= 10; i++) {
        const key = `val1n${i}`;
        const val = req.body[key];
        binds[key] = val != null && val !== "" ? Number(val) : null;
        bindDefs.push(`P_${key.toUpperCase()} => :${key}`);
      }
      bindDefs.push(`P_SQL_OUT => v_sql`);

      const result = await connection.execute(
        `
        DECLARE
          v_sql CLOB;
        BEGIN
          PROC_BUILD_DYNAMIC_INS_UPD_COMPANYINFO(
            ${bindDefs.join(",\n            ")}
          );
          :out_sql := v_sql;
        END;
        `,
        binds
      );

      dynamicSql = (result.outBinds as any)?.out_sql;
    } else {
      // General PROC_BUILD_DYNAMIC_INS_UPD_COLUMN90
      const binds: Record<string, any> = {
        parameter,
        loginid: loginid || "USER_PM",
        out_sql: {
          dir: oracledb.BIND_OUT,
          type: oracledb.STRING,
          maxSize: 32767
        }
      };

      for (let i = 1; i <= 90; i++) {
        const key = `val1s${i}`;
        const val = req.body[key];
        binds[key] = val != null ? String(val) : null;
      }

      for (let i = 1; i <= 10; i++) {
        const key = `val1n${i}`;
        const val = req.body[key];
        binds[key] = val != null && val !== "" ? Number(val) : null;
      }

      const sPlaceholders = Array.from({ length: 90 }, (_, i) => `:val1s${i + 1}`).join(", ");
      const nPlaceholders = Array.from({ length: 10 }, (_, i) => `:val1n${i + 1}`).join(", ");

      const result = await connection.execute(
        `
        DECLARE
          v_sql CLOB;
        BEGIN
          PROC_BUILD_DYNAMIC_INS_UPD_COLUMN90(
            :parameter,
            :loginid,
            ${sPlaceholders},
            ${nPlaceholders},
            v_sql
          );
          :out_sql := v_sql;
        END;
        `,
        binds
      );

      dynamicSql = (result.outBinds as any)?.out_sql;
    }

    if (!dynamicSql || dynamicSql.toUpperCase().includes("INVALID PARAMETER")) {
      res.status(400).json({
        success: false,
        message: `Procedure returned: ${dynamicSql || "no SQL"}`
      });
      return;
    }

    console.log("Generated INSERT/UPDATE SQL:", dynamicSql);

    // Execute INSERT / UPDATE
    await connection.execute(dynamicSql, [], { autoCommit: true });

    res.json({
      success: true,
      message: "Record inserted / updated successfully"
    });

  } catch (error: any) {
    console.error("Oracle Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to execute insert/update",
      details: error.message
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Connection close error:", err);
      }
    }
  }
};
