import { Router, Request, Response } from "express";
import oracledb from "oracledb";
import constants from "../../../../helpers/constants";
import { createInboundSchema } from "../../../../../src/validation/wms/transaction/createinbound.validation";

const router = Router();

export const createOrUpdateJob = async (req: Request, res: Response): Promise<void> => {
  let connection: oracledb.Connection | undefined;

  try {
    const { prin_code, job_no } = req.query as { prin_code: string; job_no: string };
    const requestUser = req.body.user || { loginid: "SYSTEM", company_code: req.body.company_code || "" };

    // Validate payload
    const { error } = createInboundSchema(req.body, false, requestUser.company_code);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: error.message });
      return;
    }

    // Prepare data
    const data = {
      ...req.body,
      company_code: requestUser.company_code,
      prin_code,
      job_no,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,
      created_at: req.body.created_at || new Date(),
      updated_at: new Date(),
    };

    connection = await oracledb.getConnection();

    // Check if job exists
    const result = await connection.execute<{ COUNT: number }>(
      `SELECT COUNT(*) AS COUNT FROM TI_JOB WHERE company_code = :company_code AND job_no = :job_no`,
      { company_code: data.company_code, job_no: data.job_no },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const countRow = result.rows?.[0] as { COUNT: number } | undefined;
    const exists = (countRow?.COUNT ?? 0) > 0;

    if (exists) {
      // Explicit UPDATE statement with all columns
      const updateQuery = `
        UPDATE TI_JOB
        SET 
          job_date = :job_date,
          job_type = :job_type,
          job_class = :job_class,
          dept_code = :dept_code,
          transport_mode = :transport_mode,
          doc_ref = :doc_ref,
          port_code = :port_code,
          description1 = :description1,
          description2 = :description2,
          prin_ref1 = :prin_ref1,
          prin_ref2 = :prin_ref2,
          remarks = :remarks,
          eta = :eta,
          ata = :ata,
          etd = :etd,
          schedule_date = :schedule_date,
          payment_terms = :payment_terms,
          curr_code = :curr_code,
          ex_rate = :ex_rate,
          frieght_value = :frieght_value,
          insurance_value = :insurance_value,
          cust_code = :cust_code,
          container_flag = :container_flag,
          container = :container,
          packdet = :packdet,
          allocated = :allocated,
          canceled = :canceled,
          confirmed = :confirmed,
          grn_no = :grn_no,
          invoiced = :invoiced,
          completed = :completed,
          exp_jobno = :exp_jobno,
          picked = :picked,
          ordered = :ordered,
          destination_port = :destination_port,
          vessel_name = :vessel_name,
          voyage_no = :voyage_no,
          payableat = :payableat,
          place_receipt = :place_receipt,
          place_delivery = :place_delivery,
          no_of_original_bl = :no_of_original_bl,
          broker_code = :broker_code,
          quotation_ref = :quotation_ref,
          be_deposits = :be_deposits,
          ind_freight = :ind_freight,
          country_origin = :country_origin,
          country_destination = :country_destination,
          custom_recno = :custom_recno,
          doc_ref2 = :doc_ref2,
          hawb = :hawb,
          reexport = :reexport,
          ref_jobno = :ref_jobno,
          combined_jobno = :combined_jobno,
          carrier = :carrier,
          job_lock = :job_lock,
          courier_code = :courier_code,
          delivery_point = :delivery_point,
          div_code = :div_code,
          salesman_code = :salesman_code,
          transit_time = :transit_time,
          document_check = :document_check,
          delivery_remarks = :delivery_remarks,
          cargo_received = :cargo_received,
          delivered_by = :delivered_by,
          canceled_by = :canceled_by,
          cancel_remarks = :cancel_remarks,
          send_mail = :send_mail,
          backlog_mail = :backlog_mail,
          dplan_flag = :dplan_flag,
          trans_batch_id = :trans_batch_id,
          send_mail_dn = :send_mail_dn,
          kpi_inc = :kpi_inc,
          kpi_exc_remark = :kpi_exc_remark,
          job_category = :job_category,
          edit_user = :edit_user,
          tx_cat_code = :tx_cat_code,
          bcf_code = :bcf_code,
          request_category = :request_category,
          load_point = :load_point,
          created_at = :created_at,
          created_by = :created_by,
          updated_at = :updated_at,
          updated_by = :updated_by,
          job_classification = :job_classification
        WHERE company_code = :company_code AND job_no = :job_no
      `;

      await connection.execute(updateQuery, data, { autoCommit: true });
      res.status(constants.STATUS_CODES.OK).json({ success: true, message: "Job updated successfully" });

    } else {
      // Explicit INSERT statement with all columns
      const insertQuery = `
        INSERT INTO TI_JOB (
          company_code, prin_code, job_no, job_date, job_type, job_class, dept_code,
          transport_mode, doc_ref, port_code, description1, description2, prin_ref1,
          prin_ref2, remarks, eta, ata, etd, schedule_date, payment_terms, curr_code,
          ex_rate, frieght_value, insurance_value, cust_code, container_flag, container,
          packdet, allocated, canceled, confirmed, grn_no, invoiced, completed, exp_jobno,
          picked, ordered, destination_port, vessel_name, voyage_no, payableat, place_receipt,
          place_delivery, no_of_original_bl, broker_code, quotation_ref, be_deposits, ind_freight,
          country_origin, country_destination, custom_recno, doc_ref2, hawb, reexport, ref_jobno,
          combined_jobno, carrier, job_lock, courier_code, delivery_point, div_code, salesman_code,
          transit_time, document_check, delivery_remarks, cargo_received, delivered_by,
          canceled_by, cancel_remarks, send_mail, backlog_mail, dplan_flag, trans_batch_id,
          send_mail_dn, kpi_inc, kpi_exc_remark, job_category, edit_user, tx_cat_code, bcf_code,
          request_category, load_point, created_at, created_by, updated_at, updated_by, job_classification
        ) VALUES (
          :company_code, :prin_code, :job_no, :job_date, :job_type, :job_class, :dept_code,
          :transport_mode, :doc_ref, :port_code, :description1, :description2, :prin_ref1,
          :prin_ref2, :remarks, :eta, :ata, :etd, :schedule_date, :payment_terms, :curr_code,
          :ex_rate, :frieght_value, :insurance_value, :cust_code, :container_flag, :container,
          :packdet, :allocated, :canceled, :confirmed, :grn_no, :invoiced, :completed, :exp_jobno,
          :picked, :ordered, :destination_port, :vessel_name, :voyage_no, :payableat, :place_receipt,
          :place_delivery, :no_of_original_bl, :broker_code, :quotation_ref, :be_deposits, :ind_freight,
          :country_origin, :country_destination, :custom_recno, :doc_ref2, :hawb, :reexport, :ref_jobno,
          :combined_jobno, :carrier, :job_lock, :courier_code, :delivery_point, :div_code, :salesman_code,
          :transit_time, :document_check, :delivery_remarks, :cargo_received, :delivered_by,
          :canceled_by, :cancel_remarks, :send_mail, :backlog_mail, :dplan_flag, :trans_batch_id,
          :send_mail_dn, :kpi_inc, :kpi_exc_remark, :job_category, :edit_user, :tx_cat_code, :bcf_code,
          :request_category, :load_point, :created_at, :created_by, :updated_at, :updated_by, :job_classification
        )
      `;

      await connection.execute(insertQuery, data, { autoCommit: true });
      res.status(constants.STATUS_CODES.OK).json({ success: true, message: "Job created successfully" });
    }

  } catch (error: any) {
    console.error("Error in createOrUpdateJob:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) { console.error("Error closing Oracle connection:", err); }
    }
  }
};
