import { Request, Response } from "express";
import oracledb from "oracledb";
import { oracleDb } from "../../database/connection";
import cors from "cors";

// Enable CORS globally
export const enableCors = (app: any) => {
  app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }));

  // Handle OPTIONS preflight requests
  app.use((req: any, res: any, next: any) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });
};

// Controller to get purchase request
export const getPurchaserequest = async (req: Request, res: Response): Promise<void> => {
  let connection;

  try {
    const rawRequestNumber = req.params.request_number;
    console.log("Received request_number:", rawRequestNumber);

    // DB stores $ format → use rawRequestNumber for queries
    const request_number = rawRequestNumber;

    // Convert to slash format only for frontend display
    const request_number_display = rawRequestNumber.replace(/\$/g, "/");

    connection = await oracleDb.getConnection();

    // 1️⃣ Check if request exists
    const countResult = await connection.execute<{ COUNT: number }>(
      `SELECT COUNT(*) AS COUNT
       FROM PURCHASE_REQUEST_HEADER
       WHERE REQUEST_NUMBER = :request_number`,
      { request_number },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const count = countResult.rows?.[0]?.COUNT || 0;

    if (count === 0) {
      res.status(404).json({ success: false, message: "Purchase Request does not exist" });
      return;
    }

    // 2️⃣ Fetch PRIN_CODE
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

    if (!ls_prin_code) {
      res.status(404).json({ success: false, message: "PRIN_CODE not found for this request" });
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
         AND COMPANY_CODE = 'JASRA'
         AND ROWNUM = 1`,
      { request_number },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const headerRow = headerResult.rows?.[0];
    if (!headerRow) {
      res.status(404).json({ success: false, message: "Purchase Request header not found" });
      return;
    }

    // 4️⃣ Fetch items
    const detailResult = await connection.execute(
      `SELECT *
       FROM VW_PURCHASE_REQUEST_TRANSACTION1
       WHERE REQUEST_NUMBER = :request_number
         AND PRIN_CODE = :ls_prin_code
       ORDER BY ITEM_SEQUENCE_NO`,
      { request_number, ls_prin_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const itemRows = detailResult.rows || [];

    // 5️⃣ Fetch terms & conditions
    const termResult = await connection.execute(
      `SELECT request_number, supplier AS tsupplier, remarks, dlvr_term,
              payment_terms, quatation_reference, delivery_address
       FROM PR_SUPPL_TERM_COND
       WHERE request_number = :request_number`,
      { request_number },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const termRows = termResult.rows || [];

    // Helper: lowercase keys
    const mapLowerCase = (rows: any[]) =>
      rows.map((row) => {
        const obj: any = {};
        Object.keys(row).forEach((k) => (obj[k.toLowerCase()] = row[k]));
        return obj;
      });

    const headerLower = mapLowerCase([headerRow])[0];
    headerLower.request_number = request_number_display; // frontend display

    res.status(200).json({
      success: true,
      data: {
        header: headerLower,
        items: mapLowerCase(itemRows),
        termscondition: mapLowerCase(termRows),
      },
    });

  } catch (error: any) {
    console.error("Error in getPurchaserequest:", error);
    res.status(500).json({ success: false, message: error.message || "Internal server error" });
  } finally {
    if (connection) {
      try { await connection.close(); } 
      catch (err) { console.error("Failed to close connection:", err); }
    }
  }
};
