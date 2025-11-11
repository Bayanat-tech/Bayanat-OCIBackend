import axios from "axios";
import https from "https";
import { LeaveRequestFlow } from "../interfaces/leaveRequestFlow.interface";
import { oracleDb } from "../database/connection";
import { RequestWithUser } from "../interfaces/common.interface";
import { IUser } from "../interfaces/user.interface";
import constants from "../helpers/constants";

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const API_BASE_URL = process.env.NET_API_BASE_URL?.trim();
const API_KEY = process.env.NET_API_KEY?.trim();

const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  httpsAgent,
  headers: {
    XApiKey: API_KEY,
    "Content-Type": "application/json",
    accept: "*/*",
  },
  timeout: 30000,
  validateStatus: (status) => status < 500,
});

// Add helper function for date handling
function formatDate(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  if (typeof date === "string") {
    return date === "0000-00-00" ? null : date;
  }
  if (date instanceof Date) {
    return date.toISOString().split("T")[0];
  }
  return null;
}

function formatDateTime(date: string | Date | null | undefined): string | null {
  if (!date) return null;
  if (typeof date === "string") {
    // Handle existing datetime string
    if (date.includes(" ")) {
      const [datePart] = date.split(" ");
      return datePart;
    }
    return date === "0000-00-00" ? null : date;
  }
  if (date instanceof Date) {
    return date.toISOString().split("T")[0];
  }
  return null;
}

export interface LeaveResumeDatesUpdate {
  requestNumber: string;
  dutyResumeDate?: Date | null;
  actualResumeDate?: Date | null;
}

export const HrService = {
  
  getEmployees: async (
    name?: string,
    loginid?: string,
    supervisor_empid?: string
  ) => {
    const params: Record<string, string> = {};
    if (name) params.name = name;
    if (loginid) params.loginid = loginid;
    if (supervisor_empid) params.supervisor_empid = supervisor_empid;

    console.log("Fetching employees with params:", params);
    const response = await axiosInstance.get("/api/EmployeeLeave/employees", {
      params,
    });
    return response.data;
  },


  getLeaveBalance: async (employeeId: string) => {
    const response = await axiosInstance.get(
      `/api/EmployeeLeave/leavebalance/${employeeId}`
    );
    return response.data;
  },
  getLeaveEntitle: async (employeeId: string) => {
    const response = await axiosInstance.get(
      `/api/EmployeeLeave/leaveentitle/${employeeId}`
    );
    return response.data;
  },
  getLeaveHistory: async (params: {
    employeeId?: string;
    leaveType?: string;
    leaveStartDateFrom?: string;
    leaveStartDateTo?: string;
    leaveEndDateFrom?: string;
    leaveEndDateTo?: string;
    orderBy?: string;
  }) => {
    const response = await axiosInstance.get(
      "/api/EmployeeLeave/leavehistory",
      {
        params,
      }
    );
    return response.data;
  },






newValidaterequest: async(params: {
  leaveStartDate: string;
  employeeId: string;
  leaveType: string;
}) => {
  const { leaveStartDate, employeeId , leaveType } = params;

  console.log("Input leaveStartDate:", leaveStartDate); // '12-11-2025' (DD-MM-YYYY)

  // Your date is already in DD-MM-YYYY format, no conversion needed!
  const formattedDate = leaveStartDate; // Keep as '12-11-2025'

  const query = `
    DECLARE
      v_result VARCHAR2(10);
    BEGIN
      v_result := FN_UPDATE_REPORT_DATE(
        NULL,
        NULL,
        NULL,
         TO_DATE(:leaveDate, 'DD-MM-YYYY'),
        NULL
      );
      
      -- Store result in a temporary table to retrieve it
      INSERT INTO TEMP_FUNCTION_RESULT (RESULT_VALUE) VALUES (v_result);
      COMMIT;
    END;
  `;

  const bindParams = {
    leaveDate: formattedDate
  };

  console.log("PL/SQL Block:", query);
  console.log("Bind Parameters:", bindParams);



//   // Helper function to get leave balances
// async function getLeaveBalances(employeeId: string) {
//   const balanceQuery = `
//     SELECT LEAVE_TYPE, NO_OF_LEAVES_AVAILABLE 
//     FROM VW_HR_LEAVE_YEARLY_BALANCE_AWARE 
//     WHERE EMPLOYEE_ID = :employeeId 
//     AND LEAVE_TYPE IN ('AL', '014', '015', '016', '018', '013')
//     ORDER BY LEAVE_TYPE
//   `;

//   const bindParams = {
//     employeeId: employeeId
//   };

//   console.log("Leave Balance Query:", balanceQuery);
//   console.log("Balance Bind Parameters:", bindParams);

//   try {
//     const result = await oracleDb.query(balanceQuery, bindParams);
    
//     // Convert rows to a more usable format
//     const balances: { [key: string]: number } = {};
//     result.rows.forEach((row: any) => {
//       balances[row.LEAVE_TYPE] = row.NO_OF_LEAVES_AVAILABLE;
//     });

//     return {
//       success: true,
//       balances: balances,
//       rawData: result.rows
//     };

//   } catch (error: any) {
//     console.error("Error fetching leave balances:", error);
//     return {
//       success: false,
//       error: error.message,
//       balances: null
//     };
//   }
// }

// Helper function to get only the requested leave type balance
async function getLeaveBalances(employeeId: string, leaveType: string) {
  const balanceQuery = `
    SELECT NO_OF_LEAVES_AVAILABLE 
    FROM VW_HR_LEAVE_YEARLY_BALANCE_AWARE 
    WHERE EMPLOYEE_ID = :employeeId 
    AND LEAVE_TYPE = :leaveType
  `;

  const bindParams = {
    employeeId: employeeId,
    leaveType: leaveType
  };

  console.log("Requested Leave Balance Query:", balanceQuery);
  console.log("Balance Bind Parameters:", bindParams);

  try {
    const result = await oracleDb.query(balanceQuery, bindParams);
    
    if (result.rows.length === 0) {
      console.log(`No balance found for employee ${employeeId} and leave type ${leaveType}`);
      return null;
    }

    const balance = result.rows[0]?.NO_OF_LEAVES_AVAILABLE;
    console.log(`Found balance for ${leaveType}:`, balance);

    return balance;

  } catch (error: any) {
    console.error("Error fetching requested leave balance:", error);
    return null;
  }
}

  try {
    // First, ensure temp table exists
    await ensureTempTableExists();
    
    // Execute the function
    await oracleDb.query(query, bindParams);
    
    // Retrieve the result
    const resultQuery = `SELECT RESULT_VALUE as function_result FROM TEMP_FUNCTION_RESULT WHERE ROWNUM = 1`;
    const result = await oracleDb.query(resultQuery, {});
    const functionResult = result.rows[0]?.FUNCTION_RESULT;

    // Clean up
    await oracleDb.query(`DELETE FROM TEMP_FUNCTION_RESULT WHERE ROWNUM = 1`, {});

    let leaveBalances = null;

    // If function returned "OK", then get leave balances
    if (functionResult === 'OK') {
      leaveBalances = await getLeaveBalances(employeeId, leaveType);
    }


    

    return {
      success: true,
      leaveType: leaveType,
      functionResult: functionResult,
      leaveStartDate: leaveStartDate,
      formattedDate: formattedDate,
      availableBalance: leaveBalances,
      message: 'Validation Successful'
    };

  } catch (error: any) {
    console.error("Error in newValidaterequest:", error);
    return {
      success: false,
      functionResult: null,
      leaveStartDate: leaveStartDate,
      message: `Validation failed: ${error.message}`
    };
  }
},




  validateLeave: async (params: {
    companyCode: string;
    employeeId: string;
    leaveStartDate: string;
    leaveEndDate: string;
    leaveType: string;
    leaveDays: number;
  }) => {
    const response = await axiosInstance.get(

      
      "/api/EmployeeLeave/validateleave",
      {
        params,
      }
    );
    return response.data;
  },







  insertLeaveRequest: async (request: LeaveRequestFlow) => {
    try {
      const formattedRequest = {
        RequestNumber: request.requestNumber || "",
        CurrentStep: request.currentStep || "",
        CompanyCode: request.companyCode || "",
        EmployeeCode: request.employeeCode || "",
        LeaveRequestDate: formatDateTime(request.leaveRequestDate),
        TravelDate: formatDateTime(request.travelDate),
        LeaveType: request.leaveType || "",
        LeaveStartDate: formatDateTime(request.leaveStartDate),
        LeaveEndDate: formatDateTime(request.leaveEndDate),
        LeaveDays: Number(request.leaveDays) || 0,
        LeaveReason: request.leaveReason || "",
        DaysAdjusted: Number(request.daysAdjusted) || 0,
        HalfDay: request.halfDay || "",
        AirTicket: request.airTicket || "",
        AirTicketSelf: request.airTicketSelf || "",
        AirTicketWife: request.airTicketWife || "",
        AirTicketChildren: Number(request.airTicketChildren) || 0,
        RequestDate: formatDateTime(request.requestDate),
        FlowCode: request.flowCode || "",
        FlowLevelInitial: Number(request.flowLevelInitial) || 0,
        FlowLevelRunning: Number(request.flowLevelRunning) || 0,
        FlowLevelFinal: Number(request.flowLevelFinal) || 0,
        FaUploaded: request.faUploaded || "",
        FinalApproved: request.finalApproved === "YES" ? "YES" : "NO",
        CreateUser: request.createUser || "",
        CreateDate: formatDateTime(request.createDate),
        LastUpdated: request.lastUpdated || "",
        LastAction: request.lastAction || "",
        HistorySerial: Number(request.historySerial) || 0,
        CancelFlag: request.cancelFlag || "",
        CancelUser: request.cancelUser || "",
        CancelDate: formatDateTime(request.cancelDate),
        CancelRemark: request.cancelRemark || "",
        RemarksHistry: request.remarksHistry || "",
        Remarks: request.remarks || "",
        Description: request.description || "",
        Comments: request.comments || "",
        MobileAppUpdate: request.mobileAppUpdate || "N",
        UpdatedAt: formatDateTime(request.updatedAt),
        UpdatedBy: request.updatedBy || "",
        CreatedBy: request.createdBy || "",
        CreatedAt: formatDateTime(request.createdAt),
        Hod: request.hod || "",
        DeptHead: request.deptHead || "",
        ImmediateSupervisor: request.immediateSupervisor || "",
        LogNumber: Number(request.logNumber) || 0,
        NextActionBy: request.nextActionBy || "",
        LeaveAllowance: request.leaveAllowance || "",
        AdvPayment: request.advPayment || "",
        CauseType: request.causeType || "",
        NameOfReplacement: request.nameOfReplacement || "",
        ContactDetailsDuringLeave: request.contactDetailsDuringLeave || "",
        DutyResumeDate: formatDateTime(request.dutyResumeDate),
        ActualResumeDate: formatDateTime(request.actualResumeDate),
        EmployeeName: request.employeeName || "",
      };

      console.log(
        "Formatted request:",
        JSON.stringify(formattedRequest, null, 2)
      );

      if(request.finalApproved === "YES"){
        const response = await axiosInstance.post(
          "/api/EmployeeLeave/insertLeaveRequest",
          formattedRequest
        );
   

      console.log("API Response:", {
        status: response.status,
        statusText: response.statusText,
        data: response.data,
      });

      if (response.status >= 400) {
        throw new Error(
          `API Error: ${response.status} ${
            response.statusText
          }\nDetails: ${JSON.stringify(response.data)}`
        );
      }
      

      return response.data;
         }else{
          return ;
         }
    } catch (error: any) {
      console.error("Error in insertLeaveRequest:", {
        message: error.message,
        response: error.response?.data,
        config: {
          url: error.config?.url,
          method: error.config?.method,
          headers: error.config?.headers,
        },
      });
      throw error;
    }
  },
  updateLeaveResume: async (request: LeaveResumeDatesUpdate): Promise<any> => {
    try {
      // Transform to match .NET API expectations
      const payload = {
        RequestNumber: request.requestNumber,
        DutyResumeDate: request.dutyResumeDate,
        ActualResumeDate: request.actualResumeDate,
      };

      const response = await axiosInstance.patch(
        "/api/EmployeeLeave/updateResumeDates",
        payload
      );
      return response.data;
    } catch (error: any) {
      console.error("Error in updateLeaveResume:", error);
      throw error;
    }
  },
  getLeaveRequestsWithErpDoc: async (employeeCode: string) => {
    const response = await axiosInstance.get(
      `/api/EmployeeLeave/GET_LEAVE_REQUESTS_WITH_ERP_DOC`,
      {
        params: { employee_code: employeeCode },
      }
    );
    return response.data;
  },
};




// Helper function to ensure temp table exists
async function ensureTempTableExists(): Promise<void> {
  const createTableQuery = `
    BEGIN
      EXECUTE IMMEDIATE '
        CREATE TABLE TEMP_FUNCTION_RESULT (
          RESULT_VALUE VARCHAR2(100),
          CREATED_DATE DATE DEFAULT SYSDATE
        )
      ';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -955 THEN -- table already exists
          RAISE;
        END IF;
    END;
  `;

  try {
    await oracleDb.query(createTableQuery, {});
  } catch (error:any) {
    // Ignore "table already exists" errors
    if (!error.message?.includes('-955')) {
      console.error("Error creating temp table:", error);
    }
  }
}




