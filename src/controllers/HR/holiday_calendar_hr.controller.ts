import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";

export const insUpdHRHolidayCalendarBulk = async (
  req: Request,
  res: Response
): Promise<void> => {

  console.log("insUpdHRHolidayCalendarBulk called-------------");
  console.log("req.body:------------------", req.body);

  let connection: oracledb.Connection | undefined;

  try {

    /* ============================================================
       GET DETAILS
       ============================================================ */

    const details = req.body?.details;

    if (!Array.isArray(details) || details.length === 0) {
      res.status(400).json({
        success: false,
        message: "Details required"
      });
      return;
    }


    /* ============================================================
       TENANT
       ============================================================ */

    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }


    /* ============================================================
       DATABASE CONNECTION
       ============================================================ */

    connection = await TenantManager.getConnection(tenantId);


    /* ============================================================
       DATE HELPER
       ============================================================ */

    const parseDate = (value: any): Date | null => {

      if (
        value === null ||
        value === undefined ||
        value === ""
      ) {
        return null;
      }

      if (value instanceof Date) {
        return value;
      }

      const date = new Date(value);

      if (isNaN(date.getTime())) {
        throw new Error(
          `Invalid date value: ${value}`
        );
      }

      return date;
    };


    /* ============================================================
       NUMBER HELPER
       ============================================================ */

    const parseNumber = (value: any): number | null => {

      if (
        value === null ||
        value === undefined ||
        value === ""
      ) {
        return null;
      }

      const numberValue = Number(value);

      if (isNaN(numberValue)) {
        throw new Error(
          `Invalid number value: ${value}`
        );
      }

      return numberValue;
    };


    /* ============================================================
       MAP HOLIDAY CALENDAR DATA
       ============================================================ */

    const holidayRows = details.map((d: any) => ({

      /* ------------------------------------------------------------
         VARCHAR2(8)
         ------------------------------------------------------------ */

      DATEID:
        d.dateid != null
          ? String(d.dateid)
          : null,


      /* ------------------------------------------------------------
         DATE
         ------------------------------------------------------------ */

      HOLIDAY_DATE:
        parseDate(d.holiday_date),


      /* ------------------------------------------------------------
         VARCHAR2
         ------------------------------------------------------------ */

      HOLIDAY_REASON:
        d.holiday_reason ?? null,

      HOLIDAY_TYPE:
        d.holiday_type != null
          ? String(d.holiday_type)
          : null,

      USER_ID:
        d.user_id ?? null,


      /* ------------------------------------------------------------
         DATE
         ------------------------------------------------------------ */

      USER_DT:
        parseDate(d.user_dt),


      /* ------------------------------------------------------------
         COMPANY
         ------------------------------------------------------------ */

      COMPANY_CODE:
        d.company_code ?? null,


      /* ------------------------------------------------------------
         VARCHAR2
         ------------------------------------------------------------ */

      HALF_DAY:
        d.half_day != null
          ? String(d.half_day)
          : null,

      DIV_CODE:
        d.div_code ?? null,

      REMARKS:
        d.remarks ?? null,

      GRADE_CODE:
        d.grade_code ?? null

    }));


    /* ============================================================
       VALIDATE PRIMARY KEY
       
       COMPANY_CODE
       DIV_CODE
       GRADE_CODE
       DATEID
       HOLIDAY_DATE
       ============================================================ */

    for (const row of holidayRows) {

      if (!row.COMPANY_CODE) {
        throw new Error(
          "COMPANY_CODE is required"
        );
      }

      if (!row.DIV_CODE) {
        throw new Error(
          "DIV_CODE is required"
        );
      }

      if (!row.GRADE_CODE) {
        throw new Error(
          "GRADE_CODE is required"
        );
      }

      if (!row.DATEID) {
        throw new Error(
          "DATEID is required"
        );
      }

      if (!row.HOLIDAY_DATE) {
        throw new Error(
          "HOLIDAY_DATE is required"
        );
      }
    }


    console.log(
      "Holiday rows:",
      holidayRows
    );


    /* ============================================================
       EXECUTE ORACLE PROCEDURE
       ============================================================ */

    await connection.execute(
      `BEGIN
         PROC_INS_UPD_HR_HOLIDAYCALENDAR(
           :p_data
         );
       END;`,
      {
        p_data: {
          type: "T_HR_HOLIDAYCALENDAR_TAB",
          val: holidayRows
        }
      },
      {
        autoCommit: false
      }
    );


    /* ============================================================
       COMMIT
       ============================================================ */

    await connection.commit();


    /* ============================================================
       SUCCESS RESPONSE
       ============================================================ */

    res.json({
      success: true,
      message: "Holiday calendar saved successfully",
      recordsProcessed: holidayRows.length
    });


  } catch (err: any) {

    console.error(
      "Oracle Error:",
      err
    );


    /* ============================================================
       ROLLBACK
       ============================================================ */

    if (connection) {

      try {
        await connection.rollback();
      } catch (rollbackError) {

        console.error(
          "Rollback Error:",
          rollbackError
        );

      }

    }


    /* ============================================================
       ERROR RESPONSE
       ============================================================ */

    res.status(500).json({
      success: false,
      message: "Holiday calendar transaction failed",
      details:
        err?.message ||
        "Unknown error"
    });


  } finally {

    /* ============================================================
       CLOSE CONNECTION
       ============================================================ */

    if (connection) {

      try {
        await connection.close();
      } catch (closeError) {

        console.error(
          "Connection Close Error:",
          closeError
        );

      }

    }

  }
};