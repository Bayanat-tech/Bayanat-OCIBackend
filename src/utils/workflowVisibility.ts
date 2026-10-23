export type WorkflowUser = { loginid: string; company_code: string };
type Query = (sql: string, binds: Record<string, unknown>) => Promise<any>;

export async function resolveHrWorkflowIdentity(user: WorkflowUser, query: Query): Promise<string> {
  if (!user.loginid || !user.company_code) throw new Error('Authenticated workflow identity is missing.');
  const result = await query(`SELECT LOGINID, LOGINID1 FROM SEC_LOGIN
    WHERE TRIM(LOGINID) = :workflow_loginid AND TRIM(COMPANY_CODE) = :workflow_company`,
    { workflow_loginid: user.loginid.trim(), workflow_company: user.company_code.trim() });
  const rows = Array.isArray(result) ? result : result.rows;
  if (!rows?.length) throw new Error('Your tenant HR profile was not found. Please contact the administrator.');
  const identities = new Set<string>(rows.map((row: any) => String(row.LOGINID1 || row.LOGINID).trim()));
  if (identities.size !== 1) throw new Error('Your tenant HR profile has conflicting employee IDs.');
  return [...identities][0];
}

const scopedParameters = new Set(['Amlspf_mytaskalmsPage', 'PS_PREQUEST_ENTRY_TAB_LIST', 'PS_PREQUEST_ENTRY_POGENERATED']);
export function scopeAlmsApprovalQuery(parameter: string, sql: string, user?: WorkflowUser) {
  if (!scopedParameters.has(parameter)) return { sql, binds: {} };
  if (!user?.loginid || !user.company_code) throw new Error('Authenticated workflow identity is missing.');
  // The legacy My Tasks query and CLOSED register query return the whole company.
  // Check the actual flow assignment, with own requests retained for their creator.
  return {
    sql: `SELECT V.* FROM (${sql.trim().replace(/;$/, '')}) V
      WHERE TRIM(V.COMPANY_CODE) = :scope_company
      AND (TRIM(V.USER_ID) = :scope_loginid OR TRIM(V.CREATE_USER) = :scope_loginid
        OR EXISTS (SELECT 1 FROM VW_GLOBAL_APPROVER_LEVELS A
          WHERE TRIM(A.COMPANY_CODE) = TRIM(V.COMPANY_CODE)
            AND TRIM(A.FLOW_CODE) = TRIM(V.FLOW_CODE)
            AND :scope_loginid IN (TRIM(A.EMP_ID_LEVEL1), TRIM(A.EMP_ID_LEVEL2),
              TRIM(A.EMP_ID_LEVEL3), TRIM(A.EMP_ID_LEVEL4), TRIM(A.EMP_ID_LEVEL5),
              TRIM(A.EMP_ID_LEVEL6), TRIM(A.EMP_ID_LEVEL7))))`,
    binds: { scope_company: user.company_code.trim(), scope_loginid: user.loginid.trim() },
  };
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
