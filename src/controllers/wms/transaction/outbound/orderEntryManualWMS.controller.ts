import { Request, Response } from "express";
import { Transaction, QueryTypes } from "sequelize";
import { sequelize } from "../../../../database/connection";

import { TOrderDetail } from "../../../../interfaces/wms/transaction/outbound/orderEntryWms.interface";
import constants from "../../../../helpers/constants";
// === Safe Data Utility Functions ===
function safeDate(val: any): Date | null {
  return val ? new Date(val) : null;
}

function safeString(val: any): string {
  return typeof val === "string" ? val : "";
}

function safeNumber(val: any): number {
  return typeof val === "number" ? val : 0;
}

// === Main Upsert Logic ===
export async function upsertOrderDetail(
  data: TOrderDetail,
  transaction: Transaction
): Promise<void> {
  if (!transaction) throw new Error("Transaction is required");
  if (!data.job_no) throw new Error("job_no is required");

  const exists = await orderDetailExists(
    safeString(data.company_code),
    safeString(data.prin_code),
    safeString(data.job_no),
    transaction,
    safeNumber(data.serial_no)
  );

  const replacements = [
    safeString(data.company_code),
    safeString(data.prin_code),
    safeString(data.job_no),
    safeString(data.cust_code),
    safeString(data.order_no),
    safeNumber(data.serial_no),
    safeString(data.prod_code),
    safeNumber(data.qty_puom),
    safeString(data.p_uom),
    safeNumber(data.qty_luom),
    safeNumber(data.quantity),
    safeString(data.doc_ref),
    safeString(data.lot_no),
    safeString(data.po_no),
    safeString(data.imp_job_no),
    safeString(data.manu_code),
    safeString(data.container_no),
    safeDate(data.production_from),
    safeDate(data.production_to),
    safeDate(data.expiry_from),
    safeDate(data.expiry_to),
    safeNumber(data.unit_price),
    safeString(data.site_code),
    safeString(data.loc_code_from),
    safeString(data.loc_code_to),
    safeString(data.picked),
    safeString(data.confirmed),
    safeDate(data.confirmed_date),
    safeString(data.l_uom),
    safeNumber(data.uppp),
    safeString(data.selected),
    safeString(data.aisle_from),
    safeString(data.aisle_to),
    safeString(data.height_from),
    safeString(data.height_to),
    safeString(data.column_from),
    safeString(data.column_to),
    safeString(data.gate_no),
    safeNumber(data.sales_rate),
    safeString(data.exp_container_no),
    safeNumber(data.exp_container_size),
    safeString(data.exp_container_type),
    safeString(data.exp_container_sealno),
    safeString(data.moc1),
    safeString(data.moc2),
    safeNumber(data.order_serial),
    safeString(data.origin_country),
    safeNumber(data.bal_pack_qty),
    safeString(data.multi_series),
    safeString(data.prod_attrib_code),
    safeString(data.prod_grade1),
    safeString(data.prod_grade2),
    safeString(data.tx_identity_number),
    safeString(data.ref_txn_code),
    safeNumber(data.ref_txn_slno),
    safeString(data.so_txn_code),
    safeString(data.inbound_done),
    safeString(data.ref_txn_doc),
    safeString(data.supp_code),
    safeString(data.supp_reference),
    safeString(data.orig_prod_code),
    safeString(data.salesman_code),
    safeString(data.hs_code),
    safeString(data.batch_no),
    safeNumber(data.act_order_qty),
    safeNumber(data.bal_order_qty),
    safeNumber(data.minperiod_exppick),
    safeString(data.ignore_minexp_period),
    safeString(data.stock_owner),
    safeString(data.ind_code),
    safeString(data.git_no),
    safeString(data.priority),
    new Date(), // updated_at
    safeString(data.updated_by),
    safeString(data.created_by),
    new Date(), // created_at
  ];

  if (exists) {
    const updateQuery = `
      UPDATE TO_ORDER_DET SET
        cust_code=?, order_no=?, prod_code=?, qty_puom=?, p_uom=?, qty_luom=?, quantity=?,
        doc_ref=?, lot_no=?, po_no=?, imp_job_no=?, manu_code=?, container_no=?,
        production_from=?, production_to=?, expiry_from=?, expiry_to=?, unit_price=?,
        site_code=?, loc_code_from=?, loc_code_to=?, picked=?, confirmed=?, confirmed_date=?,
        l_uom=?, uppp=?, selected=?, aisle_from=?, aisle_to=?, height_from=?, height_to=?,
        column_from=?, column_to=?, gate_no=?, sales_rate=?, exp_container_no=?,
        exp_container_size=?, exp_container_type=?, exp_container_sealno=?, moc1=?, moc2=?,
        order_serial=?, origin_country=?, bal_pack_qty=?, multi_series=?, prod_attrib_code=?,
        prod_grade1=?, prod_grade2=?, tx_identity_number=?, ref_txn_code=?, ref_txn_slno=?,
        so_txn_code=?, inbound_done=?, ref_txn_doc=?, supp_code=?, supp_reference=?,
        orig_prod_code=?, salesman_code=?, hs_code=?, batch_no=?, act_order_qty=?,
        bal_order_qty=?, minperiod_exppick=?, ignore_minexp_period=?, stock_owner=?, ind_code=?,
        git_no=?, priority=?, updated_at=?, updated_by=?
      WHERE company_code=? AND prin_code=? AND job_no=? AND serial_no=?
    `;

    const updateValues = [
      safeString(data.cust_code),
      safeString(data.order_no),
      safeString(data.prod_code),
      safeNumber(data.qty_puom),
      safeString(data.p_uom),
      safeNumber(data.qty_luom),
      safeNumber(data.quantity),
      safeString(data.doc_ref),
      safeString(data.lot_no),
      safeString(data.po_no),
      safeString(data.imp_job_no),
      safeString(data.manu_code),
      safeString(data.container_no),
      safeDate(data.production_from),
      safeDate(data.production_to),
      safeDate(data.expiry_from),
      safeDate(data.expiry_to),
      safeNumber(data.unit_price),
      safeString(data.site_code),
      safeString(data.loc_code_from),
      safeString(data.loc_code_to),
      safeString(data.picked),
      safeString(data.confirmed),
      safeDate(data.confirmed_date),
      safeString(data.l_uom),
      safeNumber(data.uppp),
      safeString(data.selected),
      safeString(data.aisle_from),
      safeString(data.aisle_to),
      safeString(data.height_from),
      safeString(data.height_to),
      safeString(data.column_from),
      safeString(data.column_to),
      safeString(data.gate_no),
      safeNumber(data.sales_rate),
      safeString(data.exp_container_no),
      safeNumber(data.exp_container_size),
      safeString(data.exp_container_type),
      safeString(data.exp_container_sealno),
      safeString(data.moc1),
      safeString(data.moc2),
      safeNumber(data.order_serial),
      safeString(data.origin_country),
      safeNumber(data.bal_pack_qty),
      safeString(data.multi_series),
      safeString(data.prod_attrib_code),
      safeString(data.prod_grade1),
      safeString(data.prod_grade2),
      safeString(data.tx_identity_number),
      safeString(data.ref_txn_code),
      safeNumber(data.ref_txn_slno),
      safeString(data.so_txn_code),
      safeString(data.inbound_done),
      safeString(data.ref_txn_doc),
      safeString(data.supp_code),
      safeString(data.supp_reference),
      safeString(data.orig_prod_code),
      safeString(data.salesman_code),
      safeString(data.hs_code),
      safeString(data.batch_no),
      safeNumber(data.act_order_qty),
      safeNumber(data.bal_order_qty),
      safeNumber(data.minperiod_exppick),
      safeString(data.ignore_minexp_period),
      safeString(data.stock_owner),
      safeString(data.ind_code),
      safeString(data.git_no),
      safeString(data.priority),
      new Date(),
      safeString(data.updated_by),
      safeString(data.company_code),
      safeString(data.prin_code),
      safeString(data.job_no),
      safeNumber(data.serial_no),
    ];

    await sequelize.query(updateQuery, {
      replacements: updateValues,
      transaction,
    });
  } else {
    const insertQuery = `
      INSERT INTO TO_ORDER_DET (
        company_code, prin_code, job_no, cust_code, order_no, serial_no, prod_code, qty_puom, p_uom,
        qty_luom, quantity, doc_ref, lot_no, po_no, imp_job_no, manu_code, container_no,
        production_from, production_to, expiry_from, expiry_to, unit_price, site_code,
        loc_code_from, loc_code_to, picked, confirmed, confirmed_date, l_uom, uppp, selected,
        aisle_from, aisle_to, height_from, height_to, column_from, column_to, gate_no,
        sales_rate, exp_container_no, exp_container_size, exp_container_type,
        exp_container_sealno, moc1, moc2, order_serial, origin_country, bal_pack_qty,
        multi_series, prod_attrib_code, prod_grade1, prod_grade2, tx_identity_number,
        ref_txn_code, ref_txn_slno, so_txn_code, inbound_done, ref_txn_doc, supp_code,
        supp_reference, orig_prod_code, salesman_code, hs_code, batch_no, act_order_qty,
        bal_order_qty, minperiod_exppick, ignore_minexp_period, stock_owner, ind_code,
        git_no, priority, updated_at, updated_by, created_by, created_at
      ) VALUES (${replacements.map(() => "?").join(", ")})
    `;
    data.serial_no = 0;
    await sequelize.query(insertQuery, {
      replacements,
      transaction,
    });
  }
}

// === Helper: Check if Record Exists ===
async function orderDetailExists(
  companyCode: string,
  prinCode: string,
  jobNo: string,
  transaction: Transaction,
  serial_no: number
): Promise<boolean> {
  const result = await sequelize.query(
    `SELECT 1 FROM TO_ORDER_DET WHERE company_code=? AND prin_code=? AND job_no=? AND serial_no=? LIMIT 1  `,
    {
      replacements: [companyCode, prinCode, jobNo, serial_no],
      type: QueryTypes.SELECT,
      transaction,
    }
  );
  return result.length > 0;
}

// ✅ Named export
export const upsertOutboundOrderDetailManualHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const data: TOrderDetail = req.body;
    console.log("upsertOutboundOrderDetailManualHandler", data );
    const requiredFields: (keyof TOrderDetail)[] = [
      "job_no",
      "prin_code",
      "company_code",
    ];
    const missingFields = requiredFields.filter((field) => !data[field]);

    if (missingFields.length > 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: `Missing required field(s): ${missingFields.join(", ")}`,
      });
      return;
    }

    await sequelize.transaction(async (transaction) => {
      await upsertOrderDetail(data, transaction);
    });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Order detail upserted successfully",
    });
  } catch (error: any) {
    console.error("Upsert Order Detail Error:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Failed to upsert order detail",
    });
  }
};
export const getOutboundOrderDetailManualHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { company_code, prin_code, job_no, serial_no } = req.query;

  if (!company_code || !prin_code || !job_no || !serial_no) {
    res.status(400).json({
      success: false,
      message:
        "Missing required parameters: company_code, prin_code, job_no, serial_no",
    });
    return;
  }

  try {
    const [results] = await sequelize.query(
      `
      SELECT *
      FROM TO_ORDER_DET
      WHERE company_code = :company_code
        AND prin_code = :prin_code
        AND job_no = :job_no
        AND serial_no = :serial_no
      `,
      {
        replacements: {
          company_code,
          prin_code,
          job_no,
          serial_no: Number(serial_no),
        },
        type: QueryTypes.SELECT, // ✅ Use this, not sequelize.QueryTypes
      }
    );

    if (!results) {
      res.status(404).json({
        success: false,
        message: "No matching order detail found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: results,
    });
  } catch (error: any) {
    console.error("SQL Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch order detail using raw SQL",
    });
  }
};

export const getAllOrderDetails = async (
  req: Request,
  res: Response
): Promise<void> => {
   const { company_code, prin_code, job_no } = req.query;

    if (!company_code || !prin_code || !job_no) {
       res.status(constants.STATUS_CODES.BAD_REQUEST).json({
         success: false,
         message: 'Missing required parameters: company_code, prin_code, job_no',
       });
       return;
     }

  try {
    // Fetch all records from the TO_ORDER_DET table
    const results = await sequelize.query(
      `SELECT * FROM VW_TO_ORDER_DET
      WHERE company_code = :company_code
        AND prin_code = :prin_code
        AND job_no = :job_no
      `,
      {
        replacements: {
          company_code,
          prin_code,
          job_no,
        },
        type: QueryTypes.SELECT,
      }
    );

    if (!results || results.length === 0) {
      res.status(constants.STATUS_CODES.NO_CONTENT).json({
        success: true,
      });
      return;
    }

   

    res.status(200).json({
      success: true,
      count: results.length,
      data: results
    });
  } catch (error: any) {
    console.error('SQL Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch order details',
    });
  }
};

export const getSingleOrderDetail = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { serial_no } = req.body;

    // Validate input
    if (!serial_no) {
      res.status(400).json({
        success: false,
        message: "serial_no parameter is required in request body",
      });
      return;
    }

    // Fetch single record by serial_no
    const result = await sequelize.query(
      `SELECT * FROM VW_TO_ORDER_DET WHERE serial_no = :serial_no`,
      {
        replacements: { serial_no },
        type: QueryTypes.SELECT,
      }
    );

    if (!result || result.length === 0) {
      res.status(404).json({
        success: false,
        message: `No order detail found with serial_no: ${serial_no}`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: result[0], // Return the first (and should be only) matching record
    });
  } catch (error: any) {
    console.error("SQL Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch order detail",
    });
  }
};
