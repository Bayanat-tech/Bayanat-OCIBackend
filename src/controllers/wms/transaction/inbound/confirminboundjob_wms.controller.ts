import { Response } from "express";
import { Op, QueryTypes } from "sequelize";
import { sequelize } from "../../../../database/connection";
import constants from "../../../../helpers/constants";
import {
  ISearch,
  RequestWithUser,
} from "../../../../interfaces/common.interface";
import ConfirmInboundInboundWms from "../../../../models/wms/transaction/inbound/confirmInboundjob_wms.model";
import * as fastCsv from "fast-csv";
import WmsCsvHeaders from "../../../../utils/exportCsv/WmsCsvHeaders";
import { getSearchFilterQuery } from "../../../../helpers/functions";
import { InboundJobConfirmSchema } from "../../../../validation/wms/transaction/inbound.validation";

export const getconfirmInboundjob = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const { prin_code, job_no } = req.query;

    console.log(req.query);
 console.log('getconfirminboundjob');
    const confirminbound = await ConfirmInboundInboundWms.findOne({
      where: {
        prin_code,
        job_no,
        company_code: req.user.company_code,
      },
    });

    if (!confirminbound) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Confirm Job " + constants.MESSAGES.DOES_NOT_EXISTS,
      });
      return;
    }
  } catch (error: unknown) {
    const knownError = error as { message: string };
    res
      .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: knownError.message });
  }
};
export const confirmInboundjob = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    console.log("Request Params (params):", req.params); // This should show { job_no: '1234' }
    console.log("Request Query (query):", req.query); // This should show { prin_code: 'XYZ' }
    console.log("Request Body (body):", req.body); // This should show packdet_no
    console.log("procedure start SP_WM_INB_PUTAWAY_CONFIRM1", req.body);

    //const { error } = InboundJobConfirmSchema(req.body);
    //console.log("procedure start SP_WM_INB_PUTAWAY_CONFIRM55555", error);
    const { job_no } = req.params;
    const { prin_code } = req.query;
    console.log("job_no", job_no);
    console.log("prin_code", prin_code);

    /*if (error) {
      console.log("procedure start SP_WM_INB_PUTAWAY_CONFIRM5896");
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }*/

    console.log("procedure start SP_WM_INB_PUTAWAY_CONFIRM2");

    //const { site_from, site_to, location_from, location_to, packdet_no } =
    //req.body;

    // initiating trsaction
    // New method start
    // Update query to mark 'SELECTED' as 'Y' for specific conditions
    const { packdet_no } = req.body; // ['1', '2']
    const vs_company_code = req.user.company_code;
    console.log("packetnos", packdet_no);
    console.log("company_code", vs_company_code);

    const updateQuery = `
      UPDATE TT_BATCH
      SET SELECTED = 'Y'
      WHERE company_code = :vs_company_code
        AND job_no = :vs_job_no
        AND prin_code = :vs_prin_code
        AND KEY_NUMBER IN (:packdet_no)
    `;
console.log(updateQuery);
    sequelize
      .query(updateQuery, {
        replacements: {
          vs_company_code: vs_company_code, // Replace with actual company code
          vs_job_no: job_no, // Replace with actual job number
          vs_prin_code: prin_code, // Replace with actual principal code
          packdet_no: packdet_no, // Pass the array ['1', '2'] directly here
        },
      })
      .then(() => {
        console.log("Update successful");
      })
      .catch((error) => {
        console.error("Error updating records:", error);
      });

    // Logging the update result

    // New method end

    console.log("user", req.user.company_code);

    //   console.log("procedure start SP_WM_INB_PUTAWAY_CONFIRM14");

    //calling stored procedure
    console.log("procedure start SP_WM_INB_PUTAWAY_CONFIRM");
    const result: any = await sequelize.query(
      `CALL SP_WM_INB_PUTAWAY_CONFIRM(:vs_company_code, :principal_code, :VS_job_no,NOW(),:VS_USER)`,

      {
        replacements: {
          vs_company_code: req.user.company_code,
          principal_code: prin_code,
          VS_job_no: job_no,
          VS_USER: req.user.loginid,
        },
        type: QueryTypes.RAW,
        //transaction: t,
      }
    );

    //   if (!!result) {
    //     await ConfirmInboundInboundWms.update(
    //       { selected: "N" },
    //       {
    //         where: {
    //           [Op.and]: [
    //             { company_code: req.user.company_code },
    //             { prin_code },
    //             { job_no },
    //           ],
    //         },
    //         transaction: t,
    //       }
    //     );
    //   }
    // }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Job Confirmation successfully",
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
