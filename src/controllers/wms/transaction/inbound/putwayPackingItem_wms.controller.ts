// Import required dependencies
import { Response } from "express";
import constants from "../../../../helpers/constants";
import {
  ISearch,
  RequestWithUser,
} from "../../../../interfaces/common.interface";
import { putwayPackingItemSchema } from "../../../../validation/wms/transaction/inbound.validation";
import * as fastCsv from "fast-csv";
import WmsCsvHeaders from "../../../../utils/exportCsv/WmsCsvHeaders";
import { PutwayPackingItemService } from "../../../../services/WMS/putwayPackingItem.service";
import { PackingDetailsService } from "../../../../services/WMS/transaction/inbound/packingDetails.service";
import { getSearchFilterQuery } from "../../../../helpers/functions";

/**
 * Process putway packing items
 * @param req Request with user details
 * @param res Response object
 */
export const putwayPackingItem = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  const putwayService = new PutwayPackingItemService();

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
      // Build where conditions for TypeORM
      const whereConditions: any = {
        company_code: req.user.company_code,
        job_no: job_no,
      };

      // If filter has search criteria, add them
      if (filter && filter.search && typeof filter.search === 'object') {
        Object.keys(filter.search).forEach((key) => {
          whereConditions[key as string] = (filter.search as any)[key];
        });
      }

      const packdateData = await PackingDetailsService.findWithFilters(whereConditions);
      packDateNo = packdateData.map((item) => item?.packdet_no.toString());
    }

    // Process putway using service
    await putwayService.processPutway({
      companyCode: req.user.company_code,
      prinCode: prin_code as string,
      jobNo: job_no,
      packdetNo: all === "all" ? packDateNo : packdet_no,
      siteFrom: site_from,
      siteTo: site_to,
      locationFrom: location_from,
      locationTo: location_to,
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

    // Build base where conditions for TypeORM
    const baseConditions = {
      company_code: req.user.company_code,
    };

    // Apply search filters using TypeORM-compatible function
    const whereConditions = getSearchFilterQuery({
      insideQuery: [],
      filter: filter.search,
      outsideQuery: baseConditions,
    });

    // Fetch data from database using TypeORM
    fetchedData = await PackingDetailsService.findWithFilters(whereConditions);

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
      // TypeORM entities are already plain objects, no need to call .get()
      csvTransform.write(eachData);
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
