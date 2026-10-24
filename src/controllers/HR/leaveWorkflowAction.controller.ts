import { Response } from 'express';
import oracledb from 'oracledb';
import { RequestWithUser } from '../../interfaces/common.interface';
import { QueryExecutor } from '../../database/QueryExecutor';
import { resolveHrWorkflowIdentity } from '../../utils/workflowVisibility';
import { decorateLeave, leavePermissions, leaveVersion, leaveBusinessDate, requiresLeaveAttachment, LeaveRecord } from '../../utils/leaveWorkflow';
import { upsertLeaveApproval } from './hr_leave_approval';
import { getRequestFlowUsers } from './hr_leave_flow_sentback';
import { newvalidateLeaveHandler } from './hr_net.controller';

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
async function invoke(handler: any, req: RequestWithUser, query: Record<string, unknown>) {
  let status = 200, body: any;
  const response: any = { status(code: number) { status = code; return this; }, json(value: any) { body = value; return this; } };
  await handler({ ...req, query }, response);
  if (status >= 400) throw fail(body?.message || body?.error || 'Workflow lookup failed.', status);
  return body;
}
async function context(req: RequestWithUser) {
  if (/[a-z]/i.test(req.user.loginid)) throw fail('Use the existing MHDL leave workflow.', 403);
  const actor = await resolveHrWorkflowIdentity(req.user, (sql, binds) => QueryExecutor.executeRawQuery(sql, binds));
  const binds = { company: req.user.company_code, request: decodeURIComponent(String(req.params.requestNumber)) };
  const result = await QueryExecutor.executeRawQuery('SELECT * FROM LEAVE_REQUEST_FLOW WHERE COMPANY_CODE=:company AND REQUEST_NUMBER=:request', binds);
  if (!result.rows?.[0]) throw fail('This leave request was not found.', 404);
  return { actor, row: result.rows[0] as LeaveRecord, binds };
}
export async function getLeaveWorkflowRequest(req: RequestWithUser, res: Response): Promise<void> {
  try {
    const { actor, row, binds } = await context(req);
    const related = [row.CREATED_BY, row.CREATE_USER, row.NEXT_ACTION_BY, row.IMMEDIATE_SUPERVISOR, row.DEPT_HEAD, row.HOD].some(value => String(value ?? '').trim() === actor);
    if (!related) {
      const history = await QueryExecutor.executeRawQuery(`SELECT COUNT(*) N FROM LEAVE_REQUEST_FLOW_HISTRY
        WHERE COMPANY_CODE=:company AND REQUEST_NUMBER=:request AND (UPDATED_BY=:actor OR NEXT_ACTION_BY=:actor)`, { ...binds, actor });
      if (!Number(history.rows?.[0]?.N)) throw fail('This leave request is not part of your workflow.', 403);
    }
    res.json({ success: true, data: decorateLeave(row, actor) });
  } catch (error: any) { res.status(error.status || 500).json({ success: false, message: error.message }); }
}
async function targets(req: RequestWithUser, actor: string, row: LeaveRecord) {
  const body = await invoke(getRequestFlowUsers, req, { doc_id: row.REQUEST_NUMBER, loginId: actor });
  // The supplied reference handler returns success:false with a valid data array.
  // Normalize that legacy response only after its HTTP status/shape are verified.
  if (!Array.isArray(body?.data)) throw fail('Send-back recipients could not be loaded.');
  return body.data.filter((item: any) => String(item.LOGIN_ID ?? item.login_id ?? '').trim() !== actor);
}
export async function getLeaveWorkflowTargets(req: RequestWithUser, res: Response): Promise<void> {
  try {
    const { actor, row } = await context(req);
    if (!leavePermissions(row, actor).canSendBack) throw fail('This request is not assigned to you for send back.', 403);
    res.json({ success: true, data: await targets(req, actor, row) });
  } catch (error: any) { res.status(error.status || 500).json({ success: false, message: error.message }); }
}
const iso = leaveBusinessDate;

export async function saveLeaveWorkflowAction(req: RequestWithUser, res: Response): Promise<void> {
  try {
    const { actor, row, binds } = await context(req);
    const action = String(req.body.action || '');
    const reason = String(req.body.reason || '').trim();
    const recipient = String(req.body.recipient || '').trim();
    const permissions = leavePermissions(row, actor);
    if (!['SUBMITTED','REJECTED','SENTBACK'].includes(action)) throw fail('Unsupported leave action.');
    const allowed = action === 'SUBMITTED' ? permissions.canApprove || permissions.canSubmit : action === 'REJECTED' ? permissions.canReject : permissions.canSendBack;
    if (!allowed) throw fail('This request is no longer assigned to you for this action. Refresh the list.', 403);
    const version = leaveVersion(row);
    if (!req.body.version || req.body.version !== version) throw fail('This request changed while open. Reopen it before taking an action.', 409);
    if (action !== 'SUBMITTED' && !reason) throw fail('Please enter a reason.');
    if (action === 'SENTBACK') {
      const users = await targets(req, actor, row);
      if (!users.some((item: any) => String(item.LOGIN_ID ?? item.login_id ?? '').trim() === recipient)) throw fail('Select an available send-back recipient.');
    }
    if (action === 'SUBMITTED' && permissions.canSubmit && req.body.changes) {
      const editable = ['EMPLOYEE_CODE','EMPLOYEE_NAME','REQUEST_DATE','LEAVE_TYPE','LEAVE_START_DATE','LEAVE_END_DATE','LEAVE_DAYS','REMARKS','HALF_DAY',
        'LEAVE_ALLOWANCE','ADV_PAYMENT','CAUSE_TYPE','AIR_TICKET','AIR_ROUTE','TRAVEL_DATE','TRAVEL_END_DATE','NAME_OF_REPLACEMENT',
        'CONTACT_DETAILS_DURING_LEAVE','ACTUAL_RESUME_DATE','DUTY_RESUME_DATE','IMMEDIATE_SUPERVISOR','DEPT_HEAD','HOD'];
      for (const key of editable) if (Object.prototype.hasOwnProperty.call(req.body.changes, key)) row[key] = req.body.changes[key];
    }
    if (action === 'SUBMITTED' && (!row.EMPLOYEE_CODE || !row.LEAVE_TYPE || !row.LEAVE_START_DATE || !row.LEAVE_END_DATE ||
      !Number.isFinite(Number(row.LEAVE_DAYS)) || Number(row.LEAVE_DAYS) <= 0 || !String(row.REMARKS ?? '').trim() || iso(row.LEAVE_END_DATE)! < iso(row.LEAVE_START_DATE)!)) {
      throw fail('Employee, leave type, valid dates, positive leave days and remarks are required.');
    }
    if (action === 'SUBMITTED' && requiresLeaveAttachment(row)) {
      const files = await QueryExecutor.executeRawQuery(`SELECT COUNT(*) N FROM UPLOADED_FILES_DLTS_VH
        WHERE COMPANY_CODE=:company AND REQUEST_NUMBER=:request AND MODULES='hr'`, binds);
      if (!Number(files.rows?.[0]?.N)) throw fail('An attachment is required for this leave type. Attach it before submitting or approving.');
    }
    if (action === 'SUBMITTED' && row.LEAVE_TYPE !== 'SL' && !row.ACTUAL_RESUME_DATE && !row.DUTY_RESUME_DATE) {
      const date = (value: any) => iso(value)!.split('-').reverse().join('-');
      const validation = await invoke(newvalidateLeaveHandler, req, {
        companyCode: row.COMPANY_CODE, employeeId: row.EMPLOYEE_CODE, leaveStartDate: date(row.LEAVE_START_DATE),
        leaveEndDate: date(row.LEAVE_END_DATE), leaveType: row.LEAVE_TYPE, leaveDays: row.LEAVE_DAYS,
      });
      if (validation?.isValid !== true || (validation.availableBalance != null && Number(validation.availableBalance) < Number(row.LEAVE_DAYS))) throw fail(validation?.message || 'Leave balance validation failed.');
    }
    const payload: any = { ...row, UPDATED_BY: actor, LAST_ACTION: action };
    for (const field of ['REQUEST_DATE','LEAVE_START_DATE','LEAVE_END_DATE','TRAVEL_DATE','TRAVEL_END_DATE','ACTUAL_RESUME_DATE','DUTY_RESUME_DATE']) payload[field] = iso(row[field]);
    if (action === 'SENTBACK') { payload.NEXT_ACTION_BY = recipient; payload.SENTBACK_HISTORY = reason; }
    else delete payload.NEXT_ACTION_BY;
    if (action === 'REJECTED') payload.CANCEL_REMARK = reason;
    await upsertLeaveApproval(payload, async connection => {
      const locked = await connection.execute<LeaveRecord>('SELECT * FROM LEAVE_REQUEST_FLOW WHERE COMPANY_CODE=:company AND REQUEST_NUMBER=:request FOR UPDATE', binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      if (!locked.rows?.[0] || leaveVersion(locked.rows[0]) !== version) throw fail('This request has already changed. Refresh the list.', 409);
    });
    const updated = await QueryExecutor.executeRawQuery('SELECT * FROM LEAVE_REQUEST_FLOW WHERE COMPANY_CODE=:company AND REQUEST_NUMBER=:request', binds);
    res.json({ success: true, data: updated.rows?.[0] ? decorateLeave(updated.rows[0], actor) : null,
      message: action === 'SUBMITTED' ? permissions.mode === 'resumption' ? 'Leave resumption approval saved.' : permissions.canSubmit ? 'Leave request resubmitted.' : 'Leave approval saved.' : action === 'REJECTED' ? 'Leave request rejected.' : 'Leave request sent back.' });
  } catch (error: any) { res.status(error.status || 500).json({ success: false, message: error.message || 'Leave action could not be saved.' }); }
}
