import { Response } from "express";
import { TaAdjDetailService } from "../../services/WMS/taAdjDetail.service";
import { TaAdjHeaderService } from "../../services/WMS/taAdjHeader.service";
import { ICreateStockAdjustmentRequest, IProcessAdjustmentRequest } from "../../interfaces/wms/stockAdjustment.interface";
import { RequestWithUser } from "../../interfaces/common.interface";
import constants from "../../helpers/constants";

export const createStockAdjustment = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const { 
      // Header fields
      ADJ_CODE,
      PRIN_CODE,
      REMARKS,
      CONFIRMED,
      ADJ_DATE,
      CONFIRMED_DATE,
      
      // Detail fields
      JOB_NO, 
      PROD_CODE, 
      ADJ_TYPE,
      QTY_PUOM, 
      SITE_CODE,
      LOCATION_CODE,
      QTY_LUOM, 
      P_UOM,
      L_UOM,
      PALLET_ID,
      KEY_NUMBER
    }: ICreateStockAdjustmentRequest = req.body;

    // Validate required fields
    if (!ADJ_CODE) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "ADJ_CODE is required",
      });
      return;
    }

    if (!JOB_NO) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "JOB_NO is required",
      });
      return;
    }

    // Get user info from request
    const requestUser = req.user;
    const COMPANY_CODE = requestUser.company_code;
    const username = requestUser.loginid;

    // Create stock adjustment header (ADJ_NO will be auto-generated in service)
    const newHeader = await TaAdjHeaderService.createHeader({
      ADJ_CODE,
      PRIN_CODE,
      REMARKS,
      CONFIRMED: CONFIRMED || "N",
      ADJ_DATE,
      CONFIRMED_DATE,
      COMPANY_CODE,
    });

    // Get the generated ADJ_NO from the saved header
    const ADJ_NO = newHeader.ADJ_NO;

    // Create stock adjustment detail with the ADJ_NO from header
    const newDetail = await TaAdjDetailService.createAdjustment({
      ADJ_NO,
      ADJ_SERIALNO: 1, // Hardcoded value
      JOB_NO,
      PROD_CODE,
      ADJ_TYPE,
      QTY_PUOM,
      SITE_CODE,
      LOCATION_CODE,
      QTY_LUOM,
      PRIN_CODE,
      P_UOM,
      L_UOM,
      PALLET_ID,
      KEY_NUMBER: KEY_NUMBER || "0",
      COMPANY_CODE,
      CREATED_BY: username,
      UPDATED_BY: username,
    });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Stock adjustment created successfully",
      data: {
        header: newHeader,
        detail: newDetail,
      },
    });
  } catch (error: any) {
    console.error("Error creating stock adjustment:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to create stock adjustment",
      error: error.message,
    });
  }
};

export const updateStockAdjustment = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const { ADJ_CODE } = req.params;
    const { 
      // Header fields
      PRIN_CODE,
      REMARKS,
      CONFIRMED,
      ADJ_DATE,
      CONFIRMED_DATE,
      
      // Detail fields
      JOB_NO,
      PROD_CODE, 
      ADJ_TYPE,
      QTY_PUOM, 
      SITE_CODE,
      LOCATION_CODE,
      QTY_LUOM, 
      P_UOM,
      L_UOM,
      PALLET_ID,
      KEY_NUMBER
    }: ICreateStockAdjustmentRequest = req.body;

    if (!ADJ_CODE) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "ADJ_CODE is required",
      });
      return;
    }

    const requestUser = req.user;
    const COMPANY_CODE = requestUser.company_code;
    const username = requestUser.loginid;

    // Check if adjustment header exists
    const existingHeader = await TaAdjHeaderService.findByAdjCode(
      ADJ_CODE,
      COMPANY_CODE
    );

    if (!existingHeader) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Stock adjustment header not found",
      });
      return;
    }

    // Update stock adjustment header
    const headerUpdated = await TaAdjHeaderService.updateHeader(
      ADJ_CODE,
      COMPANY_CODE,
      {
        PRIN_CODE,
        REMARKS,
        CONFIRMED,
        ADJ_DATE,
        CONFIRMED_DATE,
        USER_ID: username,
      }
    );

    // Update stock adjustment detail if JOB_NO is provided
    let detailUpdated = true;
    if (JOB_NO) {
      detailUpdated = await TaAdjDetailService.updateAdjustment(
        JOB_NO,
        COMPANY_CODE,
        {
          PROD_CODE,
          ADJ_TYPE,
          QTY_PUOM,
          SITE_CODE,
          LOCATION_CODE,
          QTY_LUOM,
          PRIN_CODE,
          P_UOM,
          L_UOM,
          PALLET_ID,
          KEY_NUMBER,
          USER_ID: username,
        }
      );
    }

    if (headerUpdated && detailUpdated) {
      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        message: "Stock adjustment updated successfully",
      });
    } else {
      res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Failed to update stock adjustment",
      });
    }
  } catch (error: any) {
    console.error("Error updating stock adjustment:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to update stock adjustment",
      error: error.message,
    });
  }
};

export const getStockAdjustments = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser = req.user;
    const COMPANY_CODE = requestUser.company_code;

    const headers = await TaAdjHeaderService.findByCompany(COMPANY_CODE);
    const details = await TaAdjDetailService.findByCompany(COMPANY_CODE);

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: {
        headers,
        details,
      },
      totalCount: headers.length,
    });
  } catch (error: any) {
    console.error("Error fetching stock adjustments:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch stock adjustments",
      error: error.message,
    });
  }
};

export const getStockAdjustmentByAdjCode = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const { ADJ_CODE } = req.params;
    const requestUser = req.user;
    const COMPANY_CODE = requestUser.company_code;

    if (!ADJ_CODE) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "ADJ_CODE is required",
      });
      return;
    }

    const header = await TaAdjHeaderService.findByAdjCode(ADJ_CODE, COMPANY_CODE);

    if (!header) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Stock adjustment not found",
      });
      return;
    }

    // Fetch all details for this company (can be filtered by PRIN_CODE if needed)
    const details = await TaAdjDetailService.findByCompany(COMPANY_CODE);

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: {
        header,
        details,
      },
    });
  } catch (error: any) {
    console.error("Error fetching stock adjustment:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch stock adjustment",
      error: error.message,
    });
  }
};

export const deleteStockAdjustment = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const { ADJ_CODE } = req.params;
    const requestUser = req.user;
    const COMPANY_CODE = requestUser.company_code;

    if (!ADJ_CODE) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "ADJ_CODE is required",
      });
      return;
    }

    // Delete header and detail (you may want to add cascade delete or handle detail deletion separately)
    const headerDeleted = await TaAdjHeaderService.deleteHeader(ADJ_CODE, COMPANY_CODE);

    if (headerDeleted) {
      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        message: "Stock adjustment deleted successfully",
      });
    } else {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Stock adjustment not found",
      });
    }
  } catch (error: any) {
    console.error("Error deleting stock adjustment:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to delete stock adjustment",
      error: error.message,
    });
  }
};

export const processAdjustment = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {  
  try {
    const { COMPANY_CODE, PRIN_CODE, ADJ_NO, USERID, P_ADJ_SERIALNO }: 
      IProcessAdjustmentRequest = req.body;

    if (!COMPANY_CODE) { res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: "COMPANY_CODE is required" }); return; }
    if (!PRIN_CODE) { res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: "PRIN_CODE is required" }); return; }
    if (!ADJ_NO) { res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: "ADJ_NO is required" }); return; }
    if (!USERID) { res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: "USERID is required" }); return; }
    if (!P_ADJ_SERIALNO) { res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: "P_ADJ_SERIALNO is required" }); return; }

    await TaAdjDetailService.processAdjustment({
      COMPANY_CODE,
      PRIN_CODE,
      ADJ_NO,
      USERID,
      P_ADJ_SERIALNO,
    });

    res.status(constants.STATUS_CODES.OK).json({ success: true, message: "Stock adjustment processed successfully" });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: "Failed to process stock adjustment", error: error.message });
  }
};
export const createStockAdjustmentHeader = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const { 
      ADJ_CODE,
      PRIN_CODE,
      REMARKS,
      CONFIRMED,
      ADJ_DATE,
      CONFIRMED_DATE,
    }: {
      ADJ_CODE: string;
      PRIN_CODE?: string;
      REMARKS?: string;
      CONFIRMED?: string;
      ADJ_DATE?: Date;
      CONFIRMED_DATE?: Date;
    } = req.body;

    // Validate required fields
    if (!ADJ_CODE) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "ADJ_CODE is required",
      });
      return;
    }

    // Get user info from request
    const requestUser = req.user;
    const COMPANY_CODE = requestUser.company_code;
    const username = requestUser.loginid;

    // Create stock adjustment header (ADJ_NO will be auto-generated by trigger)
    const newHeader = await TaAdjHeaderService.createHeader({
      ADJ_CODE,
      PRIN_CODE,
      REMARKS,
      CONFIRMED: CONFIRMED || "N",
      ADJ_DATE,
      CONFIRMED_DATE,
      COMPANY_CODE,
    });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Stock adjustment header created successfully",
      data: newHeader,
    });
  } catch (error: any) {
    console.error("Error creating stock adjustment header:", error);
    console.error("Error stack:", error.stack);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to create stock adjustment header",
      error: error.message,
      details: error.stack,
    });
  }
};

export const createAdjHeader = async (req: RequestWithUser, res: Response) => {
  try {
    const { ADJ_CODE, PRIN_CODE, REMARKS, ADJ_DATE, USER_ID } = req.body as { ADJ_CODE: string; PRIN_CODE?: string; REMARKS?: string; ADJ_DATE?: Date; CONFIRMED?: string; USER_ID?: string; };

    // Validate required fields
    if (!ADJ_CODE) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "ADJ_CODE is required",
      });
    }

    if (!PRIN_CODE) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "PRIN_CODE is required",
      });
    }

    if (!USER_ID) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "USER_ID is required",
      });
    }

    const requestUser = req.user;
    const COMPANY_CODE = requestUser.company_code;

    // Create stock adjustment header (ADJ_NO will be auto-generated in service)
    const newHeader = await TaAdjHeaderService.createHeader({
      ADJ_CODE,
      PRIN_CODE,
      REMARKS,
      // CONFIRMED: CONFIRMED || "Y",  // Don't set CONFIRMED to avoid trigger
      ADJ_DATE,
      COMPANY_CODE,
      USER_ID,
    });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Adjustment header created successfully",
      data: newHeader,
    });
  } catch (error: any) {
    console.error("Error creating adjustment header:", error);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "An error occurred while creating adjustment header",
      error: error.message,
      details: error.stack,
    });
  }
};

export const createAdjustmentDetail = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const {
      ADJ_NO,
      ADJ_SERIALNO,
      PRIN_CODE,
      PROD_CODE,
      SITE_CODE,
      LOCATION_CODE,
      P_UOM,
      L_UOM,
      JOB_NO,
      LOT_NO,
      MANU_CODE,
      DOC_REF,
      KEY_NUMBER,
      PALLET_ID,
      QTY_PUOM,
      QTY_LUOM,
      ADJ_TYPE,
    } = req.body;

    // Validate required fields
    if (!ADJ_NO) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "ADJ_NO is required",
      });
    }

    if (!ADJ_SERIALNO) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "ADJ_SERIALNO is required",
      });
    }

    if (!PRIN_CODE) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "PRIN_CODE is required",
      });
    }

    if (!KEY_NUMBER) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "KEY_NUMBER is required",
      });
    }

    // Get user info from request
    const requestUser = req.user;
    const COMPANY_CODE = requestUser.company_code;
    const username = requestUser.loginid;

    // Create adjustment detail
    const newDetail = await TaAdjDetailService.createAdjustmentDetail({
      ADJ_NO,
      ADJ_SERIALNO,
      PRIN_CODE,
      COMPANY_CODE,
      PROD_CODE,
      SITE_CODE,
      LOCATION_CODE,
      P_UOM,
      L_UOM,
      JOB_NO,
      LOT_NO,
      MANU_CODE,
      DOC_REF,
      KEY_NUMBER,
      PALLET_ID,
      QTY_PUOM,
      QTY_LUOM,
      ADJ_TYPE,
      USER_ID: username,
    });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Adjustment detail created successfully",
      data: newDetail,
    });
  } catch (error: any) {
    console.error("Error creating adjustment detail:", error);
    console.error("Error stack:", error.stack);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to create adjustment detail",
      error: error.message,
      details: error.stack,
    });
  }
};

export const confirmAdjDetail = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {  // 👈
  try {
    const { P_COMPANY_CODE, P_PRIN_CODE, P_ADJ_NO, P_USERID, P_ADJ_SERIALNO } = req.body; // 👈

    // Validate required fields
    if (!P_COMPANY_CODE) {
       res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "P_COMPANY_CODE is required",
      });
    }

    if (!P_PRIN_CODE) {
       res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "P_PRIN_CODE is required",
      });
    }

    if (!P_ADJ_NO) {
       res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "P_ADJ_NO is required",
      });
    }

    console.log('Confirming adjustment detail with data:', {
      P_COMPANY_CODE,
      P_PRIN_CODE,
      P_ADJ_NO,
    });

    // Call the function to confirm adjustment detail
      await TaAdjDetailService.confirmAdjDetail({
        P_COMPANY_CODE,
        P_PRIN_CODE,
        P_ADJ_NO,
        P_USERID, 
        P_ADJ_SERIALNO,
      });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Adjustment detail confirmed successfully",
    });
  } catch (error: any) {
    console.error("Error confirming adjustment detail:", error);
    console.error("Error stack:", error.stack);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to confirm adjustment detail",
      error: error.message,
      details: error.stack,
    });
  }
};

