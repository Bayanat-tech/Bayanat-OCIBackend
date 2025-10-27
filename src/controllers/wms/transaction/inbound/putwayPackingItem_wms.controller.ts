// Import required dependencies
import { Response } from "express";
import { Op, QueryTypes } from "sequelize";
import { sequelize } from "../../../../database/connection";
import constants from "../../../../helpers/constants";
import {
  ISearch,
  RequestWithUser,
} from "../../../../interfaces/common.interface";
import PackingDetailsInboundWms from "../../../../models/wms/transaction/inbound/packingDetails_wms.model"; 
import { putwayPackingItemSchema } from "../../../../validation/wms/transaction/inbound.validation";
import * as fastCsv from "fast-csv";
import WmsCsvHeaders from "../../../../utils/exportCsv/WmsCsvHeaders";
import { getSearchFilterQuery } from "../../../../helpers/functions";
import PackingDetailsInboundWmsView from "../../../../views/wms/transportation/inbound/packingDetails_wms.view";

/**
 * Process putway packing items
 * @param req Request with user details
 * @param res Response object
 */
export const putwayPackingItem = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    // Validate request body
    const { error } = putwayPackingItemSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    const { job_no } = req.params;
    const { prin_code, all } = req.query;
    const { site_from, site_to, location_from, location_to, packdet_no } =
      req.body;
    const filter: ISearch = req.query.filter ? JSON.parse(req.query.filter) : {};

    console.log('inside putwayPackingItem');

    // Determine packdet_no list if all items
    let packDateNo: string[] = [];
    if (all === "all") {
      const outsideQuery = getSearchFilterQuery({
        insideQuery: [],
        filter,
        outsideQuery: {
          [Op.and]: [{ company_code: req.user.company_code }, { job_no }],
        },
      });

      const packdateData: any[] = await PackingDetailsInboundWmsView.findAll({
        where: outsideQuery,
      });
      packDateNo = packdateData.map((item) => item?.packdet_no);
    }

    await sequelize.transaction(async (t) => {
      // 1️⃣ Mark selected packets in PackingDetailsInboundWms
      await PackingDetailsInboundWms.update(
        {
          selected: "Y",
          from_site: site_from,
          to_site: site_to,
          location_from,
          location_to,
        },
        {
          where: {
            [Op.and]: [
              { company_code: req.user.company_code },
              { prin_code },
              { job_no },
              { packdet_no: all === "all" ? packDateNo : packdet_no },
            ],
          },
          transaction: t,
        }
      );
      console.log('Packets marked as selected');

      // 2️⃣ Update TI_TALLY_DETAIL
      await sequelize.query(
        `UPDATE TI_TALLY_DETAIL
         SET ALLOCATED = 'N', SELECTED = 'Y'
         WHERE JOB_NO = :job_no
           AND PRIN_CODE = :prin_code
           AND COMPANY_CODE = :company_code`,
        {
          replacements: { job_no, prin_code, company_code: req.user.company_code },
          type: QueryTypes.UPDATE,
          transaction: t,
        }
      );
      console.log('TI_TALLY_DETAIL updated');

      // 3️⃣ Update TI_PACKDET
      await sequelize.query(
        `UPDATE TI_PACKDET
         SET SELECTED = 'Y', ALLOCATED = 'N'
         WHERE JOB_NO = :job_no
           AND PRIN_CODE = :prin_code
           AND COMPANY_CODE = :company_code`,
        {
          replacements: { job_no, prin_code, company_code: req.user.company_code },
          type: QueryTypes.UPDATE,
          transaction: t,
        }
      );
      console.log('TI_PACKDET updated');

      // 4️⃣ Call putaway stored procedure
      const result: any = await sequelize.query(
        `CALL SP_WM_INB_DECIDE_PUTWAY(
          :vs_company_code,
          :vs_principal_code,
          :vs_job_no,
          :vs_site_from,
          :vs_site_to,
          :vs_loc_from,
          :vs_loc_to,
          :vs_user
        )`,
        {
          replacements: {
            vs_company_code: req.user.company_code,
            vs_principal_code: prin_code,
            vs_job_no: job_no,
            vs_site_from: site_from,
            vs_site_to: site_to,
            vs_loc_from: location_from,
            vs_loc_to: location_to,
            vs_user: req.user.loginid,
          },
          type: QueryTypes.RAW,
          transaction: t,
        }
      );
      console.log('Putaway stored procedure executed');

      // 5️⃣ Reset selection after successful processing
      if (result) {
        await PackingDetailsInboundWms.update(
          { selected: "N" },
          {
            where: {
              [Op.and]: [
                { company_code: req.user.company_code },
                { prin_code },
                { job_no },
                { packdet_no },
              ],
            },
            transaction: t,
          }
        );
        console.log('Packets reset to selected = N');
      }
    });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Putway processed successfully",
    });
  } catch (error: any) {
    console.error("Putway error:", error);
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
  }
};

/**
 * Export putway packing items to CSV
 * @param req Request with user details 
 * @param res Response object
 */
export const exportPutwayPackingItem = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    // Initialize data array
    let fetchedData: any[] = [];

    // Get and parse filter from query
    const filter: ISearch = req.query.filter
      ? JSON.parse(req.query.filter)
      : {};

    // Build query conditions
    let insideQuery: any = [],
      outsideQuery = {
        [Op.and]: [{ company_code: req.user.company_code }],
      };

    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });

    // Fetch data from database
    fetchedData = await PackingDetailsInboundWms.findAll({
      where: outsideQuery,
    });

    // Handle empty results
    if (fetchedData.length === 0) {
      console.log("empty data");
      res
        .status(constants.STATUS_CODES.NO_CONTENT)
        .json({ success: true, message: "Empty Data" });
      return;
    }

    // Configure CSV formatter
    let csvTransform: fastCsv.CsvFormatterStream<
      fastCsv.FormatterRow,
      fastCsv.FormatterRow
    > = fastCsv.format({
      headers: WmsCsvHeaders.TANSACTION.INBOUND.PUTWAY_DETAIL,
    });

    // Set response headers
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="putway_details.csv"`
    );

    // Process and write data
    fetchedData.forEach((eachData) => {
      const plainData = eachData.get({ plain: true });
      csvTransform.write(plainData);
    });

    // Finalize and send CSV
    csvTransform.end();
    csvTransform.pipe(res);
  } catch (error: any) {
    // Handle errors
    console.error("Export Error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};
