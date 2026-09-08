import { Request, Response, RequestHandler } from "express";

import oracledb from "oracledb";

import TenantManager from "../../../src/database/TenantManager";

import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

// ---------- helpers ----------

const toDate = (v: any) => (v ? new Date(v) : null);

const toNumber = (v: any) => (v !== undefined && v !== null ? Number(v) : null);

// =========================================================

// BUILD HR_EMP_OBJ

// =========================================================

const buildEmployeeObject = (e: any) => ({
  COMPANY_CODE: e.COMPANY_CODE ?? null,

  EMPLOYEE_CODE: e.EMPLOYEE_CODE ?? null,

  ALTERNATE_ID: e.ALTERNATE_ID ?? null,

  TITLE: e.TITLE ?? null,

  FIRST_NAME: e.FIRST_NAME ?? null,

  SECOND_NAME: e.SECOND_NAME ?? null,

  THIRD_NAME: e.THIRD_NAME ?? null,

  FOURTH_NAME: e.FOURTH_NAME ?? null,

  LAST_NAME: e.LAST_NAME ?? null,

  FAMILY_NAME: e.FAMILY_NAME ?? null,

  ALIAS_NAME: e.ALIAS_NAME ?? null,

  GENDER: e.GENDER ?? "M",

  BIRTH_DATE: toDate(e.BIRTH_DATE),

  BIRTH_PLACE: e.BIRTH_PLACE ?? null,

  FATHER_NAME: e.FATHER_NAME ?? null,

  MOTHER_NAME: e.MOTHER_NAME ?? null,

  MARRITAL_STATUS: e.MARRITAL_STATUS ?? null,

  SPOUSE_NAME: e.SPOUSE_NAME ?? null,

  NO_OF_CHILDREN: toNumber(e.NO_OF_CHILDREN),

  BLOOD_GROUP: e.BLOOD_GROUP ?? null,

  NATIONALITY: e.NATIONALITY ?? null,

  RELIGION_CODE: toNumber(e.RELIGION_CODE),

  CASTE_CODE: toNumber(e.CASTE_CODE),

  COUNTRY_CODE: e.COUNTRY_CODE ?? null,

  COUNTRY_LIVING_IN: e.COUNTRY_LIVING_IN ?? null,

  PPT_NAME: e.PPT_NAME ?? null,

  PPT_NO: e.PPT_NO ?? null,

  PPT_COUNTRY: e.PPT_COUNTRY ?? null,

  PPT_VALID_FROM: toDate(e.PPT_VALID_FROM),

  PPT_VALID_TO: toDate(e.PPT_VALID_TO),

  PPT_STATUS: e.PPT_STATUS ?? null,

  PASSPORT_WITH: e.PASSPORT_WITH ?? null,

  PHONE_OFFICE: e.PHONE_OFFICE ?? null,

  PHONE_OFFICE_EXTN: e.PHONE_OFFICE_EXTN ?? null,

  MOBILE_NO: e.MOBILE_NO ?? null,

  MOBILE_NO2: e.MOBILE_NO2 ?? null,

  EMAIL_OFFICIAL: e.EMAIL_OFFICIAL ?? null,

  EMAIL_PERSONAL: e.EMAIL_PERSONAL ?? null,

  PERM_ADDRESS1: e.PERM_ADDRESS1 ?? null,

  PERM_ADDRESS2: e.PERM_ADDRESS2 ?? null,

  PERM_ADDRESS3: e.PERM_ADDRESS3 ?? null,

  PERM_PHONE: e.PERM_PHONE ?? null,

  PERM_MOBILE: e.PERM_MOBILE ?? null,

  LOCAL_ADDRESS1: e.LOCAL_ADDRESS1 ?? null,

  LOCAL_ADDRESS2: e.LOCAL_ADDRESS2 ?? null,

  LOCAL_ADDRESS3: e.LOCAL_ADDRESS3 ?? null,

  LOCAL_PHONE: e.LOCAL_PHONE ?? null,

  LOCAL_MOBILE: e.LOCAL_MOBILE ?? null,

  EMGR_ADDRESS1: e.EMGR_ADDRESS1 ?? null,

  EMGR_ADDRESS2: e.EMGR_ADDRESS2 ?? null,

  EMGR_ADDRESS3: e.EMGR_ADDRESS3 ?? null,

  EMGR_PHONE: e.EMGR_PHONE ?? null,

  EMGR_MOBILE: e.EMGR_MOBILE ?? null,

  EMGR_CONTACT_PERSON: e.EMGR_CONTACT_PERSON ?? null,

  DRIVING_LICENSE_NO: e.DRIVING_LICENSE_NO ?? null,

  DL_ISSUE_PLACE: e.DL_ISSUE_PLACE ?? null,

  DL_ISSUE_DATE: toDate(e.DL_ISSUE_DATE),

  DL_VALID_UPTO: toDate(e.DL_VALID_UPTO),

  EMP_STATUS: e.EMP_STATUS ?? null,

  OT_APPLICABLE: e.OT_APPLICABLE ?? null,

  HEALTH_EXPIRY: toDate(e.HEALTH_EXPIRY),

  DEPT_HEAD_EMP_ID: e.DEPT_HEAD_EMP_ID ?? null,

  SUPERVISOR_EMPID: e.SUPERVISOR_EMPID ?? null,

  MANAGER_CODE: e.MANAGER_CODE ?? null,

  UPDATED_AT: new Date(),

  CREATED_AT: new Date(),
});
// =========================================================

// CONTROLLER

// =========================================================

export const UpdHrEmployeeDetail: RequestHandler = async (
  req: Request,

  res: Response,
) => {
  let connection: oracledb.Connection | null = null;

  try {
    const { employee } = req.body;

    console.log("Received employee object:", employee);
    // -----------------------------------------------------

    // VALIDATE EMPLOYEE OBJECT

    // -----------------------------------------------------

    if (!employee) {
      res.status(400).json({
        success: false,

        message: "Employee object required",
      });

      return;
    }

    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,

        message: "Tenant not found",
      });

      return;
    }

    connection = await TenantManager.getConnection(tenantId);


    const empObj = buildEmployeeObject(employee);
    // console.log("Built employee object:", empObj);


    // console.log(
    //   "HR_EMP_OBJ SENT TO ORACLE:",

    //   JSON.stringify(empObj, null, 2),
    // );


    if (!empObj.COMPANY_CODE) {
      res.status(400).json({
        success: false,

        message: "COMPANY_CODE is required",
      });

      return;
    }

    if (!empObj.EMPLOYEE_CODE) {
      res.status(400).json({
        success: false,

        message: "EMPLOYEE_CODE is required",
      });

      return;
    }

    await connection.execute(
      `

    BEGIN

    WMSTST.PROC_INS_UPD_HR_EMPLOYEE_DETAIL(:p_emp);

    END;

    `,
      {
        p_emp: {
          type: "HR_EMP_OBJ",

          val: empObj,
        },
      },

      {
        autoCommit: false,
      },
    );

    //  console.log('log1', {p_emp: {type: "HR_EMP_OBJ",val: empObj,}})
     

    await connection.commit();

    res.json({
      success: true,

      message: "Employee saved successfully",
    });
  } catch (err: any) {
    console.error(
      "PROC_INS_UPD_HR_EMPLOYEE_DETAIL ERROR:",

      err,
    );


    if (connection) {
      try {
        await connection.rollback();
      } catch (e) {
        console.error("Rollback error:", e);
      }
    }


    res.status(500).json({
      success: false,

      message: err.message,

      errorNum: err.errorNum,

      offset: err.offset,
    });
  } finally {

    if (connection) {
      try {
        await connection.close();
      } catch (e) {
        console.error("Close error:", e);
      }
    }
  }
};
