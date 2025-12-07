import oracledb, { Connection, Result } from "oracledb";
import { oracleDb } from "../../database/connection";

interface Filter {
  sort?: {
    field_name: string;
    desc?: boolean;
  };
}

interface RequestRejectedRow {
  [key: string]: any;
  total_count?: number;
}

export const getRequestRejectedData = async (
  loginid: string,
  company_code: string,
  filter?: Filter,
  page = 1,
  limit = 4000
) => {
  let conn: Connection | null = null;

  try {
    if (!loginid || !company_code) {
      return {
        success: false,
        data: [],
        count: 0,
        message: "Both loginid and company_code are required.",
      };
    }

    conn = await oracleDb.getConnection();

    console.log("Calling rejected request procedure with:", company_code, loginid);

    // Call procedure to populate GT_REJECTED
    await conn.execute(
      `BEGIN PROC_POPULATE_GT_REJECTED(:p_user, :p_company); END;`,
      {
        p_company: company_code,
        p_user: loginid,
      }
    );

    console.log("Rejected request procedure executed successfully");

    // Sorting
    let orderBy = "";
    if (filter?.sort?.field_name) {
      orderBy = ` ORDER BY "${filter.sort.field_name.toUpperCase()}" ${
        filter.sort.desc ? "DESC" : "ASC"
      } `;
    }

    const offset = (page - 1) * limit;

    // Fetch data with total count
    const dataResult: Result<RequestRejectedRow> = await conn.execute(
      `
      SELECT t.*, COUNT(*) OVER() AS TOTAL_COUNT
      FROM GT_REJECTED t
      ${orderBy}
      OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
      `,
      { offset, limit },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = (dataResult.rows as RequestRejectedRow[]) || [];

    // Convert column names to lowercase
    const tableData = rows.map((row) => {
      const newObj: RequestRejectedRow = {};
      Object.keys(row).forEach((key) => {
        newObj[key.toLowerCase()] = row[key];
      });
      return newObj;
    });

    const totalCount = tableData.length > 0 ? tableData[0].total_count || 0 : 0;

    console.log("Rejected Request Result:", { tableData, totalCount });

    return {
      success: true,
      data: tableData,   // frontend expects: response.data.data
      count: totalCount, // frontend expects: response.data.count
      message: "Rejected requests fetched successfully.",
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
        ? err
        : JSON.stringify(err);

    console.error("❌ Error in getRequestRejectedData:", message);

    return {
      success: false,
      data: [],
      count: 0,
      message,
    };
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch (closeErr) {
        console.error("❌ Error closing connection:", closeErr);
      }
    }
  }
};
