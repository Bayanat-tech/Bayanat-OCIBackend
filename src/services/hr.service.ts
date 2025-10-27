import axios from "axios";
import https from "https";
import { LeaveRequestFlow } from "../interfaces/leaveRequestFlow.interface";

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
