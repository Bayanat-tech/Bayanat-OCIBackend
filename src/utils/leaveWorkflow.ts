import { createHash } from 'crypto';

export type LeaveRecord = Record<string, any>;
const norm = (value: unknown) => String(value ?? '').trim().toUpperCase();
const yes = (value: unknown) => ['YES', 'Y'].includes(norm(value));
export function leaveBusinessDate(value: any): string | null {
  if (!value || ['0000-00-00','0000/00/00'].includes(String(value))) return null;
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) throw new Error('A leave date is invalid. Correct the request before submitting.');
  const date = new Date(Number(match[1]), Number(match[2])-1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth()+1 !== Number(match[2]) || date.getDate() !== Number(match[3])) throw new Error('A leave date is invalid.');
  return match[0];
}
export const requiresLeaveAttachment = (row: LeaveRecord) => ['002', '014', '016', 'ACL'].includes(norm(row.LEAVE_TYPE));
export function leavePermissions(row: LeaveRecord, actor: string) {
  const terminal = ['REJECTED', 'CANCEL', 'CANCELLED', 'CANCELED'].includes(norm(row.LAST_ACTION));
  const creator = norm(row.CREATED_BY || row.CREATE_USER) === norm(actor);
  const assigned = norm(row.NEXT_ACTION_BY) === norm(actor);
  const resume = !yes(row.FINAL_APPROVED) && Boolean(row.ACTUAL_RESUME_DATE) && !yes(row.RESUME_DATE_APPROVED) && norm(row.IMMEDIATE_SUPERVISOR) === norm(actor);
  const eligible = Boolean(actor) && !terminal && (((assigned || (creator && norm(row.LAST_ACTION) === 'SAVEASDRAFT')) && !yes(row.FINAL_APPROVED)) || resume);
  return {
    mode: eligible ? resume ? 'resumption' : creator ? 'resubmit' : 'approval' : 'view',
    canSubmit: eligible && creator, canApprove: eligible && !creator,
    canReject: eligible && !creator, canSendBack: eligible && !creator,
  };
}

export function leaveVersion(row: LeaveRecord): string {
  const fields = ['COMPANY_CODE','REQUEST_NUMBER','UPDATED_AT','LAST_ACTION','NEXT_ACTION_BY','CREATED_BY',
    'FINAL_APPROVED','CURRENT_STEP','FLOW_LEVEL_RUNNING','IMMEDIATE_SUPERVISOR','DEPT_HEAD','HOD',
    'LEAVE_TYPE','LEAVE_START_DATE','LEAVE_END_DATE','LEAVE_DAYS','ACTUAL_RESUME_DATE','DUTY_RESUME_DATE','RESUME_DATE_APPROVED'];
  return createHash('sha256').update(JSON.stringify(fields.map(key => row[key] instanceof Date ? row[key].toISOString() : String(row[key] ?? '').trim()))).digest('hex');
}

export function decorateLeave(row: LeaveRecord, actor: string) {
  const dates = Object.fromEntries(['REQUEST_DATE','LEAVE_START_DATE','LEAVE_END_DATE','TRAVEL_DATE','TRAVEL_END_DATE','ACTUAL_RESUME_DATE','DUTY_RESUME_DATE'].map(key => [key, leaveBusinessDate(row[key])]));
  return { ...row, ...dates, WORKFLOW_LOGIN_ID: actor, WORKFLOW_PERMISSIONS: leavePermissions(row, actor),
    WORKFLOW_VERSION: leaveVersion(row), WORKFLOW_REQUIRES_ATTACHMENTS: requiresLeaveAttachment(row) };
}

// Base rows remain visible when NEXT_ACTION_BY is a terminal marker such as
// REJECTED/APPROVED. The legacy view's inner employee join drops those requests.
export const leaveReaderSource = `LEAVE_REQUEST_FLOW L`;
export const leaveReaderSelect = `SELECT L.*,
  (SELECT MAX(E.RPT_NAME) FROM VW_HR_EMPLOYEE_AWARE E WHERE E.COMPANY_CODE=L.COMPANY_CODE AND E.EMPLOYEE_ID=L.NEXT_ACTION_BY) NEXT_ACTION_BY_NAME,
  (SELECT MAX(E.RPT_NAME) FROM VW_HR_EMPLOYEE_AWARE E WHERE E.COMPANY_CODE=L.COMPANY_CODE AND E.EMPLOYEE_ID=L.IMMEDIATE_SUPERVISOR) IMMEDIATE_SUPERVISOR_NAME,
  (SELECT MAX(E.RPT_NAME) FROM VW_HR_EMPLOYEE_AWARE E WHERE E.COMPANY_CODE=L.COMPANY_CODE AND E.EMPLOYEE_ID=L.DEPT_HEAD) DEPT_HEAD_NAME,
  (SELECT MAX(E.RPT_NAME) FROM VW_HR_EMPLOYEE_AWARE E WHERE E.COMPANY_CODE=L.COMPANY_CODE AND E.EMPLOYEE_ID=L.HOD) HOD_NAME,
  (SELECT MAX(T.LEAVE_TYPE_DESC) FROM VW_MS_HR_LEAVE_TYPES_AWARE T WHERE T.COMPANY_CODE=L.COMPANY_CODE AND T.LEAVE_TYPE=L.LEAVE_TYPE) LEAVE_TYPE_DESC
  FROM ${leaveReaderSource}`;
