

import { oracleDb } from "../../database/connection";

interface Filter {
  sort?: {
    field_name: string;
    desc?: boolean;
  };
}

export const getPoModifyData = async (
  loginid: string,
  company_code: string,
  filter?: Filter,
  page = 1,
  limit = 4000
) => {
  let conn: any = null;

  try {
    if (!loginid || !company_code) {
      return {
        success: false,
        tableData: [],
        totalCount: 0,
        message: "Both loginid and company_code are required.",
      };
    }

    conn = await oracleDb.getConnection();

    console.log("Calling procedure with:", company_code, loginid);

    // Execute procedure
    await conn.execute(
      `BEGIN
         PROC_POPULATE_GT_CLOSE(:p_user, :p_company);
       END;`,
      {
        p_company: company_code,
        p_user: loginid,
      }
    );
   console.log("loginid,company_code");
    console.log("Procedure executed successfully");

    // Sorting
    let orderBy = "";
    if (filter?.sort?.field_name) {
      orderBy = ` ORDER BY ${filter.sort.field_name} ${
        filter.sort.desc ? "DESC" : "ASC"
      } `;
    }

    const offset = (page - 1) * limit;

    // Fetch paginated data
    const dataResult = await conn.execute(
      `
      SELECT *
      FROM GT_MY_TASK
      ${orderBy}
      OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
      `,
      { offset, limit }
    );

    // Fetch total count
    const countResult = await conn.execute(`SELECT COUNT(*) FROM GT_MY_TASK`);

    // Map rows to objects using column names
    const tableData =
      dataResult.rows?.map((row: any[], idx: number) => {
        const obj: any = {};
        dataResult.metaData.forEach((col: any, i: number) => {
          obj[col.name] = row[i];
        });
        return obj;
      }) || [];

    const totalCount =
      countResult.rows && countResult.rows.length > 0
        ? countResult.rows[0][0]
        : 0;

    console.log("My Task Result:", { tableData, totalCount });

    return {
      success: true,
      tableData,
      totalCount,
      message: "Data fetched successfully.",
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
        ? err
        : JSON.stringify(err);

    console.error("❌ Error in getMyModifyData:", message);

    return {
      success: false,
      tableData: [],
      totalCount: 0,
      message,
    };
  }
};
