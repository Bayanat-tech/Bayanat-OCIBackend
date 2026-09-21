// controllers/StockTransfer/stocktransferget.controller.ts

import { Response } from "express";
import { TsStnService } from "../../services/WMS/TsStn.service";
import { TsStndetailService } from "../../services/WMS/TsStndetail.service";
import { RequestWithTenant } from "../../middleware/tenant.middleware";

export const createSTNDetail = async (req: RequestWithTenant, res: Response) => {
  try {
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      return res.status(400).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
    }

    // Handle both uppercase and lowercase field names (company_code no longer accepted from body)
    const {
      PRIN_CODE, prin_code,
      STN_NO, stn_no,
      SERIAL_NO, serial_no,
      SEQ_NUMBER, seq_number,
      PROD_CODE, prod_code,
      JOB_NO, job_no,
      CONTAINER_NO, container_no,
      DOC_REF, doc_ref,
      FROM_SITE, from_site,
      TO_SITE, to_site,
      FROM_LOC_START, from_loc_start,
      FROM_LOC_END, from_loc_end,
      TO_LOC_START, to_loc_start,
      TO_LOC_END, to_loc_end,
      FROM_COLUMN_START, from_column_start,
      FROM_COLUMN_END, from_column_end,
      TO_COLUMN_START, to_column_start,
      TO_COLUMN_END, to_column_end,
      FROM_HEIGHT_START, from_height_start,
      FROM_HEIGHT_END, from_height_end,
      TO_HEIGHT_START, to_height_start,
      TO_HEIGHT_END, to_height_end,
      FROM_AISLE_START, from_aisle_start,
      FROM_AISLE_END, from_aisle_end,
      TO_AISLE_START, to_aisle_start,
      TO_AISLE_END, to_aisle_end,
      LOT_NO, lot_no,
      MFG_DATE, mfg_date,
      EXP_DATE, exp_date,
      USER_ID, user_id,
      QTY_PUOM, qty_puom,
      QTY_LUOM, qty_luom,
      P_UOM, p_uom,
      L_UOM, l_uom,
      QUANTITY, quantity,
      KEY_NUMBER, key_number,
      PALLET_ID, pallet_id,
      ALLOCATED, allocated,
      CONFIRMED, confirmed,
      MIXED_PUTAWAY, mixed_putaway,
      SELECTED, selected,
      PROCESSED, processed,
      RECEIPT_TYPE, receipt_type,
      EXP_DATE_TO, exp_date_to,
      EXP_DATE_FROM, exp_date_from,
      MFG_DATE_FROM, mfg_date_from,
      MFG_DATE_TO, mfg_date_to,
      LOT_NO_TO, lot_no_to,
      BATCH_NO_FROM, batch_no_from,
      BATCH_NO_TO, batch_no_to,
      COUNT_NO, count_no,
      MULTI_SERIES, multi_series,
      CARTON_NO_FROM, carton_no_from,
      CARTON_NO_TO, carton_no_to,
      PALLET_ID_FROM, pallet_id_from,
      PALLET_ID_TO, pallet_id_to,
    } = req.body;

    const prinCode = PRIN_CODE || prin_code;
    const stnNo = STN_NO || stn_no;
    let serialNo = SERIAL_NO || serial_no;

    if (!prinCode || !stnNo) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: prin_code, stn_no",
      });
    }

    const qtyPuom = QTY_PUOM !== undefined ? QTY_PUOM : qty_puom;
    const qtyLuom = QTY_LUOM !== undefined ? QTY_LUOM : qty_luom;
    const qty = QUANTITY !== undefined ? QUANTITY : quantity;

    if (qtyPuom === undefined || qtyPuom === null || qtyPuom <= 0) {
      return res.status(400).json({
        success: false,
        message: "qty_puom (Primary UOM Quantity) is required and must be greater than 0",
      });
    }

    if (!serialNo) {
      try {
        serialNo = await TsStndetailService.getNextSerialNo({
          stn_no: Number(stnNo),
          company_code: companyCode,
        });
      } catch (error) {
        console.error("Error in getNextSerialNo:", error);
        throw error;
      }
    }

    const exists = await TsStndetailService.checkStndetailExists({
      company_code: companyCode,
      prin_code: prinCode,
      stn_no: Number(stnNo),
      serial_no: Number(serialNo),
    });

    if (exists) {
      return res.status(409).json({
        success: false,
        message: "STN Detail record already exists with this combination of company_code, prin_code, stn_no, and serial_no",
      });
    }

    const stnDetailData: any = {
      company_code: companyCode,
      prin_code: prinCode,
      stn_no: Number(stnNo),
      serial_no: Number(serialNo),
      seq_number: (SEQ_NUMBER || seq_number) || 0,
      user_id: (USER_ID || user_id) || "USER",
      user_dt: new Date(),
      allocated: (ALLOCATED || allocated) || "N",
      confirmed: (CONFIRMED || confirmed) || "N",
      mixed_putaway: (MIXED_PUTAWAY || mixed_putaway) || "N",
      selected: (SELECTED || selected) || "N",
      processed: (PROCESSED || processed) || "N",
      receipt_type: (RECEIPT_TYPE || receipt_type) || "N",
      multi_series: (MULTI_SERIES || multi_series) || "N",
    };

    const prodCode = PROD_CODE || prod_code;
    const jobNo = JOB_NO || job_no;
    const containerNo = CONTAINER_NO || container_no;
    const docRef = DOC_REF || doc_ref;
    const fromSite = FROM_SITE || from_site;
    const toSite = TO_SITE || to_site;
    const fromLocStart = FROM_LOC_START || from_loc_start;
    const fromLocEnd = FROM_LOC_END || from_loc_end;
    const toLocStart = TO_LOC_START || to_loc_start;
    const toLocEnd = TO_LOC_END || to_loc_end;
    const fromColumnStart = FROM_COLUMN_START !== undefined ? FROM_COLUMN_START : from_column_start;
    const fromColumnEnd = FROM_COLUMN_END !== undefined ? FROM_COLUMN_END : from_column_end;
    const toColumnStart = TO_COLUMN_START !== undefined ? TO_COLUMN_START : to_column_start;
    const toColumnEnd = TO_COLUMN_END !== undefined ? TO_COLUMN_END : to_column_end;
    const fromHeightStart = FROM_HEIGHT_START !== undefined ? FROM_HEIGHT_START : from_height_start;
    const fromHeightEnd = FROM_HEIGHT_END !== undefined ? FROM_HEIGHT_END : from_height_end;
    const toHeightStart = TO_HEIGHT_START !== undefined ? TO_HEIGHT_START : to_height_start;
    const toHeightEnd = TO_HEIGHT_END !== undefined ? TO_HEIGHT_END : to_height_end;
    const fromAisleStart = FROM_AISLE_START || from_aisle_start;
    const fromAisleEnd = FROM_AISLE_END || from_aisle_end;
    const toAisleStart = TO_AISLE_START || to_aisle_start;
    const toAisleEnd = TO_AISLE_END || to_aisle_end;
    const lotNo = LOT_NO || lot_no;
    const mfgDate = MFG_DATE || mfg_date;
    const expDate = EXP_DATE || exp_date;
    const pUom = P_UOM || p_uom;
    const lUom = L_UOM || l_uom;
    const keyNumber = KEY_NUMBER || key_number;
    const palletId = PALLET_ID || pallet_id;
    const expDateTo = EXP_DATE_TO || exp_date_to;
    const expDateFrom = EXP_DATE_FROM || exp_date_from;
    const mfgDateTo = MFG_DATE_TO || mfg_date_to;
    const mfgDateFrom = MFG_DATE_FROM || mfg_date_from;
    const lotNoTo = LOT_NO_TO || lot_no_to;
    const batchNoFrom = BATCH_NO_FROM || batch_no_from;
    const batchNoTo = BATCH_NO_TO || batch_no_to;
    const countNo = COUNT_NO || count_no;
    const cartonNoFrom = CARTON_NO_FROM || carton_no_from;
    const cartonNoTo = CARTON_NO_TO || carton_no_to;
    const palletIdFrom = PALLET_ID_FROM || pallet_id_from;
    const palletIdTo = PALLET_ID_TO || pallet_id_to;

    if (expDateFrom) stnDetailData.exp_date_from = new Date(expDateFrom);
    if (mfgDateTo) stnDetailData.mfg_date_to = new Date(mfgDateTo);
    if (mfgDateFrom) stnDetailData.mfg_date_from = new Date(mfgDateFrom);
    if (prodCode) stnDetailData.prod_code = prodCode;
    if (jobNo) stnDetailData.job_no = jobNo;
    if (containerNo) stnDetailData.container_no = containerNo;
    if (docRef) stnDetailData.doc_ref = docRef;
    if (fromSite) stnDetailData.from_site = fromSite;
    if (toSite) stnDetailData.to_site = toSite;
    if (fromLocStart) stnDetailData.from_loc_start = fromLocStart;
    if (fromLocEnd) stnDetailData.from_loc_end = fromLocEnd;
    if (toLocStart) stnDetailData.to_loc_start = toLocStart;
    if (toLocEnd) stnDetailData.to_loc_end = toLocEnd;
    if (fromColumnStart !== undefined) stnDetailData.from_column_start = fromColumnStart;
    if (fromColumnEnd !== undefined) stnDetailData.from_column_end = fromColumnEnd;
    if (toColumnStart !== undefined) stnDetailData.to_column_start = toColumnStart;
    if (toColumnEnd !== undefined) stnDetailData.to_column_end = toColumnEnd;
    if (fromHeightStart !== undefined) stnDetailData.from_height_start = fromHeightStart;
    if (fromHeightEnd !== undefined) stnDetailData.from_height_end = fromHeightEnd;
    if (toHeightStart !== undefined) stnDetailData.to_height_start = toHeightStart;
    if (toHeightEnd !== undefined) stnDetailData.to_height_end = toHeightEnd;
    if (fromAisleStart) stnDetailData.from_aisle_start = fromAisleStart;
    if (fromAisleEnd) stnDetailData.from_aisle_end = fromAisleEnd;
    if (toAisleStart) stnDetailData.to_aisle_start = toAisleStart;
    if (toAisleEnd) stnDetailData.to_aisle_end = toAisleEnd;
    if (lotNo) stnDetailData.lot_no = lotNo;
    if (mfgDate) stnDetailData.mfg_date = new Date(mfgDate);
    if (expDate) stnDetailData.exp_date = new Date(expDate);
    if (qtyPuom !== undefined) stnDetailData.qty_puom = qtyPuom;
    if (qtyLuom !== undefined) stnDetailData.qty_luom = qtyLuom;
    if (pUom) stnDetailData.p_uom = pUom;
    if (lUom) stnDetailData.l_uom = lUom;
    if (qty !== undefined) stnDetailData.quantity = qty;
    if (keyNumber) stnDetailData.key_number = keyNumber;
    if (palletId) stnDetailData.pallet_id = palletId;
    if (expDateTo) stnDetailData.exp_date_to = new Date(expDateTo);
    if (lotNoTo) stnDetailData.lot_no_to = lotNoTo;
    if (batchNoFrom) stnDetailData.batch_no_from = batchNoFrom;
    if (batchNoTo) stnDetailData.batch_no_to = batchNoTo;
    if (countNo) stnDetailData.count_no = countNo;
    if (cartonNoFrom) stnDetailData.carton_no_from = cartonNoFrom;
    if (cartonNoTo) stnDetailData.carton_no_to = cartonNoTo;
    if (palletIdFrom) stnDetailData.pallet_id_from = palletIdFrom;
    if (palletIdTo) stnDetailData.pallet_id_to = palletIdTo;

    const newSTNDetail = await TsStndetailService.createStndetail(stnDetailData);

    res.status(201).json({
      success: true,
      message: "STN Detail created successfully",
      data: newSTNDetail,
    });
  } catch (error) {
    console.error("Error creating STN Detail:", error);
    if (error instanceof Error) {
      console.error("Stack trace:", error.stack);
    }
    res.status(500).json({
      success: false,
      message: "Internal server error while creating STN Detail",
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
};

export const createSTN = async (req: RequestWithTenant, res: Response) => {
  try {
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      return res.status(400).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
    }

    const { prin_code, description, stn_date, user_id } = req.body;

    if (!prin_code) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: prin_code",
      });
    }

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: user_id",
      });
    }

    const stnData = {
      company_code: companyCode,
      prin_code,
      description: description || null,
      stn_date: stn_date ? new Date(stn_date) : new Date(),
      user_id,
      allocated: "N",
      confirmed: "N",
      user_dt: new Date(),
    };

    const newSTN = await TsStnService.createStn(stnData);

    res.status(201).json({
      success: true,
      message: "STN created successfully",
      data: newSTN,
    });
  } catch (error) {
    console.error("Error creating STN:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while creating STN",
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const getAllStockTransfers = async (req: RequestWithTenant, res: Response) => {
  try {
    const companyCode = req.user?.company_code;

    if (!companyCode) {
      return res.status(400).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
    }

    const stockTransfers = await TsStnService.findAllWithPrincipalName(companyCode);

    res.status(200).json({
      success: true,
      data: stockTransfers,
      count: stockTransfers.length,
    });
  } catch (error) {
    console.error("Error fetching all stock transfers:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while fetching stock transfers",
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const getTSSTNWithDetails = async (req: RequestWithTenant, res: Response) => {
  const companyCode = req.user?.company_code;
  const { stn_no, prin_code } = req.query;

  if (!companyCode) {
    return res.status(400).json({
      success: false,
      message: "company_code not found on authenticated user",
    });
  }

  try {
    let header;
    if (stn_no) {
      const singleHeader = await TsStnService.findById({
        stn_no: Number(stn_no),
        company_code: companyCode,
      });
      header = singleHeader ? [singleHeader] : [];
    } else if (prin_code) {
      header = await TsStnService.findByCompanyAndPrinCode({
        company_code: companyCode,
        prin_code: prin_code as string,
      });
    } else {
      header = await TsStnService.findByCompanyCode(companyCode);
    }

    if (!header.length) {
      return res.status(404).json({
        success: false,
        message: "No STN record found for the given parameters",
      });
    }

    let details: any[] = [];
    if (stn_no) {
      if (prin_code) {
        details = await TsStndetailService.findByStnAndMultiplePrinCodes({
          stn_no: Number(stn_no),
          company_code: companyCode,
          prin_codes: [prin_code as string],
        });
      } else {
        details = await TsStndetailService.findByStnNo({
          stn_no: Number(stn_no),
          company_code: companyCode,
        });
      }
    } else if (prin_code) {
      details = await TsStndetailService.findByCompanyAndPrinCode({
        company_code: companyCode,
        prin_code: prin_code as string,
      });
    } else {
      details = await TsStndetailService.findByCompanyCode(companyCode);
    }

    res.status(200).json({
      success: true,
      data: { header, details },
    });
  } catch (error) {
    console.error("Error fetching TS_STN data:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while fetching TS_STN data",
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const editSTN = async (req: RequestWithTenant, res: Response) => {
  try {
    const companyCode = req.user?.company_code;
    const { stn_no } = req.params;
    const updateData = req.body;

    if (!companyCode) {
      return res.status(400).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
    }

    if (!stn_no) {
      return res.status(400).json({
        success: false,
        message: "Missing required path parameter: stn_no",
      });
    }

    const stnNoNumber = Number(stn_no);
    if (isNaN(stnNoNumber)) {
      return res.status(400).json({
        success: false,
        message: "Invalid stn_no: must be a number",
      });
    }

    const stnExists = await TsStnService.checkStnExists({
      stn_no: stnNoNumber,
      company_code: companyCode,
    });

    if (!stnExists) {
      return res.status(404).json({
        success: false,
        message: `STN record with stn_no ${stn_no} not found for your company`,
      });
    }

    const allowedFields = [
      'prin_code',
      'description',
      'stn_date',
      'allocated',
      'confirmed',
      'cancelled',
      'date_cancelled',
    ];

    const sanitizedUpdateData: any = {};

    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        sanitizedUpdateData[field] = updateData[field];
      }
    }

    if (sanitizedUpdateData.stn_date) {
      sanitizedUpdateData.stn_date = new Date(sanitizedUpdateData.stn_date);
    }

    if (sanitizedUpdateData.date_cancelled) {
      sanitizedUpdateData.date_cancelled = new Date(sanitizedUpdateData.date_cancelled);
    }

    sanitizedUpdateData.user_dt = new Date();

    if (updateData.user_id) {
      sanitizedUpdateData.user_id = updateData.user_id;
    }

    if (Object.keys(sanitizedUpdateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update",
      });
    }

    const updated = await TsStnService.updateStn(
      { stn_no: stnNoNumber, company_code: companyCode },
      sanitizedUpdateData
    );

    if (updated) {
      const updatedSTN = await TsStnService.findById({
        stn_no: stnNoNumber,
        company_code: companyCode,
      });

      res.status(200).json({
        success: true,
        message: "STN updated successfully",
        data: updatedSTN,
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to update STN record",
      });
    }
  } catch (error) {
    console.error("Error updating STN:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while updating STN",
      error: error instanceof Error ? error.message : error,
    });
  }
};