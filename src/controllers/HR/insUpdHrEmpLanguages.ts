import { Request, Response } from "express";

import oracledb from "oracledb";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import TenantManager from "../../database/TenantManager";


 

export const insUpdHrEmpLanguages = async (

  req: Request,

  res: Response

): Promise<void> => {

 

  console.log("insUpdHrEmpLanguages called-------------");

  console.log("req.body:", req.body);

 

  let connection: oracledb.Connection | undefined;

 

  try {

 

    const details = req.body?.details;

 

    if (!Array.isArray(details) || details.length === 0) {

      res.status(400).json({

        success: false,

        message: "Language details are required"

      });

      return;

    }

 

    const tenantId = getCurrentTenantId();

 

    if (!tenantId) {

      res.status(400).json({

        success: false,

        message: "Tenant not found"

      });

      return;

    }

 

    connection = await TenantManager.getConnection(tenantId);

 

    /*

     * Convert JavaScript date to Oracle DATE.

     *

     * Input examples:

     * 23-08-2026

     * 23/08/2026

     * 2026-08-23

     *

     * Returns JavaScript Date.

     */

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

 

      const str = String(value).trim();

 

      if (!str) {

        return null;

      }

 

      /*

       * DD-MM-YYYY

       */

      let match = str.match(

        /^(\d{2})-(\d{2})-(\d{4})$/

      );

 

      if (match) {

        const day = Number(match[1]);

        const month = Number(match[2]) - 1;

        const year = Number(match[3]);

 

        const date = new Date(

          year,

          month,

          day

        );

 

        if (

          date.getFullYear() !== year ||

          date.getMonth() !== month ||

          date.getDate() !== day

        ) {

          throw new Error(

            `Invalid date: ${str}`

          );

        }

 

        return date;

      }

 

      /*

       * DD/MM/YYYY

       */

      match = str.match(

        /^(\d{2})\/(\d{2})\/(\d{4})$/

      );

 

      if (match) {

        const day = Number(match[1]);

        const month = Number(match[2]) - 1;

        const year = Number(match[3]);

 

        const date = new Date(

          year,

          month,

          day

        );

 

        if (

          date.getFullYear() !== year ||

          date.getMonth() !== month ||

          date.getDate() !== day

        ) {

          throw new Error(

            `Invalid date: ${str}`

          );

        }

 

        return date;

      }

 

      /*

       * YYYY-MM-DD

       */

      match = str.match(

        /^(\d{4})-(\d{2})-(\d{2})$/

      );

 

      if (match) {

        const year = Number(match[1]);

        const month = Number(match[2]) - 1;

        const day = Number(match[3]);

 

        const date = new Date(

          year,

          month,

          day

        );

 

        if (

          date.getFullYear() !== year ||

          date.getMonth() !== month ||

          date.getDate() !== day

        ) {

          throw new Error(

            `Invalid date: ${str}`

          );

        }

 

        return date;

      }

 

      /*

       * Try normal JavaScript date parsing

       */

      const date = new Date(str);

 

      if (isNaN(date.getTime())) {

        throw new Error(

          `Invalid date: ${str}`

        );

      }

 

      return date;

    };

 

    /*

     * Validate and map details

     */

    const detailRows = details.map(

      (d: any, index: number) => {

 

        if (!d.employee_id) {

          throw new Error(

            `EMPLOYEE_ID is required at row ${index + 1}`

          );

        }

 

        if (!d.lang_code) {

          throw new Error(

            `LANG_CODE is required at row ${index + 1}`

          );

        }

 

        if (!d.company_code) {

          throw new Error(

            `COMPANY_CODE is required at row ${index + 1}`

          );

        }

 

        if (!d.user_id) {

          throw new Error(

            `USER_ID is required at row ${index + 1}`

          );

        }

 

        return {

          EMPLOYEE_ID: String(d.employee_id),

          LANG_CODE: String(d.lang_code),

 

          TO_READ:

            d.to_read !== null &&

            d.to_read !== undefined

              ? String(d.to_read)

              : "N",

 

          TO_WRITE:

            d.to_write !== null &&

            d.to_write !== undefined

              ? String(d.to_write)

              : "N",

 

          TO_SPEAK:

            d.to_speak !== null &&

            d.to_speak !== undefined

              ? String(d.to_speak)

              : "N",

 

          REMARKS:

            d.remarks !== null &&

            d.remarks !== undefined

              ? String(d.remarks)

              : null,

 

          STATUS_FLAG:

            d.status_flag !== null &&

            d.status_flag !== undefined

              ? String(d.status_flag)

              : "A",

 

          USER_ID: String(d.user_id),

 

          USER_DT: parseDate(d.user_dt),

 

          COMPANY_CODE: String(d.company_code)

        };

      }

    );

 

    /*

     * Execute Oracle procedure

     */

    await connection.execute(

      `

      BEGIN

        PROC_INS_HR_EMP_LANGUAGES(

          :p_details

        );

      END;

      `,

      {

        p_details: {

          type: "HR_EMP_LANGUAGES_TAB",

          val: detailRows

        }

      },

      {

        autoCommit: false

      }

    );

 

    /*

     * Commit transaction

     */

    await connection.commit();

 

    res.json({

      success: true,

      message: "Employee languages saved successfully",

      count: detailRows.length

    });

 

  } catch (err: any) {

 

    console.error(

      "Oracle Error:",

      err

    );

 

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

 

    res.status(500).json({

      success: false,

      message: "Employee languages save failed",

      details:

        err?.message ||

        "Unknown error"

    });

 

  } finally {

 

    if (connection) {

      try {

        await connection.close();

      } catch (closeError) {

        console.error(

          "Connection close error:",

          closeError

        );

      }

    }

  }

};