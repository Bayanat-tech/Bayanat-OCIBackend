import { Request, Response } from "express";
import oracledb, { BindParameters, ExecuteOptions, Connection } from "oracledb";
import { oracleDb } from "../../../../database/connection"; // make sure this exports oracledb.getConnection()

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
  connection: Connection
): Promise<void> {
  if (!connection) throw new Error("Oracle connection is required");
  if (!data.job_no) throw new Error("job_no is required");

  const exists = await orderDetailExists(
    safeString(data.company_code),
    safeString(data.prin_code),
    safeString(data.job_no),
    safeNumber(data.serial_no),
    connection
  );

  const binds: BindParameters = {
    company_code: safeString(data.company_code),
    prin_code: safeString(data.prin_code),
    job_no: safeString(data.job_no),
    cust_code: safeString(data.cust_code),
    order_no: safeString(data.order_no),
    serial_no: safeNumber(data.serial_no),
    prod_code: safeString(data.prod_code),
    qty_puom: safeNumber(data.qty_puom),
    p_uom: safeString(data.p_uom),
    qty_luom: safeNumber(data.qty_luom),
    quantity: safeNumber(data.quantity),
    doc_ref: safeString(data.doc_ref),
    lot_no: safeString(data.lot_no),
    po_no: safeString(data.po_no),
    imp_job_no: safeString(data.imp_job_no),
    manu_code: safeString(data.manu_code),
    container_no: safeString(data.container_no),
    production_from: safeDate(data.production_from),
    production_to: safeDate(data.production_to),
    expiry_from: safeDate(data.expiry_from),
    expiry_to: safeDate(data.expiry_to),
    unit_price: safeNumber(data.unit_price),
    site_code: safeString(data.site_code),
    loc_code_from: safeString(data.loc_code_from),
    loc_code_to: safeString(data.loc_code_to),
    picked: safeString(data.picked),
    confirmed: safeString(data.confirmed),
    confirmed_date: safeDate(data.confirmed_date),
    l_uom: safeString(data.l_uom),
    uppp: safeNumber(data.uppp),
    selected: safeString(data.selected),
    aisle_from: safeString(data.aisle_from),
    aisle_to: safeString(data.aisle_to),
    height_from: safeString(data.height_from),
    height_to: safeString(data.height_to),
    column_from: safeString(data.column_from),
    column_to: safeString(data.column_to),
    gate_no: safeString(data.gate_no),
    sales_rate: safeNumber(data.sales_rate),
    exp_container_no: safeString(data.exp_container_no),
    exp_container_size: safeNumber(data.exp_container_size),
    exp_container_type: safeString(data.exp_container_type),
    exp_container_sealno: safeString(data.exp_container_sealno),
    moc1: safeString(data.moc1),
    moc2: safeString(data.moc2),
    order_serial: safeNumber(data.order_serial),
    origin_country: safeString(data.origin_country),
    bal_pack_qty: safeNumber(data.bal_pack_qty),
    multi_series: safeString(data.multi_series),
    prod_attrib_code: safeString(data.prod_attrib_code),
    prod_grade1: safeString(data.prod_grade1),
    prod_grade2: safeString(data.prod_grade2),
    tx_identity_number: safeString(data.tx_identity_number),
    ref_txn_code: safeString(data.ref_txn_code),
    ref_txn_slno: safeNumber(data.ref_txn_slno),
    so_txn_code: safeString(data.so_txn_code),
    inbound_done: safeString(data.inbound_done),
    ref_txn_doc: safeString(data.ref_txn_doc),
    supp_code: safeString(data.supp_code),
    supp_reference: safeString(data.supp_reference),
    orig_prod_code: safeString(data.orig_prod_code),
    salesman_code: safeString(data.salesman_code),
    hs_code: safeString(data.hs_code),
    batch_no: safeString(data.batch_no),
    act_order_qty: safeNumber(data.act_order_qty),
    bal_order_qty: safeNumber(data.bal_order_qty),
    minperiod_exppick: safeNumber(data.minperiod_exppick),
    ignore_minexp_period: safeString(data.ignore_minexp_period),
    stock_owner: safeString(data.stock_owner),
    ind_code: safeString(data.ind_code),
    git_no: safeString(data.git_no),
    priority: safeString(data.priority),
    updated_at: new Date(),
    updated_by: safeString(data.updated_by),
    created_by: safeString(data.created_by),
    created_at: new Date(),
  };

  if (exists) {
    const updateQuery = `
      UPDATE TO_ORDER_DET SET
        cust_code=:cust_code,
        order_no=:order_no,
        prod_code=:prod_code,
        qty_puom=:qty_puom,
        p_uom=:p_uom,
        qty_luom=:qty_luom,
        quantity=:quantity,
        doc_ref=:doc_ref,
        lot_no=:lot_no,
        po_no=:po_no,
        imp_job_no=:imp_job_no,
        manu_code=:manu_code,
        container_no=:container_no,
        production_from=:production_from,
        production_to=:production_to,
        expiry_from=:expiry_from,
        expiry_to=:expiry_to,
        unit_price=:unit_price,
        site_code=:site_code,
        loc_code_from=:loc_code_from,
        loc_code_to=:loc_code_to,
        picked=:picked,
        confirmed=:confirmed,
        confirmed_date=:confirmed_date,
        l_uom=:l_uom,
        uppp=:uppp,
        selected=:selected,
        aisle_from=:aisle_from,
        aisle_to=:aisle_to,
        height_from=:height_from,
        height_to=:height_to,
        column_from=:column_from,
        column_to=:column_to,
        gate_no=:gate_no,
        sales_rate=:sales_rate,
        exp_container_no=:exp_container_no,
        exp_container_size=:exp_container_size,
        exp_container_type=:exp_container_type,
        exp_container_sealno=:exp_container_sealno,
        moc1=:moc1,
        moc2=:moc2,
        order_serial=:order_serial,
        origin_country=:origin_country,
        bal_pack_qty=:bal_pack_qty,
        multi_series=:multi_series,
        prod_attrib_code=:prod_attrib_code,
        prod_grade1=:prod_grade1,
        prod_grade2=:prod_grade2,
        tx_identity_number=:tx_identity_number,
        ref_txn_code=:ref_txn_code,
        ref_txn_slno=:ref_txn_slno,
        so_txn_code=:so_txn_code,
        inbound_done=:inbound_done,
        ref_txn_doc=:ref_txn_doc,
        supp_code=:supp_code,
        supp_reference=:supp_reference,
        orig_prod_code=:orig_prod_code,
        salesman_code=:salesman_code,
        hs_code=:hs_code,
        batch_no=:batch_no,
        act_order_qty=:act_order_qty,
        bal_order_qty=:bal_order_qty,
        minperiod_exppick=:minperiod_exppick,
        ignore_minexp_period=:ignore_minexp_period,
        stock_owner=:stock_owner,
        ind_code=:ind_code,
        git_no=:git_no,
        priority=:priority,
        updated_at=:updated_at,
        updated_by=:updated_by
      WHERE company_code=:company_code
        AND prin_code=:prin_code
        AND job_no=:job_no
        AND serial_no=:serial_no
    `;
    await connection.execute(updateQuery, binds, { autoCommit: false });
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
      ) VALUES (
        :company_code, :prin_code, :job_no, :cust_code, :order_no, :serial_no, :prod_code, :qty_puom, :p_uom,
        :qty_luom, :quantity, :doc_ref, :lot_no, :po_no, :imp_job_no, :manu_code, :container_no,
        :production_from, :production_to, :expiry_from, :expiry_to, :unit_price, :site_code,
        :loc_code_from, :loc_code_to, :picked, :confirmed, :confirmed_date, :l_uom, :uppp, :selected,
        :aisle_from, :aisle_to, :height_from, :height_to, :column_from, :column_to, :gate_no,
        :sales_rate, :exp_container_no, :exp_container_size, :exp_container_type,
        :exp_container_sealno, :moc1, :moc2, :order_serial, :origin_country, :bal_pack_qty,
        :multi_series, :prod_attrib_code, :prod_grade1, :prod_grade2, :tx_identity_number,
        :ref_txn_code, :ref_txn_slno, :so_txn_code, :inbound_done, :ref_txn_doc, :supp_code,
        :supp_reference, :orig_prod_code, :salesman_code, :hs_code, :batch_no, :act_order_qty,
        :bal_order_qty, :minperiod_exppick, :ignore_minexp_period, :stock_owner, :ind_code,
        :git_no, :priority, :updated_at, :updated_by, :created_by, :created_at
      )
    `;
    data.serial_no = 0;
    await connection.execute(insertQuery, binds, { autoCommit: false });
  }
}

// === Helper: Check if Record Exists ===
async function orderDetailExists(
  companyCode: string,
  prinCode: string,
  jobNo: string,
  serial_no: number,
  connection: Connection
): Promise<boolean> {
  const query = `
    SELECT 1 FROM TO_ORDER_DET
    WHERE company_code=:company_code
      AND prin_code=:prin_code
      AND job_no=:job_no
      AND serial_no=:serial_no
      AND ROWNUM = 1
  `;
  const binds = { company_code: companyCode, prin_code: prinCode, job_no: jobNo, serial_no };
  const result = await connection.execute(query, binds);
  return (result.rows?.length || 0) > 0;
}

// ====================
// Handlers converted to Oracle
// ====================
export const upsertOutboundOrderDetailManualHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection: Connection | undefined;
  try {
    const data: TOrderDetail = req.body;

    const requiredFields: (keyof TOrderDetail)[] = ["job_no", "prin_code", "company_code"];
    const missingFields = requiredFields.filter((field) => !data[field]);
    if (missingFields.length > 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: `Missing required field(s): ${missingFields.join(", ")}`,
      });
      return;
    }

    connection = await oracleDb.getConnection();
    await connection.execute("BEGIN NULL; END;"); // dummy to start transaction
    await upsertOrderDetail(data, connection);
    await connection.commit();

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Order detail upserted successfully",
    });
  } catch (error: any) {
    if (connection) await connection.rollback();
    console.error("Upsert Order Detail Error:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Failed to upsert order detail",
    });
  } finally {
    if (connection) await connection.close();
  }
};

export const getOutboundOrderDetailManualHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // Extract query parameters as strings
    const company_code = String(req.query.company_code || "");
    const prin_code = String(req.query.prin_code || "");
    const job_no = String(req.query.job_no || "");
    const serial_no = Number(req.query.serial_no); // Convert to number

    if (!company_code || !prin_code || !job_no || isNaN(serial_no)) {
      res.status(400).json({
        success: false,
        message:
          "Missing or invalid required parameters: company_code, prin_code, job_no, serial_no",
      });
      return;
    }

    const connection = await oracleDb.getConnection();

    const query = `
      SELECT *
      FROM TO_ORDER_DET
      WHERE company_code = :company_code
        AND prin_code = :prin_code
        AND job_no = :job_no
        AND serial_no = :serial_no
    `;

    const binds = {
      company_code,
      prin_code,
      job_no,
      serial_no,
    };

    const result = await connection.execute(query, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    await connection.close();

    if (!result.rows || result.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: "No matching order detail found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error("SQL Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch order detail",
    });
  }
};


export const getAllOrderDetails = async (req: Request, res: Response) => {
  let connection: oracledb.Connection | undefined;

  try {
    // Convert query params to proper types
    const company_code = String(req.query.company_code || "");
    const prin_code = String(req.query.prin_code || "");
    const job_no = String(req.query.job_no || "");

    if (!company_code || !prin_code || !job_no) {
      res.status(400).json({
        success: false,
        message: "Missing required parameters: company_code, prin_code, job_no",
      });
      return;
    }

    connection = await oracleDb.getConnection();

    const query = `
      SELECT * FROM VW_TO_ORDER_DET
      WHERE company_code = :company_code
        AND prin_code = :prin_code
        AND job_no = :job_no
    `;

    const binds: oracledb.BindParameters = { company_code, prin_code, job_no };

    const result = await connection.execute(query, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    res.status(200).json({
      success: true,
      count: result.rows?.length || 0,
      data: result.rows || [],
    });
  } catch (error: any) {
    console.error("SQL Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch order details",
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing Oracle connection:", err);
      }
    }
  }
};

export const getSingleOrderDetail = async (req: Request, res: Response): Promise<void> => {
  const { serial_no } = req.body;
  if (!serial_no) {
    res.status(400).json({ success: false, message: "serial_no parameter is required in request body" });
    return;
  }

  let connection: Connection | undefined;
  try {
    connection = await oracleDb.getConnection();
    const query = `SELECT * FROM VW_TO_ORDER_DET WHERE serial_no = :serial_no`;
    const binds = { serial_no };
    const result = await connection.execute(query, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    if (!result.rows || result.rows.length === 0) {
      res.status(404).json({ success: false, message: `No order detail found with serial_no: ${serial_no}` });
      return;
    }

    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    console.error("SQL Error:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to fetch order detail" });
  } finally {
    if (connection) await connection.close();
  }
};
