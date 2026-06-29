
import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager"
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware"

export const insUpdEmpLeaveencashment = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {

    const { header, details } = req.body;

    if (!header) {
      res.status(400).json({
        success: false,
        message: "Header data is required"
      });
      return;
    }

    if (!Array.isArray(details)) {
      res.status(400).json({
        success: false,
        message: "Details must be an array"
      });
      return;
    }

    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(
      tenantId
    );

    await connection.execute(
      `
      BEGIN
        WMSTST.PROC_INS_UPD_HR_EMP_LEAVE(
            :p_header,
            :p_details
        );
      END;
      `,
      {
        p_header: {
          type: "HR_EMP_LEAVE_HDR_OBJ",
          val: {
            COMPANY_CODE: header.company_code,
            EMPLOYEE_ID: header.employee_id,
            HDR_LVE_SLNO: header.hdr_lve_slno,

            DESTINATION: header.destination,
            PLANNED_LEAVE: header.planned_leave,
            ADVANCE_PAYMENT: header.advance_payment,
            APPROVAL_STATUS: header.approval_status,
            LONG_SHORT: header.long_short,
            LEAVE_REMARKS: header.leave_remarks,
            LEAVE_ALLOWANCE: header.leave_allowance,
            PAYMENT_MODE: header.payment_mode,

            NO_TICKET_ADULT: header.no_ticket_adult,
            NO_TICKET_CHILD: header.no_ticket_child,
            NO_TICKET_INFANT: header.no_ticket_infant,

            CANCEL_DATE: header.cancel_date
              ? new Date(header.cancel_date)
              : null,

            CANCEL_REMARKS: header.cancel_remarks,

            RESUME_DATE: header.resume_date
              ? new Date(header.resume_date)
              : null,

            ACTUAL_RESUME_DATE: header.actual_resume_date
              ? new Date(header.actual_resume_date)
              : null,

            RESUME_WORK: header.resume_work,
            RESUME_APPROVED: header.resume_approved,

            LVE_ADJUSTMENT_REASON:
              header.lve_adjustment_reason,

            LEAVE_CERTIFICATE_REQUIRED:
              header.leave_certificate_required,

            USER_ID: header.user_id,

            USER_DT: header.user_dt
              ? new Date(header.user_dt)
              : null,

            APPROVED_BY: header.approved_by,

            APPROVED_ON: header.approved_on
              ? new Date(header.approved_on)
              : null,

            VERIFIED_BY: header.verified_by,

            VERIFIED_ON: header.verified_on
              ? new Date(header.verified_on)
              : null,

            CANCELLD_BY: header.cancelld_by,
            RESUME_APPROVED_BY: header.resume_approved_by,

            LEAVE_START_DATE: header.leave_start_date
              ? new Date(header.leave_start_date)
              : null,

            LEAVE_END_DATE: header.leave_end_date
              ? new Date(header.leave_end_date)
              : null,

            APPROVAL_REMARKS: header.approval_remarks,
            RESUME_REMARKS: header.resume_remarks,

            RESUME_APPROVED_ON:
              header.resume_approved_on
                ? new Date(header.resume_approved_on)
                : null,

            LVE_DOC_NO: header.lve_doc_no,

            LEAVE_REQUEST_DATE:
              header.leave_request_date
                ? new Date(header.leave_request_date)
                : null,

            VAC_ADV_PAID: header.vac_adv_paid,

            DUTY_RESUME_DATE:
              header.duty_resume_date
                ? new Date(header.duty_resume_date)
                : null,

            VERIFIED_REMARKS:
              header.verified_remarks,

            VERIFIED_STATUS:
              header.verified_status,

            DOC_TYPE: header.doc_type,

            INCLUDE_CONSOLIDATE:
              header.include_consolidate,

            LVE_APPROVED:
              header.lve_approved,

            REF_HDR_LVE_SLNO:
              header.ref_hdr_lve_slno,

            REF_LVE_DOC_NO:
              header.ref_lve_doc_no,

            LVE_CONTINUITY:
              header.lve_continuity,

            SYS_GENERATED:
              header.sys_generated,

            PASI_MONTHS_DEDUCT:
              header.pasi_months_deduct,

            PASI_AMT:
              header.pasi_amt,

            LEAVE_CREATED:
              header.leave_created
                ? new Date(header.leave_created)
                : null,

            AMT_AVAIL_NCASH:
              header.amt_avail_ncash,

            CAUSE_TYPE:
              header.cause_type,

            EXTRA_REMARKS:
              header.extra_remarks,

            PAY_MONTH:
              header.pay_month,

            PAY_YEAR:
              header.pay_year
          }
        },

        p_details: {
          type: "HR_EMP_LEAVE_DET_TAB",
          val: details.map((d: any) => ({
            HDR_LVE_SLNO: d.hdr_lve_slno,
            LEAVE_TYPE: d.leave_type,

            LEAVE_START_DATE: d.leave_start_date
              ? new Date(d.leave_start_date)
              : null,

            LEAVE_END_DATE: d.leave_end_date
              ? new Date(d.leave_end_date)
              : null,

            LEAVE_DAYS: d.leave_days,
            LEAVE_REASON: d.leave_reason,
            DAYS_ADJUSTED: d.days_adjusted,
            HALF_DAY: d.half_day,
            ADJ_REMARKS: d.adj_remarks,
            STATUS: d.status,
            USER_ID: d.user_id,

            USER_DT: d.user_dt
              ? new Date(d.user_dt)
              : null,

            REMARKS: d.remarks,
            COMPANY_CODE: d.company_code,
            EMPLOYEE_ID: d.employee_id,

            REQ_FROM: d.req_from
              ? new Date(d.req_from)
              : null,

            REQ_TO: d.req_to
              ? new Date(d.req_to)
              : null,

            DOC_TYPE: d.doc_type,
            LVE_DOC_NO: d.lve_doc_no,
            UNAUTH: d.unauth,
            FY_LEAVE_DAYS: d.fy_leave_days,

            FY_ANNY_DATE: d.fy_anny_date
              ? new Date(d.fy_anny_date)
              : null,

            LVE_WRK_DAYS: d.lve_wrk_days,
            LVE_DAYS_PERIOD: d.lve_days_period
          }))
        }
      },
      {
        autoCommit: false
      }
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "Leave saved successfully"
    });

  } catch (error: any) {

    if (connection) {
      await connection.rollback();
    }

    res.status(500).json({
      success: false,
      message: error.message
    });

  } finally {

    if (connection) {
      await connection.close();
    }

  }

};

