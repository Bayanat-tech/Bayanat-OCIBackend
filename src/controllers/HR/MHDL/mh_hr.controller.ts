import { Request, Response } from "express";
import { HrService } from "../MHDL/mh_hr.service";

export const getMHEmployeesHandler = async (req: Request, res: Response) => {
  try {
    console.log('in getEmployeesHandler')
    const { supervisor_empid } = req.query;
    const data = await HrService.getEmployeesUnder(
      supervisor_empid as string
    );
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const MHgetLeaveEntitleHandler = async (req: Request, res: Response) => {
  try {
    const { employeeId } = req.params;
    const data = await HrService.getLeaveEntitle(employeeId);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const leaveDaysCntHandler = async (req: Request, res: Response) => {
  try {
    const {
      company_code,
      employee_code,
      leaveStartDate,
      leaveEndDate,
      half_day,
      leaveType,
    } = req.query;

    const data = await HrService.LeaveDaysCount({
      company_code: company_code as string,
      employee_code: employee_code as string,
      leaveStartDate: leaveStartDate as string,
      leaveEndDate: leaveEndDate as string,
      half_day: half_day as string,
      leaveType: leaveType as string,
    });

    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const MHvalidateLeaveHandler = async (req: Request, res: Response) => {
  try {
    const {
      companyCode,
      employeeId,
      leaveStartDate,
      leaveEndDate,
      leaveType,
      leaveDays,
    } = req.query;

    const data = await HrService.MHvalidateLeave({
      companyCode: companyCode as string,
      employeeId: employeeId as string,
      leaveStartDate: leaveStartDate as string,
      leaveEndDate: leaveEndDate as string,
      leaveType: leaveType as string,
      leaveDays: parseInt(leaveDays as string, 10),
    });

    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};


