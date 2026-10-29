import { Response } from 'express';
import { RequestWithUser } from '../../interfaces/common.interface';
import { QueryExecutor } from '../../database/QueryExecutor';
import { leaveBucketWhere, legacyLeaveBucketWhere, resolveHrWorkflowIdentity } from '../../utils/workflowVisibility';
import { decorateLeave, leaveReaderSelect, leaveReaderSource } from '../../utils/leaveWorkflow';

const buckets: Record<string, string> = {
  pending: 'Pg_Leave_flow', inProgress: 'Pg_leave_flow_InProgress', closed: 'Pg_leave_flow_close',
  rejected: 'Pg_leave_flow_Rejected', cancelled: 'Pg_leave_flow_cancel',
  sentBack: 'Pg_leave_flow_SentBack',
};

// APK-only reader. The desktop HR controller and /auth/me remain unchanged.
export async function getMobileLeaveBucket(req: RequestWithUser, res: Response): Promise<void> {
  /*
const buckets: Record<string, string> = {
  pending: 'Pg_Leave_flow', inProgress: 'Pg_leave_flow_InProgress', closed: 'Pg_leave_flow_close',
  rejected: 'Pg_leave_flow_Rejected', cancelled: 'Pg_leave_flow_cancel',
  sentBack: 'Pg_leave_flow_SentBack',
};
  */

  const master = buckets[String(req.params.bucket)];
  
  console.log('Master', master); // master from the params

  if (!master) { res.status(400).json({ success: false, message: 'Unknown mobile leave bucket.' }); return; }
  try {
    const workflowLoginId = await resolveHrWorkflowIdentity(req.user, (sql, binds) => QueryExecutor.executeRawQuery(sql, binds));

    // get LOGINID, LOGINID1 FROM SEC_LOGIN where company_code = req.user.company_code and loginid = req.user.loginid
    console.log('Workflow Login ID:', workflowLoginId); // Log the resolved workflow login ID

    const legacy = /[a-z]/i.test(req.user.loginid);

    console.log('Legacy:', legacy); // Log whether the user is considered legacy

    if (legacy && master === 'Pg_leave_flow_SentBack') { res.json({ success: true, data: { tableData: [], count: 0, workflowLoginId } }); return; }

    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    const limit = Math.min(1000, Math.max(1, Math.floor(Number(req.query.limit) || 100)));
    const binds = { company_code: req.user.company_code.trim(), loginid: workflowLoginId };


    /*
export function legacyLeaveBucketWhere(master: string): string {
  const related = `(TRIM(L.CREATED_BY) = :loginid OR TRIM(L.IMMEDIATE_SUPERVISOR) = :loginid
    OR TRIM(L.DEPT_HEAD) = :loginid OR TRIM(L.HOD) = :loginid)`;
  const participated = `(TRIM(L.CREATED_BY) = :loginid OR L.REQUEST_NUMBER IN (SELECT H.REQUEST_NUMBER FROM LEAVE_REQUEST_FLOW_HISTRY H
      WHERE H.COMPANY_CODE = :company_code
        AND (H.NEXT_ACTION_BY = :loginid OR H.UPDATED_BY = :loginid)))`;
  const active = `UPPER(TRIM(NVL(L.LAST_ACTION, 'NONE'))) NOT IN ('REJECTED','CANCEL','CANCELLED','CANCELED')`;
  const notFinal = `UPPER(TRIM(NVL(L.FINAL_APPROVED, 'NO'))) NOT IN ('YES','Y')`;
  const resumption = `(TRIM(L.IMMEDIATE_SUPERVISOR) = :loginid AND L.ACTUAL_RESUME_DATE IS NOT NULL
    AND UPPER(TRIM(NVL(L.RESUME_DATE_APPROVED, 'NO'))) NOT IN ('YES','Y'))`;
  let condition: string;
  switch (master) {
    case 'Pg_Leave_flow':
      condition = `${active} AND ((TRIM(L.NEXT_ACTION_BY) = :loginid AND ${notFinal})
        OR (UPPER(TRIM(L.LAST_ACTION)) = 'SAVEASDRAFT' AND TRIM(L.CREATED_BY) = :loginid)
        OR ${resumption})`; break;
    case 'Pg_leave_flow_InProgress':
      condition = `${active} AND ${notFinal} AND UPPER(TRIM(NVL(L.LAST_ACTION, 'NONE'))) <> 'SAVEASDRAFT'
        AND NVL(TRIM(L.NEXT_ACTION_BY), 'NONE') <> :loginid AND NOT ${resumption} AND ${related} AND ${participated}`; break;
    case 'Pg_leave_flow_close':
      condition = `${active} AND UPPER(TRIM(L.FINAL_APPROVED)) IN ('YES','Y') AND ${related}`; break;
    case 'Pg_leave_flow_Rejected':
      condition = `UPPER(TRIM(L.LAST_ACTION)) = 'REJECTED' AND ${related}`; break;
    case 'Pg_leave_flow_cancel':
      condition = `UPPER(TRIM(L.LAST_ACTION)) IN ('CANCEL','CANCELLED','CANCELED') AND ${related}`; break;
    default: throw new Error('Unknown leave approval bucket.');
  }
  return `TRIM(L.COMPANY_CODE) = :company_code AND (${condition})`;
}

export function leaveBucketWhere(master: string): string {
  const related = `(TRIM(L.CREATED_BY) = :loginid OR TRIM(L.IMMEDIATE_SUPERVISOR) = :loginid
    OR TRIM(L.DEPT_HEAD) = :loginid OR TRIM(L.HOD) = :loginid)`;
  const participated = `(TRIM(L.CREATED_BY) = :loginid OR L.REQUEST_NUMBER IN (SELECT H.REQUEST_NUMBER FROM LEAVE_REQUEST_FLOW_HISTRY H
      WHERE H.COMPANY_CODE = :company_code
        AND (H.NEXT_ACTION_BY = :loginid OR H.UPDATED_BY = :loginid)))`;
  const active = `UPPER(TRIM(NVL(L.LAST_ACTION, 'NONE'))) NOT IN ('REJECTED','CANCEL','CANCELLED','CANCELED')`;
  const notFinal = `UPPER(TRIM(NVL(L.FINAL_APPROVED, 'NO'))) NOT IN ('YES','Y')`;
  const resumption = `(TRIM(L.IMMEDIATE_SUPERVISOR) = :loginid AND L.ACTUAL_RESUME_DATE IS NOT NULL
    AND UPPER(TRIM(NVL(L.RESUME_DATE_APPROVED, 'NO'))) NOT IN ('YES','Y'))`;
  let condition: string;
  switch (master) {
    case 'Pg_Leave_flow':
      condition = `${active} AND ((TRIM(L.NEXT_ACTION_BY) = :loginid AND ${notFinal})
        OR (${resumption} AND ${notFinal}))`; break;
    case 'Pg_leave_flow_InProgress':
      condition = `${active} AND ${notFinal} AND UPPER(TRIM(NVL(L.LAST_ACTION, 'NONE'))) <> 'SAVEASDRAFT'
        AND NVL(TRIM(L.NEXT_ACTION_BY), 'NONE') <> :loginid AND NOT ${resumption} AND ${related} AND ${participated}`; break;
    case 'Pg_leave_flow_close':
      condition = `${active} AND UPPER(TRIM(L.FINAL_APPROVED)) IN ('YES','Y') AND ${related}`; break;
    case 'Pg_leave_flow_Rejected':
      condition = `UPPER(TRIM(L.LAST_ACTION)) = 'REJECTED' AND ${related}`; break;
    case 'Pg_leave_flow_SentBack':
      condition = `UPPER(TRIM(L.LAST_ACTION)) = 'SENTBACK' AND (${related} OR TRIM(L.NEXT_ACTION_BY) = :loginid)`; break;
    case 'Pg_leave_flow_cancel':
      condition = `UPPER(TRIM(L.LAST_ACTION)) IN ('CANCEL','CANCELLED','CANCELED') AND TRIM(L.CREATED_BY) = :loginid`; break;
    default: throw new Error('Unknown leave approval bucket.');
  }
  return `TRIM(L.COMPANY_CODE) = :company_code AND (${condition})`;
}

    */
    const where = legacy ? legacyLeaveBucketWhere(master) : leaveBucketWhere(master);


    // leaveReaderSource = `LEAVE_REQUEST_FLOW L`;
    const source = legacy ? 'VW_HR_LEAVE_REQUEST_FLOW L' : leaveReaderSource;


    /*
    export const leaveReaderSelect = `SELECT L.*,
  (SELECT MAX(E.RPT_NAME) FROM VW_HR_EMPLOYEE_AWARE E WHERE E.COMPANY_CODE=L.COMPANY_CODE AND E.EMPLOYEE_ID=L.NEXT_ACTION_BY) NEXT_ACTION_BY_NAME,
  (SELECT MAX(E.RPT_NAME) FROM VW_HR_EMPLOYEE_AWARE E WHERE E.COMPANY_CODE=L.COMPANY_CODE AND E.EMPLOYEE_ID=L.IMMEDIATE_SUPERVISOR) IMMEDIATE_SUPERVISOR_NAME,
  (SELECT MAX(E.RPT_NAME) FROM VW_HR_EMPLOYEE_AWARE E WHERE E.COMPANY_CODE=L.COMPANY_CODE AND E.EMPLOYEE_ID=L.DEPT_HEAD) DEPT_HEAD_NAME,
  (SELECT MAX(E.RPT_NAME) FROM VW_HR_EMPLOYEE_AWARE E WHERE E.COMPANY_CODE=L.COMPANY_CODE AND E.EMPLOYEE_ID=L.HOD) HOD_NAME,
  (SELECT MAX(T.LEAVE_TYPE_DESC) FROM VW_MS_HR_LEAVE_TYPES_AWARE T WHERE T.COMPANY_CODE=L.COMPANY_CODE AND T.LEAVE_TYPE=L.LEAVE_TYPE) LEAVE_TYPE_DESC
  FROM ${leaveReaderSource}`;
    */
    const select = legacy ? `SELECT L.* FROM ${source}` : leaveReaderSelect;
    const count = await QueryExecutor.executeRawQuery(`SELECT COUNT(*) TOTALCOUNT FROM ${source} WHERE ${where}`, binds);
    const rows = await QueryExecutor.executeRawQuery(`${select} WHERE ${where}
      ORDER BY L.REQUEST_NUMBER DESC OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`, { ...binds, offset: (page - 1) * limit, limit });
    res.status(200).json({ success: true, data: { tableData: legacy ? rows.rows || [] : (rows.rows || []).map((row: any) => decorateLeave(row, workflowLoginId)), count: Number(count.rows?.[0]?.TOTALCOUNT || 0), workflowLoginId } });
  } catch (error) {
    console.error('Mobile leave bucket failed:', error);
    res.status(500).json({ success: false, message: 'Mobile leave requests could not be loaded. Please retry or contact your administrator.' });
  }
}

export async function getLeaveWorkflowIdentity(req: RequestWithUser, res: Response): Promise<void> {
  try {
    const workflowLoginId = await resolveHrWorkflowIdentity(req.user, (sql, binds) => QueryExecutor.executeRawQuery(sql, binds));
    res.json({ success: true, data: { workflowLoginId } });
  } catch { res.status(500).json({ success: false, message: 'Your HR workflow identity could not be verified.' }); }
}
