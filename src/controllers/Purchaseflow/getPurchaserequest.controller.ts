import { Request, Response, NextFunction } from "express";
import oracledb from "oracledb";
import { oracleDb } from "../../database/connection";

export const getPurchaserequest = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  let connection;

  try {
    const rawRequestNumber = req.params.request_number;
    console.log("Received request_number:", rawRequestNumber);

    if (!rawRequestNumber) {
      res.json({
        success: false,
        data: [],
        count: 0,
        message: "Missing request_number",
      });
      return;
    }

    const request_number = rawRequestNumber;
    const company_code = "JASRA"; // hard-coded

    connection = await oracleDb.getConnection();
    console.log("step1: connected to Oracle");

    // 1️⃣ Count header
    const countResult = await connection.execute<{ COUNT: number }>(
      `SELECT COUNT(*) AS COUNT
       FROM PURCHASE_REQUEST_HEADER
       WHERE REQUEST_NUMBER = :request_number`,
      { request_number },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const count = countResult.rows?.[0]?.COUNT ?? 0;
    console.log("step2: countResult:", count);

    if (count === 0) {
      res.json({
        success: false,
        data: [],
        count: 0,
        message: "Purchase Request does not exist",
      });
      return;
    }

    // 2️⃣ Get PRIN_CODE
    const prinResult = await connection.execute<{ PRIN_CODE: string }>(
      `SELECT prin_code
       FROM MS_PRINCIPAL
       WHERE PRIN_DEPT_CODE IN (
         SELECT DISTINCT div_code
         FROM PURCHASE_REQUEST_DETAILS
         WHERE REQUEST_NUMBER = :request_number
       )`,
      { request_number },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const ls_prin_code = prinResult.rows?.[0]?.PRIN_CODE;
    console.log("step3: PRIN_CODE:", ls_prin_code);
    if (!ls_prin_code) {
      res.json({
        success: false,
        data: [],
        count,
        message: "PRIN_CODE not found for this request",
      });
      return;
    }

    // 3️⃣ Fetch header
    const headerResult = await connection.execute(
      `SELECT REPLACE(request_number, '$', '/') AS request_number,
              final_approved, fa_uploaded, flow_level_running, request_date,
              description, type_of_contract, amc_from, amc_to,
              type_of_material_supply, wo_number, remarks, project_code,
              contract_soft_hard, amc_service_status, material_mechanical,
              material_electrical, material_plumbing, material_tools,
              material_civil, material_ac, material_cleaning, material_other,
              services_temp_staff, services_rentals, services_subcon_conslt,
              services_other, other_stationery, other_it,
              other_new_uniform_ppe, other_rplcmt_uniform, other_other,
              good_material_request, service_request, last_action, need_by_date,
              service_type, type_of_pr, covered_by_contract_yes, flag_sharing_cost,
              budgeted_yes, checked_store_yes, project_name, div_code,
              others, it_tech, stationary, laundry_housekeeping, accommodation,
              catering, medical, transportation, training, recruitment_hr,
              uniform, furniture, entertainment, barber, requestor_name
       FROM VW_PURCHASE_REQUEST_HEADER
       WHERE REQUEST_NUMBER = :request_number
         AND COMPANY_CODE = :company_code
         AND ROWNUM = 1`,
      { request_number, company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const headerRow = headerResult.rows?.[0];
    console.log("step4: header fetched:", headerRow);
    if (!headerRow) {
      res.json({
        success: false,
        data: [],
        count,
        message: "Purchase Request header not found",
      });
      return;
    }

    // 4️⃣ Fetch detail / items
    const detailResult = await connection.execute(
      `SELECT *
       FROM VW_PURCHASE_REQUEST_TRANSACTION1
       WHERE REQUEST_NUMBER = :request_number
         AND PRIN_CODE = :ls_prin_code
       ORDER BY ITEM_SEQUENCE_NO`,
      { request_number, ls_prin_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const itemRows = detailResult.rows ?? [];
    console.log("step5: items fetched, count:", itemRows.length);

    // 5️⃣ Fetch terms & conditions
    const termResult = await connection.execute(
      `SELECT request_number, supplier AS tsupplier, remarks, dlvr_term,
              payment_terms, quatation_reference, delivery_address
       FROM PR_SUPPL_TERM_COND
       WHERE request_number = :request_number`,
      { request_number },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const termRows = termResult.rows ?? [];
    console.log("step6: terms fetched, count:", termRows.length);

    // 6️⃣ Fetch files (using ResultSet)
    const filesResult = await connection.execute(
      `SELECT COMPANY_CODE, REQUEST_NUMBER, SR_NO, FILE_NAME, ORG_FILE_NAME,
              AWS_FILE_LOCN, FLOW_LEVEL, MODULES, UPDATED_AT, UPDATED_BY,
              CREATED_BY, CREATED_AT, EXTENSIONS, USER_FILE_NAME, TYPE
       FROM UPLOADED_FILES_DLTS
       WHERE COMPANY_CODE = :cc
         AND REQUEST_NUMBER = :rn
       ORDER BY SR_NO DESC`,
      { cc: company_code, rn: request_number },
      {
        resultSet: true,
        fetchArraySize: 500,
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      }
    );

    const rs = filesResult.resultSet;
    const filesRows: any[] = [];

    if (rs) {
      let chunk;
      do {
        chunk = await rs.getRows(500); // fetch in batches of 500 :contentReference[oaicite:0]{index=0}
        filesRows.push(...chunk);
      } while (chunk.length === 500);

      await rs.close(); // close result set when done :contentReference[oaicite:1]{index=1}
    }
    console.log("step7: files fetched, count:", filesRows.length);

    // 7️⃣ Convert keys to lowercase
    const toLower = (rows: any[]) =>
      rows.map((row) => {
        const obj: any = {};
        for (const [k, v] of Object.entries(row)) {
          obj[k.toLowerCase()] = v;
        }
        return obj;
      });

    const headerLower = toLower([headerRow])[0];
    const itemsLower = toLower(itemRows);
    const termsLower = toLower(termRows);
    const filesLower = toLower(filesRows);

    // 8️⃣ Send response
    res.json({
      success: true,
      data: {
        header: headerLower,
        items: itemsLower,
        termscondition: termsLower,
        files: filesLower,
      },
      count,
      message: "",
    });
    console.log("step8: response sent successfully");
  } catch (err: unknown) {
    console.error("Error in getPurchaserequest:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({
      success: false,
      data: [],
      count: 0,
      message,
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
        console.log("Connection closed");
      } catch (closeErr) {
        console.error("Error closing connection:", closeErr);
      }
    }
  }
};
