import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

export const insUpdTfEnquiryBulk = async (req: Request, res: Response): Promise<void> => {
  let connection: oracledb.Connection | undefined;

  try {
    const { header, details } = req.body;

    // ✅ Validate input
    if (!header || !Array.isArray(details)) {
      res.status(400).json({
        success: false,
        message: "Header and details are required"
      });
      return;
    }

    // ✅ FIX: Handle undefined tenantId properly
    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }

    // ✅ Safe to use now
    connection = await TenantManager.getConnection(tenantId);

    // ✅ HEADER MAPPING
    const headerRow = {
      ENQUIRY_NR: header.enquiry_nr ?? '0',
      ENQUIRY_DATE: header.enquiry_date ? new Date(header.enquiry_date) : null,
      COMPANY_CODE: header.company_code ?? null,
      PRIN_CODE: header.prin_code ?? null,
      DEPT_CODE: header.dept_code ?? null,
      ORIGIN_PORT: header.origin_port ?? null,
      DESTINATION_PORT: header.destination_port ?? null,
      TRANSIT_TIME: header.transit_time ?? null,
      CARGO_DETAIL: header.cargo_detail ?? null,
      FREQUENCY: header.frequency ?? null,
      TOS: header.tos ?? null,
      COMMODITY: header.commodity ?? null,
      DIMENSION: header.dimension ?? null,
      CARRIER: header.carrier ?? null,
      WEIGHT: Number(header.weight ?? 0),
      VOLUME: Number(header.volume ?? 0),
      REMARKS: header.remarks ?? null,
      PAYMENT_TERMS: header.payment_terms ?? null,
      CURR_CODE: header.curr_code ?? null,
      EX_RATE: Number(header.ex_rate ?? 1),
      JOB_TYPE: header.job_type ?? null,
      TRANSPORT_MODE: header.transport_mode ?? null,
      USERID: header.userid ?? null,
      USER_DATE: header.user_date ? new Date(header.user_date) : null,
      VIA: header.via ?? null,
      SCHEDULE_DATE: header.schedule_date ? new Date(header.schedule_date) : null,
      IND_JOB: header.ind_job ?? null,
      JOB_NUMBER: header.job_number ?? null,
      B: Number(header.b ?? 0),
      COUNTRY_DESTINATION: header.country_destination ?? null,
      COUNTRY_ORIGIN: header.country_origin ?? null,
      H: Number(header.h ?? 0),
      INDSTATUS: header.indstatus ?? null,
      L: Number(header.l ?? 0),
      ENQUIRY_TYPE: header.enquiry_type ?? 'ENQ',
      OFFER_VALIDITY: header.offer_validity ? new Date(header.offer_validity) : null,
      SPL_INSTRUCTIONS: header.spl_instructions ?? null,
      SALESMAN_CODE: header.salesman_code ?? null,
      MEMBER_TYPE: header.member_type ?? null,
      SALE_TYPE: header.sale_type ?? 'Normal',
      WALKIN_PRIN_CODE: header.walkin_prin_code ?? null,
      SHIPPER_NAME: header.shipper_name ?? null,
      SHIPPER_ADDRESS: header.shipper_address ?? null,
      CONSIGNEE_NAME: header.consignee_name ?? null,
      CONSIGNEE_ADDRESS: header.consignee_address ?? null,
      JOB_CATEGORY: header.job_category ?? null,
      REF_ENQUIRY_TYPE: header.ref_enquiry_type ?? null,
      REF_ENQUIRY_NR: header.ref_enquiry_nr ?? null,
      FORWARDER_CODE: header.forwarder_code ?? null,
      GROSS_WT: Number(header.gross_wt ?? 0),
      SHIPMENT_STATUS: header.shipment_status ?? null,
      CONTAINER_TYPE: header.container_type ?? null,
      NO_OF_CONTANERS: Number(header.no_of_contaners ?? 0),
      VEHICLE_TYPE: header.vehicle_type ?? null,
      T_F: header.t_f ?? null
    };

    // ✅ DETAILS MAPPING
    const detailRows = details.map((d: any) => ({
      COMPANY_CODE: d.company_code ?? null,
      PRIN_CODE: d.prin_code ?? null,
      ENQUIRY_NR: d.enquiry_nr ?? null,
      ACT_CODE: d.act_code ?? null,
      QUANTITY: Number(d.quantity ?? 0),
      UOM: d.uom ?? null,
      BILL_RATE: Number(d.bill_rate ?? 0),
      COST_RATE: Number(d.cost_rate ?? 0),
      BILL: Number(d.bill ?? 0),
      COST: Number(d.cost ?? 0),
      USERID: d.userid ?? null,
      USER_DT: d.user_dt ? new Date(d.user_dt) : null,
      CURR_CODE: d.curr_code ?? null,
      EX_RATE: Number(d.ex_rate ?? 1),
      UOC: d.uoc ?? null,
      MOC1: d.moc1 ?? null,
      MOC2: d.moc2 ?? null,
      PARTNERS_PRICE: Number(d.partners_price ?? 0),
      FC_COST: Number(d.fc_cost ?? 0),
      FC_BILL: Number(d.fc_bill ?? 0),
      FC_PARTNERS: Number(d.fc_partners ?? 0),
      FC_COSTRATE: Number(d.fc_costrate ?? 0),
      FC_BILLRATE: Number(d.fc_billrate ?? 0),
      ORIGIN_PORT: d.origin_port ?? null,
      DESTINATION_PORT: d.destination_port ?? null,
      SR_NO: Number(d.sr_no ?? 0),
      TRANSPORT_MODE: d.transport_mode ?? null,
      SRNO: Number(d.srno ?? 0),
      COST_CURR_CODE: d.cost_curr_code ?? null,
      COST_EX_RATE: Number(d.cost_ex_rate ?? 1),
      PARTNERS_CURR_CODE: d.partners_curr_code ?? null,
      PARTNERS_EX_RATE: Number(d.partners_ex_rate ?? 1),
      ENQUIRY_TYPE: d.enquiry_type ?? 'ENQ',
      REMARKS: d.remarks ?? null
    }));

    // ✅ EXECUTE PROCEDURE
    await connection.execute(
      `BEGIN
        PROC_INS_UPD_TF_ENQUIRY(:p_header, :p_details);
      END;`,
      {
        p_header: { type: "TF_ENQUIRY_TAB", val: [headerRow] },
        p_details: { type: "TF_ENQUIRY_DET_TAB", val: detailRows }
      },
      { autoCommit: false }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Enquiry saved successfully"
    });

  } catch (err: any) {
    console.error("Oracle Error:", err);

    if (connection) await connection.rollback();

    res.status(500).json({
      success: false,
      message: "Transaction failed",
      error: err?.message || "Unknown error"
    });

  } finally {
    if (connection) await connection.close();
  }
};