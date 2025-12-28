import { Request, Response } from "express";
import { AppDataSource } from "../../database/connection";
import { Employee } from "../../entity/Attendance/employee.entity";
import constants from "../../helpers/constants";
import axios from "axios";
import https from "https";

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

export interface EmployeeInfo {
  EMPLOYEE_CODE: string;
  RPT_NAME: string;
  EMP_STATUS: string;
  [key: string]: any;
}

export const EmployeeService = {
  getEmployeeInfo: async (params: {
    employee_code?: string;
    name?: string;
  }): Promise<EmployeeInfo[]> => {
    try {
      if (!params.employee_code && !params.name) {
        throw new Error("Either employee_code or name is required");
      }

      const response = await axiosInstance.get(
        "/api/EmployeeLeave/employeeinfo",
        {
          params,
        }
      );

      if (response.status >= 400) {
        throw new Error(
          `API Error: ${response.status} ${JSON.stringify(response.data)}`
        );
      }

      return response.data;
    } catch (error: any) {
      console.error("Error in getEmployeeInfo:", {
        message: error.message,
        response: error.response?.data,
        config: error.config,
      });
      throw error;
    }
  },
};
