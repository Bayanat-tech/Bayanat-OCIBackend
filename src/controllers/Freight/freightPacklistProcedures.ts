import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

type Connection = oracledb.Connection;

export const frtPacklistJobs = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_PACKLIST_JOB_LIST(
           :p_company_code,
           :p_transport_mode,
           :p_job_type,
           :p_search,
           :p_result
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_transport_mode: req.body.transport_mode ?? req.body.TRANSPORT_MODE,
        p_job_type: req.body.job_type ?? req.body.JOB_TYPE,
        p_search: req.body.search ?? req.body.SEARCH ?? null,
        p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = await rowsFromCursor((result.outBinds as any).p_result);
    res.json({ success: true, data: rows, totalCount: rows.length });
  });
};

export const frtPacklistList = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_PACKLIST_LIST(
           :p_company_code,
           :p_transport_mode,
           :p_job_type,
           :p_search,
           :p_result
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_transport_mode: req.body.transport_mode ?? req.body.TRANSPORT_MODE,
        p_job_type: req.body.job_type ?? req.body.JOB_TYPE,
        p_search: req.body.search ?? req.body.SEARCH ?? null,
        p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = await rowsFromCursor((result.outBinds as any).p_result);
    res.json({ success: true, data: rows, totalCount: rows.length });
  });
};

export const frtPacklistGet = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_PACKLIST_GET(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_packlist_no,
           :p_result
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_prin_code: req.body.prin_code ?? req.body.PRIN_CODE,
        p_job_no: req.body.job_no ?? req.body.JOB_NO,
        p_packlist_no: req.body.packlist_no ?? req.body.PACKLIST_NO,
        p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = await rowsFromCursor((result.outBinds as any).p_result);
    res.json({ success: true, data: rows[0] ?? null });
  });
};

export const frtPacklistDimList = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_PACKLIST_DIM_LIST(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_result
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_prin_code: req.body.prin_code ?? req.body.PRIN_CODE,
        p_job_no: req.body.job_no ?? req.body.JOB_NO,
        p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = await rowsFromCursor((result.outBinds as any).p_result);
    res.json({ success: true, data: rows, totalCount: rows.length });
  });
};

export const frtPacklistDimSave = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
    await connection.execute(
      `BEGIN
         PROC_FRT_PACKLIST_DIM_SAVE(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_user_id,
           :p_lines
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_prin_code: req.body.prin_code ?? req.body.PRIN_CODE,
        p_job_no: req.body.job_no ?? req.body.JOB_NO,
        p_user_id: req.body.user_id ?? req.body.USER_ID,
        p_lines: { type: "FRT_PACKLIST_DIM_TAB", val: lines.map(toDimensionObject) },
      },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Freight pack dimensions saved successfully" });
  });
};

export const frtPacklistSave = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const pack = req.body.packlist ?? req.body;
    const isNewPacklist =
      pack.is_new_packlist === true ||
      pack.IS_NEW_PACKLIST === true ||
      String(pack.packlist_action ?? pack.PACKLIST_ACTION ?? "").toUpperCase() === "NEW";
    const result = await connection.execute(
      `BEGIN
         WMSTST.PROC_FRT_PACKLIST_SAVE(
           p_company_code => :p_company_code,
           p_prin_code => :p_prin_code,
           p_job_no => :p_job_no,
           p_packlist_no => :p_packlist_no,
           p_transport_mode => :p_transport_mode,
           p_job_type => :p_job_type,
           p_seq_number => :p_seq_number,
           p_cust_code => :p_cust_code,
           p_broker_code => :p_broker_code,
           p_shipper_name => :p_shipper_name,
           p_shipper_address => :p_shipper_address,
           p_consignee_name => :p_consignee_name,
           p_consignee_address => :p_consignee_address,
           p_notify_name => :p_notify_name,
           p_notify_address => :p_notify_address,
           p_marksnos => :p_marksnos,
           p_prod_description => :p_prod_description,
           p_cargo_details => :p_cargo_details,
           p_no_of_packings => :p_no_of_packings,
           p_quantity => :p_quantity,
           p_puom => :p_puom,
           p_volume => :p_volume,
           p_net_wt => :p_net_wt,
           p_gross_wt => :p_gross_wt,
           p_charge_wt => :p_charge_wt,
           p_feus => :p_feus,
           p_teus => :p_teus,
           p_bl_mode => :p_bl_mode,
           p_container_no => :p_container_no,
           p_container_size => :p_container_size,
           p_container_type => :p_container_type,
           p_vessel_name => :p_vessel_name,
           p_voyage_no => :p_voyage_no,
           p_bl_no => :p_bl_no,
           p_bl_date => :p_bl_date,
           p_import_blno => :p_import_blno,
           p_import_bldate => :p_import_bldate,
           p_hawb => :p_hawb,
           p_airline => :p_airline,
           p_airline_address => :p_airline_address,
           p_flight_info => :p_flight_info,
           p_issuing_carrier => :p_issuing_carrier,
           p_issuing_carrier_add => :p_issuing_carrier_add,
           p_agents_iata_code => :p_agents_iata_code,
           p_acc_info => :p_acc_info,
           p_accnt_no => :p_accnt_no,
           p_chg_code => :p_chg_code,
           p_dec_val_carr => :p_dec_val_carr,
           p_dec_val_cus => :p_dec_val_cus,
           p_valuation_chg => :p_valuation_chg,
           p_tax_chg => :p_tax_chg,
           p_agent_amount => :p_agent_amount,
           p_carrier_amount => :p_carrier_amount,
           p_issue_place => :p_issue_place,
           p_issue_date => :p_issue_date,
           p_shipon_board => :p_shipon_board,
           p_signature => :p_signature,
           p_po_no => :p_po_no,
           p_shipment_status => :p_shipment_status,
           p_rate_ind => :p_rate_ind,
           p_amt_insurance => :p_amt_insurance,
           p_kg_ind => :p_kg_ind,
           p_rate_class => :p_rate_class,
           p_item_no => :p_item_no,
           p_routing => :p_routing,
           p_terms_of_delivery => :p_terms_of_delivery,
           p_curr_code => :p_curr_code,
           p_ex_rate => :p_ex_rate,
           p_rate => :p_rate,
           p_amount => :p_amount,
           p_remarks => :p_remarks,
           p_handling_info => :p_handling_info,
           p_user_id => :p_user_id,
           p_packlist_no_out => :p_packlist_no_out,
           p_seq_number_out => :p_seq_number_out
         );
       END;`,
      {
        p_company_code: value(pack.company_code ?? pack.COMPANY_CODE),
        p_prin_code: value(pack.prin_code ?? pack.PRIN_CODE),
        p_job_no: value(pack.job_no ?? pack.JOB_NO),
        p_packlist_no: isNewPacklist ? null : numberValue(pack.packlist_no ?? pack.PACKLIST_NO),
        p_transport_mode: value(pack.transport_mode ?? pack.TRANSPORT_MODE),
        p_job_type: value(pack.job_type ?? pack.JOB_TYPE),
        p_seq_number: isNewPacklist ? null : value(pack.seq_number ?? pack.SEQ_NUMBER),
        p_cust_code: value(pack.cust_code ?? pack.CUST_CODE),
        p_broker_code: value(pack.broker_code ?? pack.BROKER_CODE),
        p_shipper_name: value(pack.shipper_name ?? pack.SHIPPER_NAME),
        p_shipper_address: value(pack.shipper_address ?? pack.SHIPPER_ADDRESS),
        p_consignee_name: value(pack.consignee_name ?? pack.CONSIGNEE_NAME),
        p_consignee_address: value(pack.consignee_address ?? pack.CONSIGNEE_ADDRESS),
        p_notify_name: value(pack.notify_name ?? pack.NOTIFY_NAME),
        p_notify_address: value(pack.notify_address ?? pack.NOTIFY_ADDRESS),
        p_marksnos: value(pack.marksnos ?? pack.MARKSNOS),
        p_prod_description: value(pack.prod_description ?? pack.PROD_DESCRIPTION),
        p_cargo_details: value(pack.cargo_details ?? pack.CARGO_DETAILS),
        p_no_of_packings: numberValue(pack.no_of_packings ?? pack.NO_OF_PACKINGS),
        p_quantity: numberValue(pack.quantity ?? pack.QUANTITY),
        p_puom: value(pack.puom ?? pack.PUOM),
        p_volume: numberValue(pack.volume ?? pack.VOLUME),
        p_net_wt: numberValue(pack.net_wt ?? pack.NET_WT),
        p_gross_wt: numberValue(pack.gross_wt ?? pack.GROSS_WT),
        p_charge_wt: numberValue(pack.charge_wt ?? pack.CHARGE_WT ?? pack.CHARGEABLE_WT),
        p_feus: numberValue(pack.feus ?? pack.FEUS),
        p_teus: numberValue(pack.teus ?? pack.TEUS),
        p_bl_mode: value(pack.bl_mode ?? pack.BL_MODE),
        p_container_no: value(pack.container_no ?? pack.CONTAINER_NO),
        p_container_size: numberValue(pack.container_size ?? pack.CONTAINER_SIZE),
        p_container_type: value(pack.container_type ?? pack.CONTAINER_TYPE),
        p_vessel_name: value(pack.vessel_name ?? pack.VESSEL_NAME),
        p_voyage_no: value(pack.voyage_no ?? pack.VOYAGE_NO),
        p_bl_no: value(pack.bl_no ?? pack.BL_NO),
        p_bl_date: toDate(pack.bl_date ?? pack.BL_DATE),
        p_import_blno: value(pack.import_blno ?? pack.IMPORT_BLNO),
        p_import_bldate: toDate(pack.import_bldate ?? pack.IMPORT_BLDATE),
        p_hawb: value(pack.hawb ?? pack.HAWB),
        p_airline: value(pack.airline ?? pack.AIRLINE),
        p_airline_address: value(pack.airline_address ?? pack.AIRLINE_ADDRESS),
        p_flight_info: value(pack.flight_info ?? pack.FLIGHT_INFO),
        p_issuing_carrier: value(pack.issuing_carrier ?? pack.ISSUING_CARRIER),
        p_issuing_carrier_add: value(pack.issuing_carrier_add ?? pack.ISSUING_CARRIER_ADD),
        p_agents_iata_code: value(pack.agents_iata_code ?? pack.AGENTS_IATA_CODE),
        p_acc_info: value(pack.acc_info ?? pack.ACC_INFO),
        p_accnt_no: value(pack.accnt_no ?? pack.ACCNT_NO),
        p_chg_code: value(pack.chg_code ?? pack.CHG_CODE),
        p_dec_val_carr: value(pack.dec_val_carr ?? pack.DEC_VAL_CARR),
        p_dec_val_cus: value(pack.dec_val_cus ?? pack.DEC_VAL_CUS),
        p_valuation_chg: numberValue(pack.valuation_chg ?? pack.VALUATION_CHG),
        p_tax_chg: numberValue(pack.tax_chg ?? pack.TAX_CHG),
        p_agent_amount: numberValue(pack.agent_amount ?? pack.AGENT_AMOUNT),
        p_carrier_amount: numberValue(pack.carrier_amount ?? pack.CARRIER_AMOUNT),
        p_issue_place: value(pack.issue_place ?? pack.ISSUE_PLACE),
        p_issue_date: toDate(pack.issue_date ?? pack.ISSUE_DATE),
        p_shipon_board: toDate(pack.shipon_board ?? pack.SHIPON_BOARD),
        p_signature: value(pack.signature ?? pack.SIGNATURE),
        p_po_no: value(pack.po_no ?? pack.PO_NO),
        p_shipment_status: value(pack.shipment_status ?? pack.SHIPMENT_STATUS),
        p_rate_ind: value(pack.rate_ind ?? pack.RATE_IND),
        p_amt_insurance: value(pack.amt_insurance ?? pack.AMT_INSURANCE),
        p_kg_ind: value(pack.kg_ind ?? pack.KG_IND),
        p_rate_class: value(pack.rate_class ?? pack.RATE_CLASS),
        p_item_no: value(pack.item_no ?? pack.ITEM_NO),
        p_routing: value(pack.routing ?? pack.ROUTING),
        p_terms_of_delivery: value(pack.terms_of_delivery ?? pack.TERMS_OF_DELIVERY),
        p_curr_code: value(pack.curr_code ?? pack.CURR_CODE),
        p_ex_rate: numberValue(pack.ex_rate ?? pack.EX_RATE),
        p_rate: numberValue(pack.rate ?? pack.RATE),
        p_amount: numberValue(pack.amount ?? pack.AMOUNT),
        p_remarks: value(pack.remarks ?? pack.REMARKS),
        p_handling_info: value(pack.handling_info ?? pack.HANDLING_INFO),
        p_user_id: value(pack.user_id ?? pack.USER_ID ?? req.body.user_id ?? req.body.USER_ID),
        p_packlist_no_out: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        p_seq_number_out: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 40 },
      },
      { autoCommit: true }
    );

    res.json({
      success: true,
      message: "Freight pack list saved successfully",
      data: {
        packlist_no: (result.outBinds as any).p_packlist_no_out,
        seq_number: (result.outBinds as any).p_seq_number_out,
      },
    });
  });
};

export const frtPacklistDelete = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    await connection.execute(
      `BEGIN
         PROC_FRT_PACKLIST_DELETE(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_packlist_no
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_prin_code: req.body.prin_code ?? req.body.PRIN_CODE,
        p_job_no: req.body.job_no ?? req.body.JOB_NO,
        p_packlist_no: req.body.packlist_no ?? req.body.PACKLIST_NO,
      },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Freight pack list deleted successfully" });
  });
};

async function withConnection(res: Response, handler: (connection: Connection) => Promise<void>) {
  let connection: Connection | undefined;
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);
    await handler(connection);
  } catch (error: any) {
    console.error("Freight pack list procedure error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to execute Freight pack list procedure",
      details: error?.message || "Unknown error",
    });
  } finally {
    if (connection) await connection.close();
  }
}

async function rowsFromCursor(cursor: any) {
  if (!cursor) return [];
  try {
    return await cursor.getRows(10000);
  } finally {
    await cursor.close();
  }
}

function value(input: unknown) {
  if (input === undefined || input === null) return null;
  const text = String(input).trim();
  return text ? text : null;
}

function numberValue(input: unknown) {
  const text = value(input);
  if (text === null) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function toDate(input: unknown) {
  if (!input) return null;
  if (input instanceof Date) return input;
  const date = new Date(String(input));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDimensionObject(row: Record<string, unknown>, index: number) {
  return {
    SR_NO: numberValue(row.sr_no ?? row.SR_NO) ?? index + 1,
    PACKLIST_DIM_NO: numberValue(row.packlist_dim_no ?? row.PACKLIST_DIM_NO),
    LENGTH: numberValue(row.length ?? row.LENGTH),
    BREADTH: numberValue(row.breadth ?? row.BREADTH),
    HEIGHT: numberValue(row.height ?? row.HEIGHT),
    QTY: numberValue(row.qty ?? row.QTY),
    GROSS_WT: numberValue(row.gross_wt ?? row.GROSS_WT),
    CHARGEABLE_WT: numberValue(row.chargeable_wt ?? row.CHARGEABLE_WT),
    VOLUME: numberValue(row.volume ?? row.VOLUME),
    TOTAL_QTY: numberValue(row.total_qty ?? row.TOTAL_QTY),
    CARGO_DETAILS: value(row.cargo_details ?? row.CARGO_DETAILS),
    PROD_DESCRIPTION: value(row.prod_description ?? row.PROD_DESCRIPTION),
  };
}
