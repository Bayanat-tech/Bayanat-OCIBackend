import { Response } from "express";
import { TaAdjDetailService } from "../../services/WMS/taAdjDetail.service";
import { TaAdjHeaderService } from "../../services/WMS/taAdjHeader.service";
import { ICreateStockAdjustmentRequest, IProcessAdjustmentRequest } from "../../interfaces/wms/stockAdjustment.interface";
import { RequestWithTenant } from "../../middleware/tenant.middleware";
import constants from "../../helpers/constants";

const paramValue = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? "" : value ?? "";

export const createStockAdjustment = async (
  req: RequestWithTenant,
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
    const COMPANY_CODE = req.user?.company_code;
    if (!COMPANY_CODE) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
      return;
    }
    const username = req.user.loginid;

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
      ...(ADJ_TYPE === '-' && { KEY_NUMBER }),   
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

export const getStockAdjustments = async (
  req: RequestWithTenant,
  res: Response
) => {
  try {
    const COMPANY_CODE = req.user?.company_code;
    if (!COMPANY_CODE) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
      return;
    }

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
  req: RequestWithTenant,
  res: Response
) => {
  try {
    const ADJ_CODE = paramValue(req.params.ADJ_CODE);

    if (!ADJ_CODE) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "ADJ_CODE is required",
      });
      return;
    }

    const COMPANY_CODE = req.user?.company_code;
    if (!COMPANY_CODE) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code not found on authenticated user",
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
  req: RequestWithTenant,
  res: Response
) => {
  try {
    const ADJ_CODE = paramValue(req.params.ADJ_CODE);

    if (!ADJ_CODE) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "ADJ_CODE is required",
      });
      return;
    }

    const COMPANY_CODE = req.user?.company_code;
    if (!COMPANY_CODE) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code not found on authenticated user",
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

// processAdjustment left as-is: COMPANY_CODE is an explicit required
// field in the request body (multi-tenant confirm-by-another-user flows),
// not derived from the authenticated user's tenant context.
export const processAdjustment = async (
  req: RequestWithTenant,
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
  req: RequestWithTenant,
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
    const COMPANY_CODE = req.user?.company_code;
    if (!COMPANY_CODE) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
      return;
    }

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

export const createAdjHeader = async (req: RequestWithTenant, res: Response) => {
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

    const COMPANY_CODE = req.user?.company_code;
    if (!COMPANY_CODE) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
    }

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
  req: RequestWithTenant,
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
      MFG_DATE,
      EXP_DATE,
      BATCH_NO,
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

    // KEY_NUMBER only required for subtraction (-)
    if (ADJ_TYPE === '-' && !KEY_NUMBER) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "KEY_NUMBER is required for adjustment type '-'",
      });
    }
// ── Date parser: handles ISO strings / null safely ─────────────────────
    const parseDate = (val: any): Date | null => {
      if (!val) return null;
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
    };

    // Get user info from request
    const COMPANY_CODE = req.user?.company_code;
    if (!COMPANY_CODE) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
    }
    const username = req.user.loginid;

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
      MANU_CODE,
      DOC_REF,
      KEY_NUMBER:  ADJ_TYPE === '+' ? null : KEY_NUMBER,
      PALLET_ID,
      QTY_PUOM,
      QTY_LUOM,
      ADJ_TYPE,
      MFG_DATE:    ADJ_TYPE === '+' ? parseDate(MFG_DATE) : null,
      EXP_DATE:    ADJ_TYPE === '+' ? parseDate(EXP_DATE) : null,
      BATCH_NO:    ADJ_TYPE === '+' ? BATCH_NO  : null,
      LOT_NO:      ADJ_TYPE === '+' ? LOT_NO    : null,
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

// confirmAdjDetail left as-is: P_COMPANY_CODE is an explicit required
// field in the request body, not derived from the authenticated user's
// tenant context.
export const confirmAdjDetail = async (
  req: RequestWithTenant,
  res: Response
): Promise<void> => {
  try {
    const { P_COMPANY_CODE, P_PRIN_CODE, P_ADJ_NO, P_USERID, P_ADJ_SERIALNO } = req.body;

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

export const deleteStockAdjustmentDetail = async (
  req: RequestWithTenant,
  res: Response
) => {
  try {
    const ADJ_CODE = paramValue(req.params.ADJ_CODE);
    const JOB_NO = paramValue(req.params.JOB_NO);

    if (!ADJ_CODE) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "ADJ_CODE is required",
      });
    }

    if (!JOB_NO) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "JOB_NO is required",
      });
    }

    const COMPANY_CODE = req.user?.company_code;
    if (!COMPANY_CODE) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
    }

    // Check if adjustment header exists
    const existingHeader = await TaAdjHeaderService.findByAdjCode(
      ADJ_CODE,
      COMPANY_CODE
    );

    if (!existingHeader) {
      return res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Stock adjustment header not found",
      });
    }

    // Check if detail exists
    const allDetails = await TaAdjDetailService.findByCompany(COMPANY_CODE);
    const existingDetail = allDetails.find(
      detail => detail.JOB_NO === JOB_NO && detail.ADJ_NO === existingHeader.ADJ_NO
    );

    if (!existingDetail) {
      return res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Stock adjustment detail not found",
      });
    }

    // Delete the detail using existing deleteAdjustment method
    const detailDeleted = await TaAdjDetailService.deleteAdjustment(
      JOB_NO,
      COMPANY_CODE
    );

    if (detailDeleted) {
      return res.status(constants.STATUS_CODES.OK).json({
        success: true,
        message: "Stock adjustment detail deleted successfully",
      });
    } else {
      return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Failed to delete stock adjustment detail",
      });
    }
  } catch (error: any) {
    console.error("Error deleting stock adjustment detail:", error);
    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to delete stock adjustment detail",
      error: error.message,
    });
  }
};

export const editAdjDetail = async (
  req: RequestWithTenant,
  res: Response
) => {
  try {
    const {
      ADJ_NO,
      ADJ_SERIALNO,
      JOB_NO,
      PRIN_CODE,
      PROD_CODE,
      SITE_CODE,
      LOCATION_CODE,
      P_UOM,
      L_UOM,
      KEY_NUMBER,
      QTY_PUOM,
      QTY_LUOM,
        QUANTITY,        // ← add this
      ADJ_TYPE,
      PALLET_ID,
    } = req.body;

    if (!ADJ_NO)       return res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: "ADJ_NO is required" });
    if (!JOB_NO)       return res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: "JOB_NO is required" });
    if (!PRIN_CODE)    return res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: "PRIN_CODE is required" });
    if (!KEY_NUMBER)   return res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: "KEY_NUMBER is required" });

    const COMPANY_CODE = req.user?.company_code;
    if (!COMPANY_CODE) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
    }
    const USER_ID = req.user.loginid;

    // Check the record exists first
    const existing = await TaAdjDetailService.findByJobNo(JOB_NO, COMPANY_CODE);
    if (!existing) {
      return res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Adjustment detail not found",
      });
    }

// Controller — just change the updateAdjustment call
const updated = await TaAdjDetailService.updateAdjustment(
  {
    ADJ_NO:       Number(ADJ_NO),
    ADJ_SERIALNO: Number(ADJ_SERIALNO),
    PRIN_CODE,
    COMPANY_CODE,
  },
  {
    PROD_CODE,
    SITE_CODE,
    LOCATION_CODE,
    P_UOM,
    L_UOM,
    KEY_NUMBER,
    QTY_PUOM,
    QTY_LUOM,
    QUANTITY,
    ADJ_TYPE,
    PALLET_ID,
    USER_ID,
  }
);
    if (!updated) {
      return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Failed to update adjustment detail",
      });
    }

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Adjustment detail updated successfully",
    });
  } catch (error: any) {
    console.error("Error editing adjustment detail:", error);
    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to edit adjustment detail",
      error: error.message,
    });
  }
};

export const deleteAdjDetail = async (
  req: RequestWithTenant,
  res: Response
) => {
  try {
    const ADJ_CODE = paramValue(req.params.ADJ_CODE);
    const JOB_NO = paramValue(req.params.JOB_NO);

    if (!ADJ_CODE) return res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: "ADJ_CODE is required" });
    if (!JOB_NO)   return res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: "JOB_NO is required" });

    const COMPANY_CODE = req.user?.company_code;
    if (!COMPANY_CODE) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
    }

    // Check the record exists first
    const existing = await TaAdjDetailService.findByJobNo(JOB_NO, COMPANY_CODE);
    if (!existing) {
      return res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Adjustment detail not found",
      });
    }

    const deleted = await TaAdjDetailService.deleteAdjustment(JOB_NO, COMPANY_CODE);

    if (!deleted) {
      return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Failed to delete adjustment detail",
      });
    }

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Adjustment detail deleted successfully",
    });
  } catch (error: any) {
    console.error("Error deleting adjustment detail:", error);
    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to delete adjustment detail",
      error: error.message,
    });
  }
};
