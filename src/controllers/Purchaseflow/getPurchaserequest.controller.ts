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
              description, type_of_contract,     NVL(amc_from, TO_DATE('1900-01-01','YYYY-MM-DD')) AS amc_from,
    NVL(amc_to, TO_DATE('1900-01-01','YYYY-MM-DD')) AS amc_to,
              type_of_material_supply, wo_number, NVL(remarks,''), project_code,
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

    // 6️⃣ Convert keys to lowercase
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

    // 7️⃣ Format the response structure to match the front-end model
    const formattedResponse = {
      requestor_name: headerLower.requestor_name || '',
      div_code: headerLower.div_code || '',
      request_number: headerLower.request_number || '',
      request_date: headerLower.request_date || new Date(),
      need_by_date: headerLower.need_by_date || new Date(),
      description: headerLower.description || '',
        remarks: headerLower.description || '',
        amc_from:headerLower.amc_from || null,
          amc_to:headerLower.amc_to || null,
      wo_number: headerLower.wo_number || '',
      type_of_contract: headerLower.type_of_contract || '',
      type_of_material_supply: headerLower.type_of_material_supply || 'N/A',
      contract_soft_hard: headerLower.contract_soft_hard || 'N/A',
      service_type: headerLower.service_type || 'N/A',
      amc_service_status: headerLower.amc_service_status || 'N/A',
      flow_level_running: headerLower.flow_level_running || 1,
      material_mechanical: headerLower.material_mechanical || 'N',
      material_electrical: headerLower.material_electrical || 'N',
      material_plumbing: headerLower.material_plumbing || 'N',
      material_tools: headerLower.material_tools || 'N',
      material_civil: headerLower.material_civil || 'N',
      material_ac: headerLower.material_ac || 'N',
      material_cleaning: headerLower.material_cleaning || 'N',
      material_other: headerLower.material_other || 'N',
      services_temp_staff: headerLower.services_temp_staff || 'N',
      services_rentals: headerLower.services_rentals || 'N',
      services_subcon_conslt: headerLower.services_subcon_conslt || 'N',
      services_other: headerLower.services_other || 'N',
      other_stationery: headerLower.other_stationery || 'N',
      other_it: headerLower.other_it || 'N',
      other_new_uniform_ppe: headerLower.other_new_uniform_ppe || 'N',
      other_rplcmt_uniform: headerLower.other_rplcmt_uniform || 'N',
      other_other: headerLower.other_other || 'N',
      good_material_request: headerLower.good_material_request || 'N',
      service_request: headerLower.service_request || 'N',
      project_code: headerLower.project_code || '',
      company_code: headerLower.company_code || '',
      created_by: headerLower.created_by || '',
      updated_by: headerLower.updated_by || '',
      last_action: headerLower.last_action || '',
      created_at: headerLower.created_at || new Date(),
      updated_at: headerLower.updated_at || new Date(),
      fa_uploaded: headerLower.fa_uploaded || 'N',
      final_approved: headerLower.final_approved || 'No',
      type_of_pr: headerLower.type_of_pr || '',
      covered_by_contract_yes: headerLower.covered_by_contract_yes || 'N/A',
      flag_sharing_cost: headerLower.flag_sharing_cost || 'N/A',
      budgeted_yes: headerLower.budgeted_yes || 'N/A',
      checked_store_yes: headerLower.checked_store_yes || 'N/A',
      amount: headerLower.amount || 0,

      // Div_code 10 related items
      accommodation: headerLower.accommodation || 'N',
      catering: headerLower.catering || 'N',
      laundry_housekeeping: headerLower.laundry_housekeeping || 'N',
      medical: headerLower.medical || 'N',
      transportation: headerLower.transportation || 'N',
      training: headerLower.training || 'N',
      recruitment_hr: headerLower.recruitment_hr || 'N',
      uniform: headerLower.uniform || 'N',
      stationary: headerLower.stationary || 'N',
      it_tech: headerLower.it_tech || 'N',
      furniture: headerLower.furniture || 'N',
      entertainment: headerLower.entertainment || 'N',
      barber: headerLower.barber || 'N',
      others: headerLower.others || 'N',

      items: itemsLower,
      Termscondition: termsLower,
    };

    // 8️⃣ Send response
    res.json({
      success: true,
      data: formattedResponse,
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
