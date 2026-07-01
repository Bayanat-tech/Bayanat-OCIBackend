import { Response } from "express";
import { RequestHandler } from "express";
import {
  ISearch,
} from "../../../../interfaces/common.interface";
import { IUser } from "../../../../interfaces/user.interface";
//import { packingDetailsSchema } from "../../../../validation/wms/transaction/inbound.validation";
import { tallyDetailsSchema } from "../../../../validation/wms/transaction/inbound.validation";
import constants from "../../../../helpers/constants";
import { Product } from "../../../../entity/WMS/product.entity";
import { CountryMaster } from "../../../../entity/WMS/country.entity";
import { TiTallyDetail } from "../../../../entity/WMS/TiTallyDetail.entity";
//import { IPackingDetails } from "../../../../interfaces/wms/transaction/inbound/packingDetails_wms.interface";
import { ITallyDetailsWms } from "../../../../interfaces/wms/transaction/inbound/tallyDetails_wms.interface";
import * as fastCsv from "fast-csv";
import WmsCsvHeaders from "../../../../utils/exportCsv/WmsCsvHeaders";
import { getSearchFilterQuery } from "../../../../helpers/functions";
import { Like } from "typeorm";
import { AppDataSource } from "../../../../database/connection";
import { RequestWithTenant } from "../../../../middleware/tenant.middleware";

export const getTallyDetail = async (req: RequestWithTenant, res: Response) => {
  try {
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      return res.status(400).json({ success:false,message:"company_code not found on authenticated user"});
    }
    const { prin_code, packdet_no, job_no, seq_number } = req.query;

    const tallyDetailsRepo = AppDataSource.getRepository(TiTallyDetail);
    const tallyDetails = await tallyDetailsRepo.findOne({
      where: {
        prin_code: prin_code as string,
        packdet_no: Number(packdet_no),
        job_no: job_no as string,
        company_code: companyCode,
        seq_number: Number(seq_number)
      },
    });

    if (!tallyDetails) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Tally Item " + constants.MESSAGES.DOES_NOT_EXISTS,
      });
      return;
    }

    const productRepo = AppDataSource.getRepository(Product);
    const productInfo = await productRepo.findOne({
      where: {
        prod_code: tallyDetails.prod_code,
        company_code: companyCode,
      },
    });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: {
        ...tallyDetails,
        prod_name: productInfo?.prod_name,
        uom_count: productInfo?.uom_count,
        uppp: productInfo?.uppp,
      },
    });
    return;
  } catch (error: unknown) {
    const knownError = error as { message: string };
    res
      .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: knownError.message });
  }
};



export const createTallyItem: RequestHandler = async (
  req: RequestWithTenant,
  res: Response
): Promise<any> => {
  try {
    const requestUser: IUser = req.user;
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      return res.status(400).json({ success:false,message:"company_code not found on authenticated user"});
    }
console.log('before calling tallyDetailsSchema');
    const { error } = tallyDetailsSchema(
      req.body,
      false,
      companyCode
    );

    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message,
      });
      return;
    }
console.log('after calling tallyDetailsSchema');
    const {
      seq_number,
      pda_qty_puom,
      pda_qty_luom,
      packdet_no,
      prod_code,
      pda_quantity,
      prin_code,
      job_no,
    } = req.body;

    /* =====================================================
       VALIDATIONS
    ===================================================== */
    if (req.body.prod_code) {
      const productRepo = AppDataSource.getRepository(Product);
      const productResponse = await productRepo.findOne({
        where: {
          company_code: companyCode,
          prod_code: req.body.prod_code,
        },
      });

      if (!productResponse) {
        res.status(constants.STATUS_CODES.NOT_FOUND).json({
          success: false,
          message: "Product " + constants.MESSAGES.NOT_FOUND,
        });
        return;
      }
    }

    if (req.body.country_code) {
      const countryRepo = AppDataSource.getRepository(CountryMaster);
      const countryResponse = await countryRepo.findOne({
        where: {
          company_code: companyCode,
          country_code: req.body.country_code,
        },
      });

      if (!countryResponse) {
        res.status(constants.STATUS_CODES.NOT_FOUND).json({
          success: false,
          message: "Country " + constants.MESSAGES.NOT_FOUND,
        });
        return;
      }
    }

    const tallyDetailsRepo = AppDataSource.getRepository(TiTallyDetail);

    /* =====================================================
       INSERT (SEQ_NUMBER GENERATED BY DB TRIGGER)
    ===================================================== */
    if (!seq_number) {
      await tallyDetailsRepo.save({
        ...req.body,
        seq_number: undefined, // trigger generates it
        company_code: companyCode,
        created_by: requestUser.loginid,
        updated_by: requestUser.loginid,
      });
    }

    /* =====================================================
       UPDATE
    ===================================================== */
    else {
      const updateResult = await tallyDetailsRepo.update(
        {
          company_code: companyCode,
          seq_number: seq_number,
        },
        {
          ...req.body,
          updated_by: requestUser.loginid,
        }
      );

      if (!updateResult.affected) {
        res.status(constants.STATUS_CODES.NOT_FOUND).json({
          success: false,
          message: "Tally Details not found for update",
        });
        return;
      }
    }

    /* =====================================================
       UPDATE TI_PACKDET (UNCHANGED)
    ===================================================== */
    await AppDataSource.query(
      `UPDATE TI_PACKDET
       SET QTY1_ARRIVED = :v_pda_qty_puom,
           QTY2_ARRIVED = :v_pda_qty_luom,
           QUANTITY_ARRIVED = :v_pda_quantity
       WHERE COMPANY_CODE = :v_company_code
         AND JOB_NO = :v_job_no
         AND PRIN_CODE = :v_prin_code
         AND PROD_CODE = :v_prod_code
         AND PACKDET_NO = :v_packdet_no`,
      [
        pda_qty_puom,
        pda_qty_luom,
        pda_quantity,
        companyCode,
        job_no,
        prin_code,
        prod_code,
        packdet_no,
      ]
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `Tally Details ${
        seq_number ? "updated" : "created"
      } successfully`,
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message,
    });
    return;
  }
};




export const updateTallyItem = async (req: RequestWithTenant, res: Response) => {
  try {
    const requestUser: IUser = req.user;
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      return res.status(400).json({ success:false,message:"company_code not found on authenticated user"});
    }
    const { packdet_no , seq_number} = req.params;
    const { prin_code, job_no } = req.query;
console.log ('seq_number',seq_number);
    const { error } = tallyDetailsSchema(
      req.body,
      false,
      companyCode
    );
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    const tallyDetailsRepo = AppDataSource.getRepository(TiTallyDetail);
    const tallyResponse = await tallyDetailsRepo.findOne({
      where: {
        company_code: companyCode,
        packdet_no: Number(packdet_no),
        prin_code: prin_code as string,
        job_no: job_no as string,
        seq_number: Number(seq_number),
      },
    });
    if (!tallyResponse) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Tally " + constants.MESSAGES.NOT_FOUND,
      });
      return;
    }
    if (!!req.body?.prod_code) {
      const productRepo = AppDataSource.getRepository(Product);
      const productResponse = await productRepo.findOne({
        where: {
          company_code: companyCode,
          prod_code: req.body.prod_code,
        },
      });
      if (!productResponse) {
        res.status(constants.STATUS_CODES.NOT_FOUND).json({
          success: false,
          message: "Product " + constants.MESSAGES.NOT_FOUND,
        });
        return;
      }
    }

    if (!!req.body?.country_code) {
      const countryRepo = AppDataSource.getRepository(CountryMaster);
      const countryResponse = await countryRepo.findOne({
        where: {
          company_code: companyCode,
          country_code: req.body.country_code,
        },
      });
      if (!countryResponse) {
        res.status(constants.STATUS_CODES.NOT_FOUND).json({
          success: false,
          message: "Country " + constants.MESSAGES.NOT_FOUND,
        });
        return;
      }
    }

    const response = await tallyDetailsRepo.update(
      {
        company_code: companyCode,
        packdet_no: Number(packdet_no),
        prin_code: prin_code as string,
        job_no: job_no as string,
        seq_number: Number(seq_number)
      },
      {
        ...req.body,
        packdet_no: Number(packdet_no),
        updated_by: requestUser.loginid,
      }
    );
    if (!response) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: response });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Tally Details " + constants.MESSAGES.UPDATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};

export const deleteTallyItem = async (
  req: RequestWithTenant,
  res: Response
): Promise<any> => {
  try {
    const { tally_details } = req.body;
    const requestUser = req.user;
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      return res.status(400).json({ success:false,message:"company_code not found on authenticated user"});
    }
    if (tally_details.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide at least one tally item to delete",
      });
    }

    const tallyDetailsRepo = AppDataSource.getRepository(TiTallyDetail);
    await Promise.all(
      tally_details.map(
        async (TallyDetail: {
          prin_code: string;
          job_no: string;
          packdet_no: number;
          seq_number: number;
        }) => {
          const { prin_code, job_no, packdet_no ,seq_number} = TallyDetail;

          return await tallyDetailsRepo.delete({
            prin_code,
            job_no,
            packdet_no,
            company_code: companyCode,
            seq_number
          });
        }
      )
    );

    return res.status(200).json({
      success: true,
      message: "Deleted successfully",
    });
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const createBulkTallyDetails = async (
  req: RequestWithTenant,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      return res.status(400).json({ success:false,message:"company_code not found on authenticated user"});
    }

    const { error } = tallyDetailsSchema(
      req.body,
      true,
      companyCode
    );
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    req.body = req.body.map((tallyDetail: ITallyDetailsWms) => ({
      ...tallyDetail,
      updated_by: requestUser.loginid,
      created_by: requestUser.loginid,
    }));

    const tallyDetailsRepo = AppDataSource.getRepository(TiTallyDetail);
    await tallyDetailsRepo.insert(req.body);

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Tally Details " + constants.MESSAGES.IMPORTED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const exportTallyDetails = async (
  req: RequestWithTenant,
  res: Response
) => {
  try {
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      return res.status(400).json({ success:false,message:"company_code not found on authenticated user"});
    }
    let csvTransform: fastCsv.CsvFormatterStream<
      fastCsv.FormatterRow,
      fastCsv.FormatterRow
    >;
    let fetchedData: any[] = [];

    const filter: ISearch = req.query.filter
      ? JSON.parse(req.query.filter as string)
      : {};

    const whereConditions: any = {
      company_code: companyCode,
    };

    // Apply search filters if present
    if (filter.search) {
      // Add TypeORM compatible search filters
      // Example: if searching by prod_code
      Object.keys(filter.search).forEach((key: string) => {
        if ((filter.search as any)[key]) {
          whereConditions[key] = Like(`%${(filter.search as any)[key]}%`);
        }
      });
    }

    const tallyDetailsRepo = AppDataSource.getRepository(TiTallyDetail);
    fetchedData = await tallyDetailsRepo.find({
      where: whereConditions,
    });

    csvTransform = fastCsv.format({
      headers: WmsCsvHeaders.TANSACTION.INBOUND.TALLY_DETAIL,
    });

    // Set headers for CSV response before streaming
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="tally_details.csv"`
    );

    // Write data to the CSV stream
    fetchedData.forEach((eachData) => {
      csvTransform.write(eachData); // Write each row to the CSV stream
    });

    // End the CSV stream and pipe it to the response
    csvTransform.end(); // Complete the CSV data transformation
    csvTransform.pipe(res); // Pipe CSV data into the HTTP response
  } catch (error: any) {
    console.error("Export Error:", error); // Log the error for debugging
    res.status(400).json({ success: false, message: error.message });
  }
};