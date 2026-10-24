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
  const master = buckets[String(req.params.bucket)];
  if (!master) { res.status(400).json({ success: false, message: 'Unknown mobile leave bucket.' }); return; }
  try {
    const workflowLoginId = await resolveHrWorkflowIdentity(req.user, (sql, binds) => QueryExecutor.executeRawQuery(sql, binds));
    const legacy = /[a-z]/i.test(req.user.loginid);
    if (legacy && master === 'Pg_leave_flow_SentBack') { res.json({ success: true, data: { tableData: [], count: 0, workflowLoginId } }); return; }
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    const limit = Math.min(1000, Math.max(1, Math.floor(Number(req.query.limit) || 100)));
    const binds = { company_code: req.user.company_code.trim(), loginid: workflowLoginId };
    const where = legacy ? legacyLeaveBucketWhere(master) : leaveBucketWhere(master);
    const source = legacy ? 'VW_HR_LEAVE_REQUEST_FLOW L' : leaveReaderSource;
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
