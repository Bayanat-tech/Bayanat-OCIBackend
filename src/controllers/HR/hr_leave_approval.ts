import { oracleDb } from "../../database/connection";
import { Request, Response } from "express";
import constants from "../../helpers/constants";
import { HrService } from "../../services/hr.service";
import { TLeaveApproval } from "../../interfaces/Hr/hr_leave_approval";

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

function toOracleDate(dateInput?: string | Date | null): string | null {
  if (!dateInput) return null;

  try {
    let dateObj: Date;

    if (dateInput instanceof Date) {
      dateObj = dateInput;
    } else if (typeof dateInput === "string") {
      // Handle different date formats
      const cleanDate = dateInput.replace(/T.+/, "");
      const [year, month, day] = cleanDate.split("-").map(Number);

      if (!year || !month || !day) {
        console.error("Invalid date components:", { year, month, day });
        return null;
      }

      dateObj = new Date(year, month - 1, day);

      if (isNaN(dateObj.getTime())) {
        console.error("Invalid date object created from:", dateInput);
        return null;
      }
    } else {
      console.error("Unsupported date input type:", typeof dateInput);
      return null;
    }

    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, "0");
    const day = String(dateObj.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  } catch (error) {
    console.error("Error converting date:", dateInput, error);
    return null;
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryOnDeadlock<T>(
  operation: () => Promise<T>,
  retries = MAX_RETRIES
): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    if (retries > 0 && error.errorNum === 60) {
      await sleep(RETRY_DELAY);
      return retryOnDeadlock(operation, retries - 1);
    }
    throw error;
  }
}

export async function upsertLeaveApproval(
  data: TLeaveApproval
): Promise<string> {
  try {
    const result = await oracleDb.withTransaction(async (connection) => {
      const exists = await recordExists(
        data.REQUEST_NUMBER,
        data.COMPANY_CODE,
        connection
      );

      if (exists) {
        await updateLeaveApproval(data, connection);
      } else {
        await insertLeaveApproval(data, connection);
      }

      return data.REQUEST_NUMBER;
    });

    processApprovedLeaveRequestsForSingleRecord(
      data.REQUEST_NUMBER,
      data.COMPANY_CODE
    ).catch((error) => {
      console.error("Background processing failed:", error);
    });

    return result;
  } catch (error) {
    console.error("Error in upsertLeaveApproval:", error);
    throw error;
  }
}

export async function processApprovedLeaveRequestsForSingleRecord(
  requestNumber: string,
  companyCode: string
): Promise<void> {
  try {
    console.log("Processing single record:", { requestNumber, companyCode });

    await processApprovedLeaveRequests({
      specificRequestNumber: requestNumber,
      specificCompanyCode: companyCode,
    });
  } catch (error) {
    console.error("Error processing single record:", {
      requestNumber,
      companyCode,
      error:
        typeof error === "object" && error !== null && "message" in error
          ? (error as any).message
          : String(error),
    });
  }
}

async function recordExists(
  requestNumber: string,
  companyCode: string,
  connection: any
): Promise<boolean> {
  const sql = `
    SELECT COUNT(*) AS cnt 
    FROM LEAVE_REQUEST_FLOW 
    WHERE REQUEST_NUMBER = :request_number 
    AND COMPANY_CODE = :company_code
  `;

  const result = await oracleDb.query(
    sql,
    {
      request_number: { val: requestNumber },
      company_code: { val: companyCode },
    },
    connection
  );

  return (result.rows?.[0]?.CNT || 0) > 0;
}

async function updateLeaveApproval(data: TLeaveApproval, connection: any) {
  const sql = `
    UPDATE LEAVE_REQUEST_FLOW SET
      EMPLOYEE_NAME = NVL(:employee_name, EMPLOYEE_NAME),
        EMPLOYEE_CODE = NVL(:employee_code, EMPLOYEE_CODE),
      HALF_DAY = NVL(:half_day, HALF_DAY),
      DUTY_RESUME_DATE = CASE WHEN :duty_resume_date IS NOT NULL 
                             THEN TO_DATE(:duty_resume_date, 'YYYY-MM-DD')
                             ELSE DUTY_RESUME_DATE END,
      ACTUAL_RESUME_DATE = CASE WHEN :actual_resume_date IS NOT NULL 
                               THEN TO_DATE(:actual_resume_date, 'YYYY-MM-DD')
                               ELSE ACTUAL_RESUME_DATE END,
      LEAVE_ALLOWANCE = NVL(:leave_allowance, LEAVE_ALLOWANCE),
      ADV_PAYMENT = NVL(:adv_payment, ADV_PAYMENT),
      CAUSE_TYPE = NVL(:cause_type, CAUSE_TYPE),
      TRAVEL_DATE = CASE WHEN :travel_date IS NOT NULL 
                        THEN TO_DATE(:travel_date, 'YYYY-MM-DD')
                        ELSE TRAVEL_DATE END,
      NAME_OF_REPLACEMENT = NVL(:name_of_replacement, NAME_OF_REPLACEMENT),
      CONTACT_DETAILS_DURING_LEAVE = NVL(:contact_details, CONTACT_DETAILS_DURING_LEAVE),
      REMARKS = NVL(:remarks, REMARKS),
      HOD = NVL(:hod, HOD),
      IMMEDIATE_SUPERVISOR = NVL(:immediate_supervisor, IMMEDIATE_SUPERVISOR),
      DEPT_HEAD = NVL(:dept_head, DEPT_HEAD),
      REQUEST_DATE = CASE WHEN :request_date IS NOT NULL 
                         THEN TO_DATE(:request_date, 'YYYY-MM-DD')
                         ELSE REQUEST_DATE END,
      LEAVE_TYPE = NVL(:leave_type, LEAVE_TYPE),
      LEAVE_START_DATE = CASE WHEN :leave_start_date IS NOT NULL 
                             THEN TO_DATE(:leave_start_date, 'YYYY-MM-DD')
                             ELSE LEAVE_START_DATE END,
      LEAVE_END_DATE = CASE WHEN :leave_end_date IS NOT NULL 
                           THEN TO_DATE(:leave_end_date, 'YYYY-MM-DD')
                           ELSE LEAVE_END_DATE END,
      LEAVE_DAYS = NVL(:leave_days, LEAVE_DAYS),
      LAST_ACTION = NVL(:last_action, LAST_ACTION),
      NEXT_ACTION_BY = NVL(:next_action_by, NEXT_ACTION_BY), 
      SENTBACK_HISTORY = NVL(:sentback_history, SENTBACK_HISTORY), 
      UPDATED_BY = :updated_by,
      UPDATED_AT = SYSTIMESTAMP
    WHERE COMPANY_CODE = :company_code 
    AND REQUEST_NUMBER = :request_number
  `;

  const params = {
    employee_name: { val: data.EMPLOYEE_NAME },
    half_day: { val: data.HALF_DAY || "N" },
    duty_resume_date: { val: toOracleDate(data.DUTY_RESUME_DATE) || "" },
    actual_resume_date: { val: toOracleDate(data.ACTUAL_RESUME_DATE) || "" },
    leave_allowance: { val: data.LEAVE_ALLOWANCE },
    adv_payment: { val: data.ADV_PAYMENT },
    cause_type: { val: data.CAUSE_TYPE },
    travel_date: { val: toOracleDate(data.TRAVEL_DATE) || "" },
    name_of_replacement: { val: data.NAME_OF_REPLACEMENT },
    contact_details: { val: data.CONTACT_DETAILS_DURING_LEAVE },
    remarks: { val: data.REMARKS },
    hod: { val: data.HOD },
    immediate_supervisor: { val: data.IMMEDIATE_SUPERVISOR },
    dept_head: { val: data.DEPT_HEAD },
    request_date: { val: toOracleDate(data.REQUEST_DATE) || "" },
    employee_code: { val: data.EMPLOYEE_CODE },
    leave_type: { val: data.LEAVE_TYPE },
    leave_start_date: { val: toOracleDate(data.LEAVE_START_DATE) || "" },
    leave_end_date: { val: toOracleDate(data.LEAVE_END_DATE) || " " },
    leave_days: { val: data.LEAVE_DAYS },
    last_action: { val: data.LAST_ACTION },
    updated_by: { val: data.UPDATED_BY },
    company_code: { val: data.COMPANY_CODE },
    request_number: { val: data.REQUEST_NUMBER },
    next_action_by: { val: data.NEXT_ACTION_BY || "" },
    sentback_history: { val: data.SENTBACK_HISTORY || "" },
  };
  console.log("Update parameters:", JSON.stringify(params, null, 2));
  console.log("Update sql:", sql); 

  await oracleDb.query(sql, params, connection);
}

const formatDate = (date: string | number | Date | undefined) => {
  if (!date) return null;

  // If it's already a Date object
  if (date instanceof Date) {
    return date.toISOString().split("T")[0];
  }

  // If it's a string, try to parse it
  const parsedDate = new Date(date);
  if (!isNaN(parsedDate.getTime())) {
    return parsedDate.toISOString().split("T")[0];
  }

  return null;
};

async function insertLeaveApproval(data: TLeaveApproval, connection: any) {
  // Validate required dates
  console.log(
    "before date conversion",
    data.LEAVE_START_DATE,
    data.LEAVE_END_DATE
  );
  const leaveStartDate = toOracleDate(data.LEAVE_START_DATE);
  if (!leaveStartDate) {
    throw new Error("LEAVE_START_DATE is required and must be a valid date");
  }

  const leaveEndDate = toOracleDate(data.LEAVE_END_DATE);
  if (!leaveEndDate) {
    throw new Error("LEAVE_END_DATE is required and must be a valid date");
  }
  console.log(
    "after date conversion",
    data.LEAVE_START_DATE,
    data.LEAVE_END_DATE
  );

  const sql = `
 INSERT INTO LEAVE_REQUEST_FLOW (
    EMPLOYEE_NAME, HALF_DAY, DUTY_RESUME_DATE, ACTUAL_RESUME_DATE,
    LEAVE_ALLOWANCE, ADV_PAYMENT, CAUSE_TYPE, TRAVEL_DATE,
    NAME_OF_REPLACEMENT, CONTACT_DETAILS_DURING_LEAVE, REMARKS, 
    FLOW_CODE, HOD, UPDATED_BY, IMMEDIATE_SUPERVISOR, DEPT_HEAD,
    COMPANY_CODE, REQUEST_NUMBER, REQUEST_DATE,
    EMPLOYEE_CODE, LEAVE_TYPE, LEAVE_START_DATE, LEAVE_END_DATE,
    LEAVE_DAYS, LAST_ACTION, CURRENT_STEP, FLOW_LEVEL_INITIAL, FLOW_LEVEL_RUNNING, CREATE_USER, CREATE_DATE,
    CREATED_BY, CREATED_AT, FLOW_LEVEL_FINAL  -- 33 columns
  ) VALUES (
    :employee_name, :half_day, 
    CASE WHEN :duty_resume_date IS NOT NULL THEN TO_DATE(:duty_resume_date, 'YYYY-MM-DD') ELSE NULL END,
    CASE WHEN :actual_resume_date IS NOT NULL THEN TO_DATE(:actual_resume_date, 'YYYY-MM-DD') ELSE NULL END,
    :leave_allowance, :adv_payment, :cause_type,
    CASE WHEN :travel_date IS NOT NULL THEN TO_DATE(:travel_date, 'YYYY-MM-DD') ELSE NULL END,
    :name_of_replacement, :contact_details, :remarks, 
    :flow_code, :hod, :updated_by, :immediate_supervisor, :dept_head,
    :company_code, :request_number,
    TO_DATE(:request_date, 'YYYY-MM-DD'),
    :employee_code, :leave_type,
    TO_DATE(:leave_start_date, 'YYYY-MM-DD'),
    TO_DATE(:leave_end_date, 'YYYY-MM-DD'),
    :leave_days, :last_action, 1, 1, 4, :create_user, SYSDATE, 
    :created_by, SYSDATE, 4  -- 33 values (added the last '4')
  )
`;

  const params = {
    employee_name: { val: data.EMPLOYEE_NAME },
    half_day: { val: data.HALF_DAY || "N" },
    duty_resume_date: { val: toOracleDate(data.DUTY_RESUME_DATE) || null },
    actual_resume_date: { val: toOracleDate(data.ACTUAL_RESUME_DATE) || null },
    leave_allowance: { val: data.LEAVE_ALLOWANCE },
    adv_payment: { val: data.ADV_PAYMENT },
    cause_type: { val: data.CAUSE_TYPE },
    travel_date: { val: toOracleDate(data.TRAVEL_DATE) || "" },
    name_of_replacement: { val: data.NAME_OF_REPLACEMENT },
    contact_details: { val: data.CONTACT_DETAILS_DURING_LEAVE },
    remarks: { val: data.REMARKS },
    flow_code: { val: "004" },
    hod: { val: data.HOD },
    updated_by: { val: data.UPDATED_BY },
    immediate_supervisor: { val: data.IMMEDIATE_SUPERVISOR },
    dept_head: { val: data.DEPT_HEAD },
    company_code: { val: data.COMPANY_CODE },
    request_number: { val: data.REQUEST_NUMBER },
    request_date: {
      val: toOracleDate(data.REQUEST_DATE) || leaveStartDate || "",
    },
    employee_code: { val: data.EMPLOYEE_CODE },
    leave_type: { val: data.LEAVE_TYPE },
    leave_start_date: { val: leaveStartDate },
    leave_end_date: { val: leaveEndDate },
    leave_days: { val: data.LEAVE_DAYS },
    last_action: { val: data.LAST_ACTION },
    create_user: { val: data.UPDATED_BY },
    created_by: { val: data.CREATED_BY },
  };

  // Debug: log parameters
  console.log("Parameters for insert:", JSON.stringify(params, null, 2));

  // Right before the try-catch block, add:
console.log("📋 TOAD-READY SQL:");
console.log("--------------------------------------------------");
console.log(`INSERT INTO LEAVE_REQUEST_FLOW (
  EMPLOYEE_NAME, HALF_DAY, DUTY_RESUME_DATE, ACTUAL_RESUME_DATE,
  LEAVE_ALLOWANCE, ADV_PAYMENT, CAUSE_TYPE, TRAVEL_DATE,
  NAME_OF_REPLACEMENT, CONTACT_DETAILS_DURING_LEAVE, REMARKS, 
  FLOW_CODE, HOD, UPDATED_BY, IMMEDIATE_SUPERVISOR, DEPT_HEAD,
  COMPANY_CODE, REQUEST_NUMBER, REQUEST_DATE,
  EMPLOYEE_CODE, LEAVE_TYPE, LEAVE_START_DATE, LEAVE_END_DATE,
  LEAVE_DAYS, LAST_ACTION, CURRENT_STEP, FLOW_LEVEL_INITIAL, FLOW_LEVEL_RUNNING, CREATE_USER, CREATE_DATE,
  CREATED_BY, CREATED_AT, FLOW_LEVEL_FINAL
) VALUES (
  '${data.EMPLOYEE_NAME}', '${data.HALF_DAY || "N"}', 
  ${data.DUTY_RESUME_DATE ? `TO_DATE('${toOracleDate(data.DUTY_RESUME_DATE)}', 'YYYY-MM-DD')` : 'NULL'},
  ${data.ACTUAL_RESUME_DATE ? `TO_DATE('${toOracleDate(data.ACTUAL_RESUME_DATE)}', 'YYYY-MM-DD')` : 'NULL'},
  '${data.LEAVE_ALLOWANCE}', '${data.ADV_PAYMENT}', '${data.CAUSE_TYPE}',
  ${data.TRAVEL_DATE ? `TO_DATE('${toOracleDate(data.TRAVEL_DATE)}', 'YYYY-MM-DD')` : 'NULL'},
  '${data.NAME_OF_REPLACEMENT}', '${data.CONTACT_DETAILS_DURING_LEAVE}', '${data.REMARKS}', 
  '004', '${data.HOD}', '${data.UPDATED_BY}', '${data.IMMEDIATE_SUPERVISOR}', '${data.DEPT_HEAD}',
  '${data.COMPANY_CODE}', '${data.REQUEST_NUMBER}',
  TO_DATE('${toOracleDate(data.REQUEST_DATE) || leaveStartDate}', 'YYYY-MM-DD'),
  '${data.EMPLOYEE_CODE}', '${data.LEAVE_TYPE}',
  TO_DATE('${leaveStartDate}', 'YYYY-MM-DD'),
  TO_DATE('${leaveEndDate}', 'YYYY-MM-DD'),
  ${data.LEAVE_DAYS}, '${data.LAST_ACTION}', 1, 1, 4, '${data.UPDATED_BY}', SYSDATE, 
  '${data.CREATED_BY}', SYSDATE, 4
)`);
console.log("--------------------------------------------------");

  try {
    await oracleDb.query(sql, params, connection);
  } catch (error: any) {
    console.error("Insert error:", error);
    if (error.message.includes("ORA-01400")) {
      throw new Error(`Required field cannot be null: ${error.message}`);
    }
    throw error;
  }
}

// === Express handler ===
export const upsertLeaveApprovalHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const data: TLeaveApproval = req.body;

    const requiredFields: (keyof TLeaveApproval)[] = [
      "COMPANY_CODE",
      "REQUEST_NUMBER",
      "EMPLOYEE_CODE",
      "LEAVE_TYPE",
      "LEAVE_START_DATE",
      "LEAVE_END_DATE",
      "REQUEST_DATE",
      "CREATED_BY",
      "UPDATED_BY",
    ];

    console.log("Upsert Leave Approval Request Data:", data);

    // const missingFields = requiredFields.filter((field) => !data[field]);

    // if (missingFields.length > 0) {
    //   res.status(constants.STATUS_CODES.BAD_REQUEST).json({
    //     success: false,
    //     message: `Missing required field(s): ${missingFields.join(", ")}`,
    //   });
    //   return;
    // }

    const leaveApprovalData: TLeaveApproval = {
      ...data,
      COMPANY_CODE: "BSG", // Hardcoded company code
    };

    const requestNumber = await upsertLeaveApproval(leaveApprovalData);
    console.log("LAST_ACTION", leaveApprovalData.LAST_ACTION); 

    let messageType = '';

    if (leaveApprovalData.LAST_ACTION === 'SAVEASDRAFT') {
      messageType = 'Saved as draft';
    } else if (leaveApprovalData.LAST_ACTION === 'SENDBACK') {
      messageType = 'Sent back';
    } else if (leaveApprovalData.LAST_ACTION === 'REJECTED') {
      messageType = 'Rejected';
    } else if (leaveApprovalData.LAST_ACTION === 'CANCEL') {
      messageType = 'Cancelled';
    } else if (leaveApprovalData.LAST_ACTION === 'SUBMITTED') {
      messageType = 'Submitted';
    } else {
      messageType = 'Updated';
    }


    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `${requestNumber} ${messageType} successfully.`,
      request_number: requestNumber,
    });
  } catch (error: any) {
    console.error("Upsert Leave Approval Error:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Failed to upsert leave approval.",
    });
  }
};

export async function processApprovedLeaveRequests(options?: {
  specificRequestNumber?: string;
  specificCompanyCode?: string;
}): Promise<void> {
  try {
    console.log("Starting to process approved leave requests...", options);

    let whereClause = "WHERE FINAL_APPROVED = 'YES'";
    const bindParams: Record<string, { val: string }> = {};

    if (options?.specificRequestNumber && options?.specificCompanyCode) {
      whereClause +=
        " AND REQUEST_NUMBER = :requestNumber AND COMPANY_CODE = :companyCode";
      bindParams.requestNumber = { val: options.specificRequestNumber };
      bindParams.companyCode = { val: options.specificCompanyCode };

      console.log("Using specific record filter:", {
        requestNumber: options.specificRequestNumber,
        companyCode: options.specificCompanyCode,
      });
    }

    // First verify data in database using Oracle-specific syntax
    const testData = await oracleDb.query(
      `SELECT COUNT(*) as total,
              COUNT(CASE WHEN DUTY_RESUME_DATE IS NOT NULL OR ACTUAL_RESUME_DATE IS NOT NULL THEN 1 END) as withDates,
              COUNT(CASE WHEN NVL(DATE_FLAG, 'N') = 'N' THEN 1 END) as needsProcessing
       FROM LEAVE_REQUEST_FLOW
       ${whereClause}`,
      bindParams
    );

    console.log("Database status:", testData.rows?.[0] || {});

    // Process resume date updates with Oracle date handling
    const resumeRequests = await oracleDb.query(
      `SELECT
        REQUEST_NUMBER as "requestNumber",
        TO_CHAR(DUTY_RESUME_DATE, 'YYYY-MM-DD') as "dutyResumeDate",
        TO_CHAR(ACTUAL_RESUME_DATE, 'YYYY-MM-DD') as "actualResumeDate",
        COMPANY_CODE as "companyCode",
        NVL(DATE_FLAG, 'N') as "dateFlag"
       FROM LEAVE_REQUEST_FLOW
       ${whereClause}
         AND (DUTY_RESUME_DATE IS NOT NULL OR ACTUAL_RESUME_DATE IS NOT NULL)
         AND NVL(DATE_FLAG, 'N') != 'Y'`,
      bindParams
    );

    console.log(
      `Found ${resumeRequests.rows?.length || 0} resume requests to process`
    );

    // Process resume dates
    for (const request of resumeRequests.rows || []) {
      try {
        await HrService.updateLeaveResume({
          requestNumber: request.requestNumber,
          dutyResumeDate: request.dutyResumeDate
            ? new Date(request.dutyResumeDate)
            : null,
          actualResumeDate: request.actualResumeDate
            ? new Date(request.actualResumeDate)
            : null,
        });

        await oracleDb.query(
          `UPDATE LEAVE_REQUEST_FLOW
           SET DATE_FLAG = 'Y',
               UPDATED_AT = SYSTIMESTAMP
           WHERE REQUEST_NUMBER = :requestNumber`,
          { requestNumber: { val: request.requestNumber } }
        );

        console.log(
          `Updated resume dates for request: ${request.requestNumber}`
        );
      } catch (error: any) {
        console.error("Failed to update resume dates:", {
          requestNumber: request.requestNumber,
          error: error.message,
        });
      }
    }

    // Process new leave requests with proper Oracle date and NULL handling
    const approvedRequests = await oracleDb.query(
      `SELECT
        NVL(REQUEST_NUMBER, '') as "requestNumber",
        NVL(COMPANY_CODE, '') as "companyCode",
        NVL(EMPLOYEE_CODE, '') as "employeeCode",
        TO_CHAR(LEAVE_START_DATE, 'YYYY-MM-DD') as "leaveStartDate",
        TO_CHAR(LEAVE_END_DATE, 'YYYY-MM-DD') as "leaveEndDate",
        TO_CHAR(REQUEST_DATE, 'YYYY-MM-DD') as "requestDate",
        NVL(LEAVE_TYPE, '') as "leaveType",
        NVL(LEAVE_DAYS, 0) as "leaveDays",
        NVL(REMARKS, '') as "remarks",
        NVL(LAST_ACTION, '') as "lastAction",
        TO_CHAR(CREATED_AT, 'YYYY-MM-DD HH24:MI:SS') as "createdAt",
        NVL(CREATED_BY, '') as "createdBy",
        NVL(DATA_TRANSFER, 'N') as "dataTransfer"
      FROM LEAVE_REQUEST_FLOW
      ${whereClause}
      AND NVL(DATA_TRANSFER, 'N') = 'N'`,
      bindParams
    );

    for (const request of approvedRequests.rows || []) {
      try {
        await HrService.insertLeaveRequest(request);

        await oracleDb.query(
          `UPDATE LEAVE_REQUEST_FLOW
           SET DATA_TRANSFER = 'Y',
               UPDATED_AT = SYSTIMESTAMP
           WHERE REQUEST_NUMBER = :requestNumber 
           AND COMPANY_CODE = :companyCode`,
          {
            requestNumber: { val: request.requestNumber },
            companyCode: { val: request.companyCode },
          }
        );

        console.log(`Successfully processed request: ${request.requestNumber}`);
      } catch (error: any) {
        console.error("Failed to process request:", {
          requestNumber: request.requestNumber,
          error: error.message,
        });
      }
    }
  } catch (error) {
    console.error("Error in processApprovedLeaveRequests:", error);
    throw error;
  }
}

// Save attachment

export const saveFileHR = async (
  req: Request,
  res: Response
): Promise<Response | void> => {
  const { request_number, files } = req.body;

  if (!request_number) {
    return res.status(400).json({
      success: false,
      message: "request_number is required.",
    });
  }

  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({
      success: false,
      message: "files must be a non-empty array.",
    });
  }

  const duplicateRecords: string[] = [];
  const successfulRecords: { org_file_name: string; sr_no: number }[] = [];

  try {
    for (const file of files) {
      const { org_file_name } = file;

      const duplicateCheckResult = await oracleDb.query(
        `SELECT COUNT(*) AS COUNT 
         FROM UPLOADED_FILES_DLTS_VH 
         WHERE request_number = :request_number AND org_file_name = :org_file_name`,
        {
          request_number: { val: request_number },
          org_file_name: { val: org_file_name },
        }
      );

      const count = duplicateCheckResult.rows?.[0]?.COUNT || 0;

      if (count > 0) {
        duplicateRecords.push(org_file_name);
        continue;
      }

      const {
        company_code,
        file_name,
        extensions,
        aws_file_locn,
        flow_level,
        modules,
        updated_by,
        created_by,
        user_file_name,
      } = file;

      await oracleDb.query(
        `INSERT INTO UPLOADED_FILES_DLTS_VH (
          company_code, request_number, file_name, extensions, org_file_name,
          aws_file_locn, flow_level, modules, updated_by, created_by, 
          user_file_name, created_at, updated_at
        ) VALUES (
          :company_code, :request_number, :file_name, :extensions, :org_file_name,
          :aws_file_locn, :flow_level, :modules, :updated_by, :created_by,
          :user_file_name, SYSDATE, SYSDATE
        )`,
        {
          company_code: { val: company_code || null },
          request_number: { val: request_number },
          file_name: { val: file_name || null },
          extensions: { val: extensions || null },
          org_file_name: { val: org_file_name || null },
          aws_file_locn: { val: aws_file_locn || null },
          flow_level: { val: flow_level || null },
          modules: { val: modules || null },
          updated_by: { val: updated_by || null },
          created_by: { val: created_by || null },
          user_file_name: { val: user_file_name || null },
        }
      );

      // Fetch SR_NO
      const srNoResult = await oracleDb.query(
        `SELECT SR_NO 
         FROM UPLOADED_FILES_DLTS_VH 
         WHERE request_number = :request_number 
         AND org_file_name = :org_file_name 
         ORDER BY created_at DESC 
         FETCH FIRST 1 ROW ONLY`,
        {
          request_number: { val: request_number },
          org_file_name: { val: org_file_name },
        }
      );

      const sr_no = srNoResult.rows?.[0]?.SR_NO;
      if (sr_no) {
        successfulRecords.push({ org_file_name, sr_no });
      }
    }

    return res.status(200).json({
      success: true,
      message: "File data processed successfully.",
      data: {
        successfulRecords,
        duplicateRecords,
      },
    });
  } catch (error) {
    console.error("Error storing file data:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while storing file data.",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
