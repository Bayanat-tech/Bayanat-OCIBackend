import { Response } from 'express';
import { RequestWithUser } from '../../interfaces/common.interface';
import { QueryExecutor } from '../../database/QueryExecutor';
import { leaveBucketWhere, resolveHrWorkflowIdentity } from '../../utils/workflowVisibility';

const buckets: Record<string, string> = {
  pending: 'Pg_Leave_flow', inProgress: 'Pg_leave_flow_InProgress', closed: 'Pg_leave_flow_close',
  rejected: 'Pg_leave_flow_Rejected', cancelled: 'Pg_leave_flow_cancel',
};

// APK-only reader. The desktop HR controller and /auth/me remain unchanged.
export async function getMobileLeaveBucket(req: RequestWithUser, res: Response): Promise<void> {
  const master = buckets[String(req.params.bucket)];
  if (!master) { res.status(400).json({ success: false, message: 'Unknown mobile leave bucket.' }); return; }
  try {
    const workflowLoginId = await resolveHrWorkflowIdentity(req.user, (sql, binds) => QueryExecutor.executeRawQuery(sql, binds));
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    const limit = Math.min(1000, Math.max(1, Math.floor(Number(req.query.limit) || 100)));
    const binds = { company_code: req.user.company_code.trim(), loginid: workflowLoginId };
    const where = leaveBucketWhere(master);
    const count = await QueryExecutor.executeRawQuery(`SELECT COUNT(*) TOTALCOUNT FROM VW_HR_LEAVE_REQUEST_FLOW L WHERE ${where}`, binds);
    const rows = await QueryExecutor.executeRawQuery(`SELECT L.* FROM VW_HR_LEAVE_REQUEST_FLOW L WHERE ${where}
      ORDER BY L.REQUEST_NUMBER DESC OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`, { ...binds, offset: (page - 1) * limit, limit });
    res.status(200).json({ success: true, data: { tableData: rows.rows || [], count: Number(count.rows?.[0]?.TOTALCOUNT || 0), workflowLoginId } });
  } catch (error) {
    console.error('Mobile leave bucket failed:', error);
    res.status(500).json({ success: false, message: 'Mobile leave requests could not be loaded. Please retry or contact your administrator.' });
  }
}
