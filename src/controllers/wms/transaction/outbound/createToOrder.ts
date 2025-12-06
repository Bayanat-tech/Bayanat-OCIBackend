import { Request, Response } from "express";
import oracledb, { BindParameters, Connection } from "oracledb";
import { oracleDb } from "../../../../database/connection";
import { IToOrderEntry } from "../../../../interfaces/wms/transaction/outbound/orderEntryWms.interface";

/* ============================================================
   SAFE HELPERS
============================================================ */
const safeDate = (v: any) => (v ? new Date(v) : null);

/* ============================================================
   CHECK IF ORDER EXISTS
============================================================ */
async function orderExists(
  company_code: string,
  prin_code: string,
  job_no: string,
  order_no: string,
  connection: Connection
): Promise<boolean> {
  const q = `
    SELECT 1 FROM TO_ORDER
    WHERE company_code = :company_code
      AND prin_code = :prin_code
      AND job_no = :job_no
      AND order_no = :order_no
      AND ROWNUM = 1
  `;

  const r = await connection.execute(
    q,
    { company_code, prin_code, job_no, order_no },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );

  return (r.rows?.length || 0) > 0;
}

/* ============================================================
   UPSERT ORDER
============================================================ */
export async function upsertOrderDetail(
  data: IToOrderEntry,
  connection: Connection
): Promise<string> {
  const exists = await orderExists(
    data.company_code,
    data.prin_code,
    data.job_no,
    data.order_no,
    connection
  );

  const binds: BindParameters = {
    company_code: data.company_code,
    prin_code: data.prin_code,
    job_no: data.job_no,
    cust_code: data.cust_code,
    order_no: data.order_no,
    order_date: safeDate(data.order_date),
    order_due_date: safeDate(data.order_due_date),
    cust_reference: data.cust_reference,
    po_no: data.po_no,
    po_date: safeDate(data.po_date),
    curr_code: data.curr_code,
    ex_rate: data.ex_rate,
    exp_container_no: data.exp_container_no,
    exp_container_size: data.exp_container_size,
    exp_container_type: data.exp_container_type,
    exp_container_sealno: data.exp_container_sealno,
    moc1: data.moc1,
    moc2: data.moc2,
    act_code: data.act_code,
    uoc: data.uoc,
    volume: data.volume,
    net_weight: data.net_weight,
    assigned_pda_user: data.assigned_pda_user,
    order_serial: data.order_serial,
    ref_txn_code: data.ref_txn_code,
    ref_txn_docno: data.ref_txn_docno,
    ref_txn_slno: data.ref_txn_slno,
    so_txn_code: data.so_txn_code,
    delivery_term: data.delivery_term,
    salesman_code: data.salesman_code,
    recollected_flag: data.recollected_flag,
    recollected_dt: safeDate(data.recollected_dt),
    recollected_remarks: data.recollected_remarks,
    stuff_start: safeDate(data.stuff_start),
    stuff_end: safeDate(data.stuff_end),
    pick_start: safeDate(data.pick_start),
    pick_end: safeDate(data.pick_end),
    pack_start: safeDate(data.pack_start),
    pack_end: safeDate(data.pack_end),
    load_start: safeDate(data.load_start),
    load_end: safeDate(data.load_end),
    allow_doc_gen: data.allow_doc_gen,
    pre_so: data.pre_so,
    assigned_pack_user: data.assigned_pack_user,
    order_location: data.order_location,
    route_code: data.route_code,
    manifest_no: data.manifest_no,
    vehicle_no: data.vehicle_no,
    order_load_seq_nr: data.order_load_seq_nr,
    manu_code: data.manu_code,
  };

  if (exists) {
    const updateSQL = `
      UPDATE TO_ORDER SET
        cust_code=:cust_code,
        order_date=:order_date,
        order_due_date=:order_due_date,
        cust_reference=:cust_reference,
        po_no=:po_no,
        po_date=:po_date,
        curr_code=:curr_code,
        ex_rate=:ex_rate,
        exp_container_no=:exp_container_no,
        exp_container_size=:exp_container_size,
        exp_container_type=:exp_container_type,
        exp_container_sealno=:exp_container_sealno,
        moc1=:moc1,
        moc2=:moc2,
        act_code=:act_code,
        uoc=:uoc,
        volume=:volume,
        net_weight=:net_weight,
        assigned_pda_user=:assigned_pda_user,
        order_serial=:order_serial,
        ref_txn_code=:ref_txn_code,
        ref_txn_docno=:ref_txn_docno,
        ref_txn_slno=:ref_txn_slno,
        so_txn_code=:so_txn_code,
        delivery_term=:delivery_term,
        salesman_code=:salesman_code,
        recollected_flag=:recollected_flag,
        recollected_dt=:recollected_dt,
        recollected_remarks=:recollected_remarks,
        stuff_start=:stuff_start,
        stuff_end=:stuff_end,
        pick_start=:pick_start,
        pick_end=:pick_end,
        pack_start=:pack_start,
        pack_end=:pack_end,
        load_start=:load_start,
        load_end=:load_end,
        allow_doc_gen=:allow_doc_gen,
        pre_so=:pre_so,
        assigned_pack_user=:assigned_pack_user,
        order_location=:order_location,
        route_code=:route_code,
        manifest_no=:manifest_no,
        vehicle_no=:vehicle_no,
        order_load_seq_nr=:order_load_seq_nr,
        manu_code=:manu_code
      WHERE company_code=:company_code
        AND prin_code=:prin_code
        AND job_no=:job_no
        AND order_no=:order_no
    `;

    await connection.execute(updateSQL, binds, { autoCommit: false });
    return data.order_no;
  }

  const insertSQL = `
    INSERT INTO TO_ORDER (
      company_code, prin_code, job_no, cust_code, order_no,
      order_date, order_due_date, cust_reference, po_no, po_date,
      curr_code, ex_rate, exp_container_no, exp_container_size,
      exp_container_type, exp_container_sealno, moc1, moc2, act_code,
      uoc, volume, net_weight, assigned_pda_user, order_serial,
      ref_txn_code, ref_txn_docno, ref_txn_slno, so_txn_code,
      delivery_term, salesman_code, recollected_flag, recollected_dt,
      recollected_remarks, stuff_start, stuff_end, pick_start, pick_end,
      pack_start, pack_end, load_start, load_end, allow_doc_gen, pre_so,
      assigned_pack_user, order_location, route_code, manifest_no,
      vehicle_no, order_load_seq_nr, manu_code
    )
    VALUES (
      :company_code, :prin_code, :job_no, :cust_code, :order_no,
      :order_date, :order_due_date, :cust_reference, :po_no, :po_date,
      :curr_code, :ex_rate, :exp_container_no, :exp_container_size,
      :exp_container_type, :exp_container_sealno, :moc1, :moc2, :act_code,
      :uoc, :volume, :net_weight, :assigned_pda_user, :order_serial,
      :ref_txn_code, :ref_txn_docno, :ref_txn_slno, :so_txn_code,
      :delivery_term, :salesman_code, :recollected_flag, :recollected_dt,
      :recollected_remarks, :stuff_start, :stuff_end, :pick_start, :pick_end,
      :pack_start, :pack_end, :load_start, :load_end, :allow_doc_gen, :pre_so,
      :assigned_pack_user, :order_location, :route_code, :manifest_no,
      :vehicle_no, :order_load_seq_nr, :manu_code
    )
  `;

  await connection.execute(insertSQL, binds, { autoCommit: false });
  return data.order_no;
}

/* ============================================================
   MAIN HANDLER — NO OVERLOAD ERROR, NO REQUESTHANDLER TYPE
============================================================ */
export const createInboundjob = async (req: Request, res: Response): Promise<void> => {
  let connection: Connection | undefined;

  try {
    const data: IToOrderEntry = req.body;

    const required: (keyof IToOrderEntry)[] = [
      "company_code",
      "prin_code",
      "job_no",
      "cust_code",
    ];

    const missing = required.filter((k) => !data[k]);

    if (missing.length > 0) {
      res.status(400).json({
        success: false,
        message: `Missing required fields: ${missing.join(", ")}`,
      });
      return;
    }

    connection = await oracleDb.getConnection();
    const orderNo = await upsertOrderDetail(data, connection);
    await connection.commit();

    res.status(200).json({
      success: true,
      message: "Order upserted successfully",
      order_no: orderNo,
    });
  } catch (err: any) {
    if (connection) await connection.rollback();

    res.status(500).json({
      success: false,
      message: err.message || "Failed to upsert order",
    });
  } finally {
    if (connection) await connection.close();
  }
};
