
import * as oracledb from "oracledb";
import { oracleDb} from "../../../database/connection";
import { QueryExecutor } from "../../../database/QueryExecutor";

// Add helper function for date handling
// function formatDate(date: Date | string | null | undefined): string | null {
//   if (!date) return null;
//   if (typeof date === "string") {
//     return date === "0000-00-00" ? null : date;
//   }
//   if (date instanceof Date) {
//     return date.toISOString().split("T")[0];
//   }
//   return null;
// }

// function formatDateTime(date: string | Date | null | undefined): string | null {
//   if (!date) return null;
//   if (typeof date === "string") {
//     // Handle existing datetime string
//     if (date.includes(" ")) {
//       const [datePart] = date.split(" ");
//       return datePart;
//     }
//     return date === "0000-00-00" ? null : date;
//   }
//   if (date instanceof Date) {
//     return date.toISOString().split("T")[0];
//   }
//   return null;
// }

export interface LeaveResumeDatesUpdate {
  requestNumber: string;
  dutyResumeDate?: Date | null;
  actualResumeDate?: Date | null;
}

export const HrService = {
  getEmployeesUnder: async (supervisor_empid: string) => {
    try {
      const query = `
      SELECT * 
      FROM VW_HR_EMPLOYEE 
      WHERE
      EMP_STATUS IN ('P','C') 
      AND ( SUPERVISOR_EMPID = :supervisor_empid 
      OR DEPT_HEAD_EMPID = :supervisor_empid 
      OR MANGR_EMPID = :supervisor_empid )
    `;

      const bindParams = {
        supervisor_empid: supervisor_empid,
      };

      const result = await QueryExecutor.executeRawQuery(query, bindParams);

      if (!result || !result.rows || result.rows.length === 0) {
        console.warn(`No employees found under empid: ${supervisor_empid}`);
        return [];
      }

      return result.rows;
    } catch (error: any) {
      console.error(
        `Error fetching employees under empid ${supervisor_empid}:`,
        error.message,
      );
      return [];
    }
  },

  getLeaveEntitle: async (employeeId: string) => {
    console.log("leave register hit");
    try {
      const query = `
      SELECT * 
      FROM VW_HR_EMP_LEAVE_ENTITLE 
      WHERE EMPLOYEE_ID = :emp_id
    `;

      const bindParams = {
        emp_id: employeeId,
      };

      const result = await QueryExecutor.executeRawQuery(query, bindParams);

      if (!result || !result.rows || result.rows.length === 0) {
        console.warn(`No employees found under empid: ${employeeId}`);
        return [];
      }

      return result.rows;
    } catch (error: any) {
      console.error(
        `Error fetching employees under empid ${employeeId}:`,
        error.message,
      );
      return [];
    }
  },

 LeaveDaysCount: async (params: {
    company_code: string;
    employee_code: string;
    leaveStartDate: string;
    leaveEndDate: string;
    half_day:string;
    leaveType: string;
  }) => {
    const { leaveStartDate, leaveEndDate , leaveType , company_code , half_day , employee_code} = params;

    const query = `
    DECLARE
     v_leave_days NUMBER;
     BEGIN
        v_leave_days := FUN_CALCULATE_FINAL_LEAVE_DAYS(
          :p_company_code,
          :p_employee_code,
          TO_DATE(:leaveStartDate, 'DD-MM-YYYY'),
          TO_DATE(:leaveEndDate, 'DD-MM-YYYY'),
          :p_half_day,
          :p_leaveType
        );
      :p_leave_days := v_leave_days;
      END;
    `;
    
    const bindParams = {
      p_company_code: company_code,
      leaveStartDate: leaveStartDate,
      leaveEndDate: leaveEndDate,
      p_half_day: half_day,
      p_leaveType: leaveType,
      p_employee_code: employee_code,
      p_leave_days: {
        dir: oracledb.BIND_OUT,
        type: oracledb.NUMBER,
      },
    };

    try {
      const result = await QueryExecutor.executeRawQuery(query, bindParams);
      const leaveDays = (result.outBinds as any).p_leave_days;

      return {
        success: true,
        leaveStartDate: leaveStartDate,
        leaveEndDate: leaveEndDate,
        company_code: company_code,
        leaveDays: leaveDays,
        leaveType: leaveType,
        message: "Leave days calculated successfully",
      };
    }catch (error: string | any) {
      console.error("Error calculating leave days:", error);
      return {
        success: false,
        leaveStartDate: leaveStartDate,
        leaveEndDate: leaveEndDate,
        company_code: company_code,
        leaveDays: null,
        leaveType: leaveType,
        message: "Failed to calculate leave days",
      };
    }
  },

  MHvalidateLeave: async (params: {
    companyCode: string;
    employeeId: string;
    leaveStartDate: string;
    leaveEndDate: string;
    leaveType: string;
    leaveDays: number;
  }) => {
    const {
      companyCode,
      employeeId,
      leaveStartDate,
      leaveEndDate,
      leaveType,
      leaveDays,
    } = params;

    const query = `
      DECLARE
        v_result VARCHAR2(4000);
      BEGIN
        v_result := FN_HR_LEAVE_VALIDATION_V1(
          :p_COMPANY_CODE,
          :p_EMPLOYEE_ID,
          TO_DATE(:p_LEAVE_START_DATE, 'DD-MM-YYYY'),
          TO_DATE(:p_LEAVE_END_DATE, 'DD-MM-YYYY'),
          :p_LEAVE_TYPE,
          :p_LEAVE_DAYS
        );
        :p_RESULT := v_result;
      END;
    `;

    const bindParams = {
      p_COMPANY_CODE: companyCode,
      p_EMPLOYEE_ID: employeeId,
      p_LEAVE_START_DATE: leaveStartDate,
      p_LEAVE_END_DATE: leaveEndDate,
      p_LEAVE_TYPE: leaveType,
      p_LEAVE_DAYS: leaveDays,
      p_RESULT: {
        dir: oracledb.BIND_OUT,
        type: oracledb.STRING,
        maxSize: 4000,
      },
    };

    try {
      const result = await QueryExecutor.executeRawQuery(query, bindParams);
      const rawResult: string = ((result.outBinds as any).p_RESULT ?? "").trim();

      const statusCode = rawResult.charAt(0); // 'S' or 'E'
      const isSuccess = statusCode === "S";

      let availableBalance: number | null = null;
      let message: string;

      if (isSuccess) {
        // Success format: S$$$<balance>
        const balanceStr = rawResult.split("$$$")[1];
        availableBalance = parseFloat(balanceStr);
        message = "Validation Successful";
      } else {
        message = rawResult.replace(/^E\s*/, "").trim();

        const balanceMatch = message.match(
          /available limit of\s+([\d.]+)\s+days/i
        );
        if (balanceMatch) {
          availableBalance = parseFloat(balanceMatch[1]);
        }
      }

      return {
        success: isSuccess,
        isValid: isSuccess,
        availableBalance: isNaN(availableBalance as number)
          ? null
          : availableBalance,
        message,
        raw: rawResult,
      };
    } catch (error: any) {
      console.error(
        "Error executing FN_HR_LEAVE_VALIDATION_V1:",
        error.message,
      );
      return {
        result: null,
        success: false,
        isValid: false,
        error:
          "Leave validation could not be completed. Please try again later.",
      };
    }
  },

};

