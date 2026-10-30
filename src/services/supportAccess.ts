import { identity, query, supportRole, supportError } from './supportDb';
import oracledb from 'oracledb';

export async function ticketAccess(c: oracledb.Connection, ticketId: number, user: any, lock = false) {
    if (!Number.isSafeInteger(ticketId) || ticketId <= 0)
        supportError('Invalid ticket number');
    const id = identity(user), role = await supportRole(c, user);
    const [t] = await query(c, `SELECT * FROM CUSTOMERS.SUPPORT_TICKET WHERE TICKET_ID=:ticketId${lock ? ' FOR UPDATE' : ''}`, { ticketId });
    const owns = t && String(t.REQUESTER_LOGINID || '').toUpperCase() === id.loginid && t.TENANT_ID === id.tenantId && t.COMPANY_CODE === id.companyCode;
    const assigned = t && role === 'developer' && (String(t.DEVELOPER_LOGINID || '').toUpperCase() === id.loginid || String(t.ASSIGNED_TO || '').toUpperCase() === id.loginid);
    if (!t || !(role === 'admin' || owns || assigned))
        supportError('Ticket not found or not accessible', 404);
    return { ticket: t, role, owns };
}
