// Importing necessary modules and controllers
import express from "express";
import {
  upsertLeaveApprovalHandler,
  saveFileHR,
} from "../../controllers/HR/hr_leave_approval";
import {
  createhrcategory,
  updatehrcategory,
} from "../../controllers/HR/hr_category.controller";
import {
  createKpiName,
  updateKpiName,
} from "../../controllers/HR/hr_kpiName.controller";

import {
  createGrade,
  deleteGrades,
  updateGrade,
} from "../../controllers/HR/grade_hr.controller";

import {
  createDesignation,
  deleteDesignation,
  updateDesignation,
} from "../../controllers/HR/designation_hr.controller";

import {
  createFormaldesignation,
  deleteFormaldesignation,
  updateFormaldesignation,
} from "../../controllers/HR/formaldesignation_hr.controller";
import {
  createKpiOperation,
  updateKpiOperation,
} from "../../controllers/HR/hr_kpiOperationController";

import {
  createhrleavetype,
  updatehrleavetype,
} from "../../controllers/HR/hr_leavetype.controller";
import {
  createhrpaycomponent,
  updatehrpaycomponent,
} from "../../controllers/HR/hr_pay_component.controller";
import {
  createBulkSections,
  createSection,
  deleteSections,
  exportSection,
  updateSection,
} from "../../controllers/HR/hr_section.controller";
import {
  getEmployeesHandler,
  getLeaveBalanceHandler,
  getLeaveEntitleHandler,
  getLeaveHistoryHandler,
  validateLeaveHandler,
  getLeaveRequestsWithErpDocHandler,
  newvalidateLeaveHandler,
  leaveDaysCntHandler,
} from "../../controllers/HR/hr_net.controller";
import { executeRawSql } from "../../controllers/HR/rawSql_hr_controller";
import { getRequestFlowUsers } from "../../controllers/HR/hr_leave_flow_sentback";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { TypeORMService } from "../../database/connection";
import { HrBank } from "../../models/Hr/hr_bank";
import { HrContract } from "../../models/Hr/hr_contract";
import { HrSponsor } from "../../models/Hr/hr_sponsor";
import { HrDepartment } from "../../models/Hr/hr_department";
import { HrDivision } from "../../models/Hr/hr_division";
import { HrAirport } from "../../models/Hr/hr_airport";
import { HrEmpStatus } from "../../models/Hr/hr_employee_status";

// Creating an instance of the Express Router
const router = express.Router();

// Defining routes for HR category
// category
router.post("/category", createhrcategory); // Create a new HR category
router.put("/category", updatehrcategory); // Update an existing HR category

// Defining routes for HR category master
router.post("/categorymaster", createhrcategory); // Create a new HR category master
router.put("/categorymaster", updatehrcategory); // Update an existing HR category master

// Defining routes for KPI name
router.post("/kpiname", createKpiName); // Create a new KPI name
router.put("/kpiname", updateKpiName); // Update an existing KPI name

// Defining routes for KPI operation
router.post("/kpioperation", createKpiOperation); // Create a new KPI operation
router.put("/kpioperation", updateKpiOperation); // Update an existing KPI operation

// Defining routes for sections
router.post("/section", createSection); // Create a new section
router.put("/section", updateSection); // Update an existing section
router.post("/section/bulk", createBulkSections); // Create multiple sections in bulk
router.get("/section/export", exportSection); // Export sections
router.post("/section/delete", deleteSections); // Delete sections

// Defining routes for grades
router.post("/grade", createGrade); // Create a new grade
router.put("/grade", updateGrade); // Update an existing grade
router.post("/grade/delete", deleteGrades); // Delete grades
// Defining routes for designations
router.post("/designation", createDesignation); // Create a new designation
router.post("/designation/delete", deleteDesignation); // Delete designations
router.put("/designation", updateDesignation); // Update an existing designation

// Defining routes for formal designations
router.post("/formaldesignation", createFormaldesignation);
router.post("/formaldesignation/delete", deleteFormaldesignation);
router.put("/formaldesignation", updateFormaldesignation);

// Defining routes for leave types
// leavetype
router.post("/leavetype", createhrleavetype);
router.put("/leavetype", updatehrleavetype);

// Defining routes for pay components
// paycomponent
router.post("/paycomponent", createhrpaycomponent);
router.put("/paycomponent", updatehrpaycomponent);

router.post("/bank", upsertHrSimpleMaster(HrBank, ["company_code", "bank_code"]));
router.put("/bank", upsertHrSimpleMaster(HrBank, ["company_code", "bank_code"]));
router.post("/contract", upsertHrSimpleMaster(HrContract, ["company_code", "contract_type"]));
router.put("/contract", upsertHrSimpleMaster(HrContract, ["company_code", "contract_type"]));
router.post("/sponsor", upsertHrSimpleMaster(HrSponsor, ["company_code", "sponsor_code"]));
router.put("/sponsor", upsertHrSimpleMaster(HrSponsor, ["company_code", "sponsor_code"]));
router.post("/department", upsertHrSimpleMaster(HrDepartment, ["company_code", "dept_code"]));
router.put("/department", upsertHrSimpleMaster(HrDepartment, ["company_code", "dept_code"]));
router.post("/division", upsertHrSimpleMaster(HrDivision, ["company_code", "div_code"]));
router.put("/division", upsertHrSimpleMaster(HrDivision, ["company_code", "div_code"]));
router.post("/airport", upsertHrSimpleMaster(HrAirport, ["company_code", "airport_code"]));
router.put("/airport", upsertHrSimpleMaster(HrAirport, ["company_code", "airport_code"]));
router.post("/employeestatus", upsertHrSimpleMaster(HrEmpStatus, ["company_code", "empstatus_code"]));
router.put("/employeestatus", upsertHrSimpleMaster(HrEmpStatus, ["company_code", "empstatus_code"]));

router.put("/upsertLeaveApprovalHandler", upsertLeaveApprovalHandler);

// Save file route
router.post("/saveFile", (req, res, next) => {
  saveFileHR(req, res).catch(next);
});
router.get("/getRequestFlowUsers", getRequestFlowUsers as any );
// HR .NET API routes
router.get("/employees", getEmployeesHandler);
router.get("/leavebalance/:employeeId", getLeaveBalanceHandler);
router.get("/leaveentitle/:employeeId", getLeaveEntitleHandler);
router.get("/leavehistory", getLeaveHistoryHandler);
// router.get("/validateleave", validateLeaveHandler);
router.get("/validateleave", newvalidateLeaveHandler);
router.get("/leave-requests-erp-doc", getLeaveRequestsWithErpDocHandler);
router.get("/leavedayscount", leaveDaysCntHandler);

// Exporting the router

//raw sql execution route
router.post("/executeRawSql", executeRawSql); // Raw SQL execution route
export default router;

function upsertHrSimpleMaster(entity: any, keyFields: string[]) {
  return async (req: RequestWithUser, res: any) => {
    try {
      const requestUser = req.user;
      const repo = TypeORMService.getRepository(entity);
      const payload = {
        ...req.body,
        company_code: req.body.company_code || requestUser.company_code,
        updated_by: requestUser.loginid,
      };
      const where = Object.fromEntries(keyFields.map((key) => [key, payload[key]]));
      const existing = await repo.findOne({ where });
      if (!existing) payload.created_by = requestUser.loginid;
      await repo.save({ ...(existing || {}), ...payload });
      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        message: `${entity.name} ${existing ? "updated" : "created"} successfully`,
      });
    } catch (error: any) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: error.message });
    }
  };
}
