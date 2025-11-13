// leaveNotifications.ts
import oracledb from "oracledb";
import { oracleDb } from "./../../../src/database/connection";
import { notifyUser } from "../../../src/helpers/functions";
import constants from "../../helpers/constants";

type LeaveRow = {
  REQUEST_NUMBER?: string;
  COMPANY_CODE?: string;
  FINAL_APPROVED?: string | null;
  NEXT_ACTION_BY?: string | null;
  EMPLOYEE_CODE?: string | null;
  IMMEDIATE_SUPERVISOR?: string | null;
  HOD?: string | null;
  DEPT_HEAD?: string | null;
  CREATE_USER?: string | null;
  EMPLOYEE_NAME?: string | null;
  REJECT_HISTORY?: string | null;
  SENTBACK_HISTORY?: string | null;
};

async function getEmailForEmployeeCode(
  connection: oracledb.Connection,
  employeeCode?: string | null,
  companyCode?: string | null
): Promise<string | null> {
  if (!employeeCode) return null;
  const sql = `
    SELECT TRIM(EMAIL_ADDRESS) AS EMAIL_ADDRESS
    FROM SEC_LOGIN
    WHERE TRIM(LOGINID1) = :emp
    ${companyCode ? "AND COMPANY_CODE = :comp" : ""}
    FETCH FIRST 1 ROWS ONLY
  `;
  const binds: any = { emp: employeeCode.trim() };
  if (companyCode) binds.comp = companyCode;
  const res = await connection.execute<{ EMAIL_ADDRESS?: string }>(sql, binds, {
    outFormat: oracledb.OUT_FORMAT_OBJECT,
  });
  return res.rows?.[0]?.EMAIL_ADDRESS?.trim() ?? null;
}

export async function sendLeaveNotifications(requestNumber: string, companyCode?: string) {
  const connection = await oracleDb.getConnection();
  try {
    const sql = `
      SELECT
        TRIM(NVL(REQUEST_NUMBER,'')) AS REQUEST_NUMBER,
        TRIM(NVL(COMPANY_CODE,'')) AS COMPANY_CODE,
        TRIM(NVL(FINAL_APPROVED,'NO')) AS FINAL_APPROVED,
        TRIM(NVL(NEXT_ACTION_BY,'')) AS NEXT_ACTION_BY,
        TRIM(NVL(EMPLOYEE_CODE,'')) AS EMPLOYEE_CODE,
        TRIM(NVL(IMMEDIATE_SUPERVISOR,'')) AS IMMEDIATE_SUPERVISOR,
        TRIM(NVL(HOD,'')) AS HOD,
        TRIM(NVL(DEPT_HEAD,'')) AS DEPT_HEAD,
        TRIM(NVL(CREATE_USER,'')) AS CREATE_USER,
        TRIM(NVL(EMPLOYEE_NAME,'')) AS EMPLOYEE_NAME,
        TRIM(NVL(REJECT_HISTORY,'')) AS REJECT_HISTORY,
        TRIM(NVL(SENTBACK_HISTORY,'')) AS SENTBACK_HISTORY
      FROM LEAVE_REQUEST_FLOW
      WHERE REQUEST_NUMBER = :req
      ${companyCode ? "AND COMPANY_CODE = :comp" : ""}
      FETCH FIRST 1 ROWS ONLY
    `;
    const binds: any = { req: requestNumber };
    if (companyCode) binds.comp = companyCode;

    const res = await connection.execute<LeaveRow>(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    const row = res.rows?.[0] as LeaveRow | undefined;
    if (!row) {
      console.warn("[sendLeaveNotifications] no row found for", requestNumber);
      return;
    }

    const finalVal = (row.FINAL_APPROVED ?? "NO").toString().trim().toUpperCase();
    const nextActionRaw = (row.NEXT_ACTION_BY ?? "").toString().trim();

    // resolve common emails
    const employeeEmail = await getEmailForEmployeeCode(connection, row.EMPLOYEE_CODE, row.COMPANY_CODE);
    const creatorEmail = await getEmailForEmployeeCode(connection, row.CREATE_USER, row.COMPANY_CODE);
    const imSupEmail = await getEmailForEmployeeCode(connection, row.IMMEDIATE_SUPERVISOR, row.COMPANY_CODE);
    const hodEmail = await getEmailForEmployeeCode(connection, row.HOD, row.COMPANY_CODE);
    const deptHeadEmail = await getEmailForEmployeeCode(connection, row.DEPT_HEAD, row.COMPANY_CODE);

    // 1) Final approved
    if (finalVal === "YES") {
      const recipients = [employeeEmail, creatorEmail].filter(Boolean) as string[];
      if (recipients.length) {
        await notifyUser({
          event: constants.EVENTS.LEAVE_APPROVED,
          request_user: { request_number: requestNumber, company_code: row.COMPANY_CODE },
          request_users: recipients.join(","),
          subject: `Leave Approved: ${requestNumber}`,
          message: `Your leave request (${requestNumber}) has been approved.`,
          htmlMessage: `<p>Your leave request <b>${requestNumber}</b> has been approved.</p>`,
        });
      }
      return;
    }

    // 2) Rejected
    if (finalVal === "CANCEL" || finalVal === "CANCEL") {
      const target = employeeEmail || creatorEmail;
      if (target) {
        await notifyUser({
          event: constants.EVENTS.LEAVE_CANCEL,
          request_user: { request_number: requestNumber, reason: row.REJECT_HISTORY },
          request_users: target,
          subject: `Leave Rejected: ${requestNumber}`,
          message: `Your leave request (${requestNumber}) has been rejected. ${row.REJECT_HISTORY || ""}`,
          htmlMessage: `<p>Your leave request <b>${requestNumber}</b> has been rejected.<br/>${row.REJECT_HISTORY || ""}</p>`,
        });
      }
      return;
    }

    // 3) Sent back
    if (finalVal === "SENTBACK" || finalVal === "SENT BACK") {
      const target = employeeEmail || creatorEmail;
      if (target) {
        await notifyUser({
          event: constants.EVENTS.LEAVE_SENTBACK,
          request_user: { request_number: requestNumber, reason: row.SENTBACK_HISTORY },
          request_users: target,
          subject: `Leave Sent Back: ${requestNumber}`,
          message: `Your leave request (${requestNumber}) has been sent back. ${row.SENTBACK_HISTORY || ""}`,
          htmlMessage: `<p>Your leave request <b>${requestNumber}</b> has been sent back.<br/>${row.SENTBACK_HISTORY || ""}</p>`,
        });
      }
      return;
    }

    if (finalVal !== "NO") {
      let recipientEmail: string | null = null;
      let roleLabel = "";

      const U = nextActionRaw.toUpperCase();
      if (/IMMEDIATE_SUPERVISOR/i.test(U)) {
        roleLabel = "Immediate Supervisor";
        recipientEmail = imSupEmail;
      } else if (/HOD/i.test(U)) {
        roleLabel = "HOD";
        recipientEmail = hodEmail;
      } else if (/DEPT|DEPARTMENT|DEPT_HEAD/i.test(U)) {
        roleLabel = "Department Head";
        recipientEmail = deptHeadEmail;
      } else if (/LAST|FINAL|FINAL_APPROVAL|LAST_APPROVAL/i.test(U)) {
        roleLabel = "Final Approver";
        recipientEmail = creatorEmail || employeeEmail;
      } else if (nextActionRaw) {
        // fallback: treat NEXT_ACTION_BY as an employee code/loginid
        recipientEmail = await getEmailForEmployeeCode(connection, nextActionRaw, row.COMPANY_CODE);
        roleLabel = `User ${nextActionRaw}`;
      }

      if (recipientEmail) {
        // notify next approver
        await notifyUser({
          event: constants.EVENTS.LEAVE_APPROVAL_REQUEST,
          request_user: { request_number: requestNumber, company_code: row.COMPANY_CODE },
          request_users: recipientEmail,
          subject: `Leave Approval Required: ${requestNumber} (${roleLabel})`,
          message: `Leave request ${requestNumber} for ${row.EMPLOYEE_NAME || ""} requires your action as ${roleLabel}.`,
          htmlMessage: `<p>Leave request <b>${requestNumber}</b> for ${row.EMPLOYEE_NAME || ""} requires your action as <b>${roleLabel}</b>.</p>`,
        });
      } else {
        console.warn("[sendLeaveNotifications] couldn't resolve recipient for NEXT_ACTION_BY:", nextActionRaw);
      }

      // inform employee (requester) that request is now with approver
      if (employeeEmail) {
        await notifyUser({
          event: constants.EVENTS.LEAVE_INFO,
          request_user: { request_number: requestNumber, status: "With approver", role: roleLabel },
          request_users: employeeEmail,
          subject: `Leave Request ${requestNumber} - With ${roleLabel}`,
          message: `Your leave request (${requestNumber}) is currently with ${roleLabel}.`,
          htmlMessage: `<p>Your leave request <b>${requestNumber}</b> is currently with <b>${roleLabel}</b>.</p>`,
        });
      }
    } else {
      console.log(`[sendLeaveNotifications] FINAL_APPROVED='NO' for ${requestNumber} - skipping.`);
    }
  } catch (err) {
    console.error("[sendLeaveNotifications] error:", err);
    throw err;
  } finally {
    try {
      await connection.close();
    } catch (closeErr) {
      console.warn("[sendLeaveNotifications] close connection error", closeErr);
    }
  }
}
