import { prepareSupportAccess, cacheSupportMember, nativeSupportDevelopers, setNativeSupportAccess, nativeSupportRole } from './supportSecurity.service';
import oracledb from 'oracledb';
import { identity, query, supportError, text, withSupportDb, supportRole, supportEvents } from './supportDb';
import { ticketAccess } from './supportAccess';
import { emitSupportTicketChanged, emitSupportPresenceChanged, getConnectedSupportUsers } from './supportRealtime.service';
import { getSignedUrl } from './ociUpload.service';
import { SupportAssistantService } from './supportAssistant.service';
import { buildSupportEmailHtml } from './supportEmailTemplate';

const NOW = 'CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS DATE)';
const fmt = (col: string) => `TO_CHAR(${col},'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const email = (v: any) => {
    const e = text(v, 400);
    if (e && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(e))
        supportError('Enter a valid email address');
    return e;
};

async function admins(c: oracledb.Connection) {
    try {
        const rows = await query(c, "SELECT EMAIL_ID, NVL(RECIPIENT_TYPE, 'TO') AS RECIPIENT_TYPE FROM CUSTOMERS.SUPPORT_CONTACT WHERE ACTIVE_FLAG='Y'");
        // Only include contacts marked as TO; Prem is kept strictly in CC
        const dbToRecipients = rows
            .filter(r => (r.RECIPIENT_TYPE || 'TO').toUpperCase() === 'TO')
            .map(r => String(r.EMAIL_ID || '').trim())
            .filter(e => e && e.toLowerCase() !== 'prem@bayanattechnology.com');

        const defaultAdmins = ['gaurang.pai@bayanattechnology.com', 'ganesh.thorat@bayanattechnology.com'];
        const combined = Array.from(new Set([...defaultAdmins, ...dbToRecipients]));
        return combined.join(',');
    } catch {
        return 'gaurang.pai@bayanattechnology.com,ganesh.thorat@bayanattechnology.com';
    }
}

export async function queueSupportEmail(c: oracledb.Connection, ticketId: number, key: string, to: string, subject: string, body: string) {
    if (!to)
        return;
    await c.execute(`MERGE INTO CUSTOMERS.SUPPORT_EMAIL_OUTBOX d USING(SELECT :dedupKey DEDUP_KEY FROM dual)s ON(d.DEDUP_KEY=s.DEDUP_KEY) WHEN NOT MATCHED THEN INSERT(TICKET_ID,DEDUP_KEY,RECIPIENTS,SUBJECT,BODY,AVAILABLE_AT,CREATED_AT) VALUES(:ticketId,:dedupKey,:recipients,:mailSubject,:mailBody,${NOW},${NOW})`, { dedupKey: key, ticketId, recipients: to, mailSubject: subject.slice(0, 500), mailBody: { type: oracledb.CLOB, val: body } });
}

async function audit(c: oracledb.Connection, ticketId: number, u: any, event: string, note: string) {
    const id = identity(u);
    await c.execute(`INSERT INTO CUSTOMERS.SUPPORT_EVENT(TICKET_ID,ACTOR_LOGINID,ACTOR_TENANT_ID,EVENT_TYPE,EVENT_TEXT,CREATED_AT) VALUES(:ticketId,:loginid,:tenant,:event,:note,${NOW})`, { ticketId, loginid: id.loginid, tenant: id.tenantId, event, note: note.slice(0, 2000) });
}

async function resolveRequesterName(c: oracledb.Connection, u: any): Promise<string> {
    const rawLogin = String(u.loginid || '').trim();
    const jwtUsername = String(u.username || '').trim();
    if (jwtUsername && jwtUsername.toUpperCase() !== rawLogin.toUpperCase()) {
        return jwtUsername;
    }

    // 1. Try CUSTOMERS.SEC_LOGINTEST
    try {
        const [row] = await query(c, "SELECT USERNAME FROM CUSTOMERS.SEC_LOGINTEST WHERE UPPER(LOGINID)=UPPER(:loginid)", { loginid: rawLogin });
        if (row?.USERNAME && row.USERNAME.trim() && row.USERNAME.trim().toUpperCase() !== rawLogin.toUpperCase()) {
            return row.USERNAME.trim();
        }
    } catch {
        // ignore
    }

    // 2. Try tenant HR employee table MS_HR_EMPLOYEE and SEC_LOGIN
    try {
        const tenantId = u.tenantId || '';
        if (tenantId) {
            const [t] = await query(c, "SELECT SCHEMA_NAME FROM CUSTOMERS.TENANT_REGISTRY WHERE UPPER(TENANT_ID)=UPPER(:tenantId) AND IS_ACTIVE='Y'", { tenantId });
            const schema = String(t?.SCHEMA_NAME || '').toUpperCase();
            if (/^[A-Z0-9_]+$/.test(schema)) {
                const [emp] = await query(c, `SELECT TRIM(NVL(FIRST_NAME, '') || ' ' || NVL(LAST_NAME, '')) AS FULL_NAME, ALIAS_NAME FROM ${schema}.MS_HR_EMPLOYEE WHERE UPPER(EMPLOYEE_CODE)=UPPER(:loginid) OR UPPER(EMPLOYEE_ID)=UPPER(:loginid)`, { loginid: rawLogin });
                if (emp?.FULL_NAME && emp.FULL_NAME.trim()) {
                    return emp.FULL_NAME.trim();
                }
                if (emp?.ALIAS_NAME && emp.ALIAS_NAME.trim()) {
                    return emp.ALIAS_NAME.trim();
                }

                const [sec] = await query(c, `SELECT USERNAME FROM ${schema}.SEC_LOGIN WHERE UPPER(LOGINID)=UPPER(:loginid) OR UPPER(USER_CODE)=UPPER(:loginid)`, { loginid: rawLogin });
                if (sec?.USERNAME && sec.USERNAME.trim() && sec.USERNAME.trim().toUpperCase() !== rawLogin.toUpperCase()) {
                    return sec.USERNAME.trim();
                }
            }
        }
    } catch {
        // ignore
    }

    return jwtUsername || rawLogin;
}

async function insertMessage(c: oracledb.Connection, ticketId: number, u: any, message: string, role: string, files: any[] = []) {
    const id = identity(u);
    const senderName = role.toUpperCase() === 'SYSTEM' ? 'SYSTEM' : await resolveRequesterName(c, u);
    const r = await c.execute(`INSERT INTO CUSTOMERS.SUPPORT_MESSAGE(TICKET_ID,SENDER_LOGINID,SENDER_NAME,SENDER_ROLE,MESSAGE_TEXT,HAS_ATTACHMENTS,SENDER_TENANT_ID,SENDER_COMPANY_CODE,CREATED_AT) VALUES(:ticketId,:loginid,:name,:role,:message,:files,:tenant,:company,${NOW}) RETURNING MESSAGE_ID INTO :id`, { ticketId, loginid: id.loginid, name: text(senderName, 400), role: role.toUpperCase(), message: { type: oracledb.CLOB, val: message }, files: files.length ? 'Y' : 'N', tenant: id.tenantId, company: id.companyCode, id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } });
    const mid = Number((r.outBinds as any).id[0]);
    for (const f of files)
        await c.execute(`INSERT INTO CUSTOMERS.SUPPORT_ATTACHMENT(TICKET_ID,MESSAGE_ID,FILE_NAME,FILE_TYPE,FILE_SIZE,DATA_URL,CREATED_AT) VALUES(:ticketId,:mid,:name,:fileType,:fileSize,:fileData,${NOW})`, { ticketId, mid, name: f.name, fileType: f.type, fileSize: f.size, fileData: { type: oracledb.CLOB, val: f.data } });
    await c.execute(`UPDATE CUSTOMERS.SUPPORT_TICKET SET LAST_MESSAGE=:message,LAST_MESSAGE_AT=${NOW},UPDATED_AT=${NOW} WHERE TICKET_ID=:ticketId`, { ticketId, message: { type: oracledb.CLOB, val: message || '[Attachment]' } });
    return mid;
}

function attachments(input: any) {
    if (input === undefined)
        return [];
    if (!Array.isArray(input) || input.length > 5)
        supportError('Attach up to five files');
    let total = 0;
    return input.map((f: any) => {
        const data = text(f?.data_url, 7500000);
        const m = /^data:(image\/(?:png|jpeg|webp)|application\/pdf|text\/plain);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
        if (!m || m[2].length % 4 !== 0)
            supportError('Use PNG, JPEG, WebP, PDF or text attachments');
        const buf = Buffer.from(m[2], 'base64');
        if (!buf.length || buf.length > 5 * 1024 * 1024)
            supportError('Each attachment must be between 1 byte and 5 MB');
        total += buf.length;
        if (total > 15 * 1024 * 1024)
            supportError('Attachments must total 15 MB or less');
        return { name: text(f.file_name || 'Attachment', 250).replace(/[\\/\r\n"<>]/g, '_'), type: m[1], size: buf.length, data };
    });
}

async function changed(ticketId: number, u: any) {
    supportEvents.emit('changed');
    await emitSupportTicketChanged({ ticketId, actorLoginid: identity(u).loginid });
}

export class SupportChatService {
    static async context(u: any) {
        return withSupportDb(async (c) => {
            const id = identity(u);
            await prepareSupportAccess(c, id);
            const role = await supportRole(c, u);
            if (role !== 'user')
                await cacheSupportMember(c, id, role === 'admin' ? 'ADMIN' : 'DEVELOPER');
            return { role, loginid: id.loginid, tenantId: id.tenantId, company_code: id.companyCode };
        }, true);
    }

    static async heartbeat(u: any) {
        const id = identity(u);
        await withSupportDb(async (c) => {
            await c.execute(`MERGE INTO CUSTOMERS.SUPPORT_PRESENCE d USING(SELECT :loginid LOGINID FROM dual)s ON(UPPER(d.LOGINID)=s.LOGINID) WHEN MATCHED THEN UPDATE SET USERNAME=:name,COMPANY_CODE=:company,TENANT_ID=:tenant,LAST_SEEN_AT=SYSDATE WHEN NOT MATCHED THEN INSERT(LOGINID,USERNAME,COMPANY_CODE,TENANT_ID,LAST_SEEN_AT) VALUES(:loginid,:name,:company,:tenant,SYSDATE)`, { loginid: id.loginid, name: text(u.username || id.loginid, 400), company: id.companyCode, tenant: id.tenantId });
        }, true);
        emitSupportPresenceChanged();
        return { online: true };
    }

    static async getActiveUsers(u: any) {
        return withSupportDb(async (c) => {
            if (await supportRole(c, u) !== 'admin')
                return [];
            const rows = await query(c, `SELECT LOGINID,USERNAME,COMPANY_CODE,TENANT_ID,CASE WHEN LAST_SEEN_AT>=SYSDATE-(1/1440) THEN 'Y' ELSE 'N' END IS_ONLINE FROM CUSTOMERS.SUPPORT_PRESENCE ORDER BY LAST_SEEN_AT DESC FETCH FIRST 200 ROWS ONLY`);
            const keys = new Map(rows.map(r => [`${r.TENANT_ID}:${r.COMPANY_CODE}:${r.LOGINID}`, r]));
            for (const r of getConnectedSupportUsers())
                keys.set(`${r.TENANT_ID}:${r.COMPANY_CODE}:${r.LOGINID}`, r);
            return [...keys.values()];
        });
    }

    static async getTickets(u: any, requestedRole = 'user') {
        return withSupportDb(async (c) => {
            const id = identity(u);
            const role = await supportRole(c, u);
            const all = role === 'admin' && requestedRole !== 'developer' && requestedRole !== 'user_only';
            const binds: any = { ...id };
            let where = '';

            if (all) {
                where = '1=1';
            } else if (role === 'developer' || requestedRole === 'developer') {
                where = '(UPPER(t.DEVELOPER_LOGINID) = :loginid OR UPPER(t.ASSIGNED_TO) = :loginid)';
            } else {
                where = '(UPPER(t.REQUESTER_LOGINID)=:loginid AND t.TENANT_ID=:tenantId AND t.COMPANY_CODE=:companyCode)';
            }

            return query(c, `SELECT t.TICKET_ID,t.COMPANY_CODE,t.TENANT_ID,t.REQUESTER_LOGINID,t.REQUESTER_NAME,t.ASSIGNED_TO,t.SUBJECT,t.MODULE_NAME,t.PAGE_URL,t.STATUS,t.PRIORITY,t.DEVELOPER_LOGINID,t.DEVELOPER_NAME,t.DEV_STATUS,t.ASSIGNED_BY,t.SLA_MINUTES,t.RESOLUTION,
      ${fmt('t.DUE_AT')} DUE_AT,${fmt('t.CREATED_AT')} CREATED_AT,${fmt('t.LAST_MESSAGE_AT')} LAST_MESSAGE_AT,
      DBMS_LOB.SUBSTR(t.LAST_MESSAGE,1000,1) LAST_MESSAGE,
      (SELECT COUNT(*) FROM CUSTOMERS.SUPPORT_MESSAGE m WHERE m.TICKET_ID=t.TICKET_ID AND NVL(m.IS_DELETED,'N')<>'Y' AND NOT(UPPER(m.SENDER_LOGINID)=:loginid AND NVL(m.SENDER_TENANT_ID,:tenantId)=:tenantId AND NVL(m.SENDER_COMPANY_CODE,:companyCode)=:companyCode) AND m.MESSAGE_ID>NVL((SELECT LAST_MESSAGE_ID FROM CUSTOMERS.SUPPORT_READ_RECEIPT r WHERE r.TICKET_ID=t.TICKET_ID AND r.LOGINID=:loginid AND r.TENANT_ID=:tenantId AND r.COMPANY_CODE=:companyCode),0)) UNREAD_COUNT
      FROM CUSTOMERS.SUPPORT_TICKET t WHERE ${where} ORDER BY t.LAST_MESSAGE_AT DESC,t.TICKET_ID DESC FETCH FIRST 2500 ROWS ONLY`, binds);
        });
    }

    static async getDeveloperTickets(u: any) {
        return this.getTickets(u, 'developer');
    }

    static async getMessages(ticketId: number, u: any, _role = 'user') {
        return withSupportDb(async (c) => {
            await ticketAccess(c, ticketId, u);
            const rows = await query(c, `SELECT MESSAGE_ID,TICKET_ID,SENDER_LOGINID,SENDER_NAME,SENDER_ROLE,SENDER_TENANT_ID,SENDER_COMPANY_CODE,MESSAGE_TEXT,IS_DELETED,${fmt('CREATED_AT')} CREATED_AT FROM CUSTOMERS.SUPPORT_MESSAGE WHERE TICKET_ID=:ticketId ORDER BY MESSAGE_ID`, { ticketId });
            const files = await query(c, `SELECT a.ATTACHMENT_ID,a.MESSAGE_ID,a.FILE_NAME,a.FILE_TYPE,a.FILE_SIZE FROM CUSTOMERS.SUPPORT_ATTACHMENT a JOIN CUSTOMERS.SUPPORT_MESSAGE m ON m.MESSAGE_ID=a.MESSAGE_ID AND m.TICKET_ID=a.TICKET_ID WHERE a.TICKET_ID=:ticketId AND NVL(m.IS_DELETED,'N')<>'Y'`, { ticketId });
            return rows.map(r => ({ ...r, attachments: files.filter(f => f.MESSAGE_ID === r.MESSAGE_ID) }));
        });
    }

    static async attachment(ticketId: number, attachmentId: number, u: any) {
        if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0)
            supportError('Invalid attachment number');
        const a = await withSupportDb(async (c) => {
            await ticketAccess(c, ticketId, u);
            const [row] = await query(c, `SELECT a.FILE_NAME,a.FILE_TYPE,a.DATA_URL,a.OBJECT_KEY FROM CUSTOMERS.SUPPORT_ATTACHMENT a JOIN CUSTOMERS.SUPPORT_MESSAGE m ON m.MESSAGE_ID=a.MESSAGE_ID AND m.TICKET_ID=a.TICKET_ID WHERE a.TICKET_ID=:ticketId AND a.ATTACHMENT_ID=:attachmentId AND NVL(m.IS_DELETED,'N')<>'Y'`, { ticketId, attachmentId });
            if (!row)
                supportError('Attachment not found', 404);
            return row;
        });
        if (a.DATA_URL) {
            const m = /^data:([^;]+);base64,(.*)$/s.exec(a.DATA_URL);
            if (!m)
                supportError('Attachment data is unavailable', 404);
            return { name: a.FILE_NAME, type: m[1], buffer: Buffer.from(m[2], 'base64') };
        }
        if (a.OBJECT_KEY) {
            try {
                const response = await fetch(await getSignedUrl(a.OBJECT_KEY, 300), { signal: AbortSignal.timeout(20000) });
                if (!response.ok)
                    supportError('Object storage could not return this attachment', 502);
                const chunks: Buffer[] = [];
                let size = 0;
                for await (const chunk of response.body as any) {
                    const bytes = Buffer.from(chunk);
                    size += bytes.length;
                    if (size > 15 * 1024 * 1024)
                        supportError('Legacy attachment exceeds the download limit', 413);
                    chunks.push(bytes);
                }
                return { name: a.FILE_NAME, type: a.FILE_TYPE || 'application/octet-stream', buffer: Buffer.concat(chunks) };
            }
            catch (e: any) {
                if (e.status)
                    throw e;
                supportError('The older attachment store cannot be reached. Please retry or ask support to restore access.', 502);
            }
        }
        supportError('Attachment data is unavailable', 404);
    }

    static async createTicket(input: any, u: any) {
        const id = identity(u), message = text(input.message, 8000), subject = text(input.subject, 300), files = attachments(input.attachments);
        if (!subject || !message)
            supportError('Issue subject and comments are required');
        const result = await withSupportDb(async (c) => {
            const requesterName = await resolveRequesterName(c, u);
            const r = await c.execute(`INSERT INTO CUSTOMERS.SUPPORT_TICKET(COMPANY_CODE,TENANT_ID,REQUESTER_LOGINID,REQUESTER_NAME,SUBJECT,MODULE_NAME,PAGE_URL,STATUS,PRIORITY,WORKFLOW_VERSION,CREATED_AT,UPDATED_AT) VALUES(:company,:tenant,:loginid,:name,:subject,:module,:page,'OPEN','NORMAL',1,${NOW},${NOW}) RETURNING TICKET_ID INTO :id`, { company: id.companyCode, tenant: id.tenantId, loginid: id.loginid, name: text(requesterName, 400), subject, module: text(input.module, 100), page: text(input.page_url, 500), id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } });
            const ticketId = Number((r.outBinds as any).id[0]);
            const messageId = await insertMessage(c, ticketId, u, message, 'USER', files);
            await audit(c, ticketId, u, 'CREATED', subject);

            const emailHtml = buildSupportEmailHtml({
                title: `New Support Ticket #${ticketId}`,
                ticketId,
                subject,
                requesterName,
                requesterLogin: id.loginid,
                companyCode: id.companyCode,
                tenantId: id.tenantId,
                moduleName: text(input.module, 100),
                pageUrl: text(input.page_url, 500),
                status: 'OPEN',
                priority: 'NORMAL',
                message
            });

            await queueSupportEmail(
                c,
                ticketId,
                `created:${ticketId}`,
                await admins(c),
                `New support ticket #${ticketId}: ${subject}`,
                emailHtml
            );
            return { ticketId, messageId };
        }, true);
        await changed(result.ticketId, u);
        return result;
    }

    static async addMessage(ticketId: number, input: any, u: any, _role = 'user') {
        const message = text(input.message, 8000), files = attachments(input.attachments);
        if (!message && !files.length)
            supportError('Enter a reply or attach a file');
        const r = await withSupportDb(async (c) => {
            const a = await ticketAccess(c, ticketId, u, true);
            if (a.ticket.STATUS === 'CLOSED')
                supportError('Reopen this ticket with a reason before replying', 409);
            const messageId = await insertMessage(c, ticketId, u, message, a.role, files);
            await audit(c, ticketId, u, 'REPLIED', 'Reply added');
            return { ticketId, messageId };
        }, true);
        await changed(ticketId, u);
        return r;
    }

    static async updateTicket(ticketId: number, input: any, u: any, _role = 'user') {
        const status = text(input.status, 20).toUpperCase(), note = text(input.resolution || input.reason || input.note, 2000);
        await withSupportDb(async (c) => {
            const { ticket: t, role, owns } = await ticketAccess(c, ticketId, u, true);
            let event = '';

            if (status === 'RESOLVED') {
                if (role !== 'developer' && role !== 'admin')
                    supportError('Only the assigned developer or support admin can submit a resolution', 403);
                if (!['ASSIGNED', 'IN_PROGRESS', 'WAITING_INFO', 'OPEN'].includes(t.STATUS))
                    supportError('Ticket is not currently open or in progress', 409);
                event = 'RESOLVED';
            }
            else if (status === 'CLOSED') {
                if (role !== 'admin')
                    supportError('Only a support admin can close tickets', 403);
                // Support Admin can directly close any ticket
                event = 'CLOSED';
            }
            else if (status === 'REOPENED') {
                if (!(owns || role === 'admin'))
                    supportError('Only the requester or support admin can reopen', 403);
                if (!['CLOSED', 'RESOLVED'].includes(t.STATUS))
                    supportError('Only resolved or closed tickets can be reopened', 409);
                if (!note)
                    supportError('Explain why the issue is not resolved');
                event = 'REOPENED';
            }
            else {
                supportError('Use assignment or developer progress actions for this status');
            }

            await c.execute(`UPDATE CUSTOMERS.SUPPORT_TICKET SET STATUS=:status,RESOLUTION=NVL(:note, RESOLUTION),DEV_STATUS=CASE WHEN :status='RESOLVED' THEN 'DONE' WHEN :status='REOPENED' THEN 'ASSIGNED' ELSE DEV_STATUS END,RESOLVED_AT=CASE WHEN :status='RESOLVED' THEN ${NOW} ELSE RESOLVED_AT END,CLOSED_AT=CASE WHEN :status='CLOSED' THEN ${NOW} ELSE NULL END,WORKFLOW_VERSION=1,UPDATED_AT=${NOW} WHERE TICKET_ID=:ticketId`, { status, note: note || null, ticketId });
            await insertMessage(c, ticketId, u, `${event === 'RESOLVED' ? 'Resolution submitted for admin review' : event === 'CLOSED' ? 'Closed by support admin' : 'Reopened'}${note ? `: ${note}` : ''}`, 'SYSTEM');
            await audit(c, ticketId, u, event, note || event);

            const actorName = await resolveRequesterName(c, u);
            const emailHtml = buildSupportEmailHtml({
                title: `Support Ticket #${ticketId} Update`,
                ticketId,
                subject: t.SUBJECT,
                requesterName: actorName,
                requesterLogin: identity(u).loginid,
                companyCode: t.COMPANY_CODE,
                tenantId: t.TENANT_ID,
                status,
                message: note || `Status updated to ${status}`,
                note: `Action taken by ${actorName} (${identity(u).loginid})`
            });

            await queueSupportEmail(
                c,
                ticketId,
                `${event}:${ticketId}:${Date.now()}`,
                await admins(c),
                `Support #${ticketId} ${event.toLowerCase()}: ${t.SUBJECT}`,
                emailHtml
            );
        }, true);
        await changed(ticketId, u);
        return { ticketId, status };
    }

    static async getDevelopers(u: any) {
        return withSupportDb(async (c) => {
            if (await supportRole(c, u) !== 'admin')
                supportError('Support admin access required', 403);
            return nativeSupportDevelopers(c);
        });
    }

    static async getCandidateDevelopers(u: any) {
        return withSupportDb(async (c) => {
            if (await supportRole(c, u) !== 'admin')
                supportError('Support admin access required', 403);
            const rows = await query(c, `
                SELECT s.LOGINID, s.USERNAME, s.EMAIL_ID, s.COMPANY_CODE,
                       d.ACTIVE_FLAG AS DEV_ACTIVE_FLAG,
                       d.LOGINID AS REGISTERED_DEV
                FROM CUSTOMERS.SEC_LOGINTEST s
                LEFT JOIN CUSTOMERS.SUPPORT_DEVELOPER d ON UPPER(d.LOGINID) = UPPER(s.LOGINID)
                WHERE UPPER(s.LOGINID) LIKE 'BI%'
                ORDER BY s.USERNAME ASC
            `);
            return rows.map(r => ({
                loginid: String(r.LOGINID).trim(),
                username: String(r.USERNAME || r.LOGINID).trim(),
                email_id: String(r.EMAIL_ID || `${String(r.LOGINID).toLowerCase()}@bayanattechnology.com`).trim(),
                company_code: String(r.COMPANY_CODE || 'BSG').trim(),
                is_registered: !!r.REGISTERED_DEV,
                is_active: r.DEV_ACTIVE_FLAG === 'Y'
            }));
        });
    }

    static async sendReminder(ticketId: number, u: any) {
        const result = await withSupportDb(async (c) => {
            if (await supportRole(c, u) !== 'admin')
                supportError('Support admin access required', 403);
            const [t] = await query(c, "SELECT TICKET_ID, SUBJECT, DEVELOPER_LOGINID, DEVELOPER_NAME, DEVELOPER_EMAIL, STATUS, PRIORITY, DUE_AT FROM CUSTOMERS.SUPPORT_TICKET WHERE TICKET_ID=:ticketId", { ticketId });
            if (!t) supportError('Ticket not found', 404);
            if (!t.DEVELOPER_LOGINID) supportError('No developer assigned to this ticket', 400);

            const reminderMsg = `🔔 ADMIN REMINDER: Please prioritize progress on Ticket #${ticketId} ("${t.SUBJECT}"). Timely update or resolution is requested.`;
            await insertMessage(c, ticketId, u, reminderMsg, 'SYSTEM');
            await audit(c, ticketId, u, 'REMINDER_SENT', `Admin sent reminder to assigned developer ${t.DEVELOPER_NAME || t.DEVELOPER_LOGINID}`);

            if (t.DEVELOPER_EMAIL) {
                const mailHtml = buildSupportEmailHtml({
                    title: `Reminder: Action Required on Ticket #${ticketId}`,
                    ticketId,
                    subject: `[REMINDER] ${t.SUBJECT}`,
                    requesterName: t.DEVELOPER_NAME || t.DEVELOPER_LOGINID,
                    requesterLogin: t.DEVELOPER_LOGINID,
                    companyCode: 'BSG',
                    tenantId: 'SUPPORT',
                    status: t.STATUS,
                    priority: t.PRIORITY,
                    message: reminderMsg
                });
                const adminEmails = await admins(c);
                const reminderTo = Array.from(new Set([t.DEVELOPER_EMAIL, ...adminEmails.split(',')].map(e => e.trim()).filter(Boolean))).join(',');

                await queueSupportEmail(
                    c,
                    ticketId,
                    `reminder:${ticketId}:${Date.now()}`,
                    reminderTo,
                    `Reminder: Action required on support ticket #${ticketId}`,
                    mailHtml
                );
            }
            return { sent: true, developer: t.DEVELOPER_NAME || t.DEVELOPER_LOGINID };
        }, true);
        await changed(ticketId, u);
        return result;
    }

    static async upsertDeveloper(input: any, u: any) {
        return withSupportDb(async (c) => {
            if (await supportRole(c, u) !== 'admin')
                supportError('Support admin access required', 403);
            const loginid = text(input.loginid, 100).toUpperCase();
            const activeFlag = input.active_flag === 'N' ? 'N' : 'Y';
            const inputName = text(input.username || input.name, 400);
            const inputEmail = text(input.email_id || input.email, 400);
            const skills = text(input.skill_tags || input.skills, 500);

            // Fetch user info if already in user master
            const rows = await query(c, `SELECT s.LOGINID, s.USERNAME, s.EMAIL_ID, s.COMPANY_CODE, m.TENANT_ID 
                FROM CUSTOMERS.SEC_LOGINTEST s 
                LEFT JOIN CUSTOMERS.USER_TENANT_MAPPING m ON UPPER(m.LOGINID)=UPPER(s.LOGINID) AND m.IS_DEFAULT='Y' 
                WHERE UPPER(s.LOGINID)=:loginid`, { loginid });

            const d = rows[0] || {};
            const devName = inputName || d.USERNAME || loginid;
            const devEmail = inputEmail || d.EMAIL_ID || `${loginid.toLowerCase()}@bayanattechnology.com`;
            const devCompany = text(input.company_code, 20) || d.COMPANY_CODE || 'BSG';
            const devTenant = text(input.tenant_id, 80) || d.TENANT_ID || 'BTIND_TENANT';

            // 1. Root Schema: CUSTOMERS.SEC_LOGINTEST
            // If developer already exists, only synchronize active status; do NOT re-insert or overwrite their profile data
            try {
                const userExists = await query(c, `SELECT 1 AS FOUND FROM CUSTOMERS.SEC_LOGINTEST WHERE UPPER(LOGINID)=UPPER(:loginid)`, { loginid });
                if (userExists.length > 0) {
                    await c.execute(
                        `UPDATE CUSTOMERS.SEC_LOGINTEST
                         SET ACTIVE_FLAG = :activeFlag
                         WHERE UPPER(LOGINID) = UPPER(:loginid)`,
                        { loginid, activeFlag }
                    );
                }
            } catch (secErr: any) {
                console.warn('[Support] SEC_LOGINTEST sync notice:', secErr?.message || secErr);
            }

            // 2. Root Schema: CUSTOMERS.USER_TENANT_MAPPING
            try {
                const mapExists = await query(c, `SELECT 1 AS FOUND FROM CUSTOMERS.USER_TENANT_MAPPING WHERE UPPER(LOGINID)=UPPER(:loginid) AND TENANT_ID=:tenant`, { loginid, tenant: devTenant });
                if (mapExists.length === 0) {
                    await c.execute(
                        `INSERT INTO CUSTOMERS.USER_TENANT_MAPPING (LOGINID, TENANT_ID, IS_DEFAULT)
                         VALUES (:loginid, :tenant, 'Y')`,
                        { loginid, tenant: devTenant }
                    );
                }
            } catch (mapErr: any) {
                console.warn('[Support] USER_TENANT_MAPPING sync notice:', mapErr?.message || mapErr);
            }

            // 3. Root Schema: CUSTOMERS.SUPPORT_DEVELOPER
            try {
                const devExists = await query(c, `SELECT 1 AS FOUND FROM CUSTOMERS.SUPPORT_DEVELOPER WHERE UPPER(LOGINID)=UPPER(:loginid)`, { loginid });
                if (devExists.length > 0) {
                    await c.execute(
                        `UPDATE CUSTOMERS.SUPPORT_DEVELOPER
                         SET USERNAME = :name,
                             EMAIL_ID = :email,
                             COMPANY_CODE = :company,
                             SKILL_TAGS = :skills,
                             ACTIVE_FLAG = :active,
                             UPDATED_AT = ${NOW}
                         WHERE UPPER(LOGINID) = UPPER(:loginid)`,
                        { loginid, name: devName, email: devEmail, company: devCompany, skills: skills || 'All Modules', active: activeFlag }
                    );
                } else {
                    await c.execute(
                        `INSERT INTO CUSTOMERS.SUPPORT_DEVELOPER (LOGINID, USERNAME, EMAIL_ID, COMPANY_CODE, SKILL_TAGS, ACTIVE_FLAG, CREATED_BY)
                         VALUES (:loginid, :name, :email, :company, :skills, :active, :actor)`,
                        { loginid, name: devName, email: devEmail, company: devCompany, skills: skills || 'All Modules', active: activeFlag, actor: identity(u).loginid }
                    );
                }
            } catch (devErr: any) {
                console.error('[Support] SUPPORT_DEVELOPER error:', devErr?.message || devErr);
                throw devErr;
            }

            // 4. Root Schema: CUSTOMERS.SUPPORT_MEMBER
            try {
                const memExists = await query(c,
                    `SELECT 1 AS FOUND FROM CUSTOMERS.SUPPORT_MEMBER WHERE UPPER(LOGINID)=UPPER(:loginid) AND TENANT_ID=:tenant AND COMPANY_CODE=:company`,
                    { loginid, tenant: devTenant, company: devCompany }
                );
                if (memExists.length > 0) {
                    await c.execute(
                        `UPDATE CUSTOMERS.SUPPORT_MEMBER SET ACTIVE_FLAG=:active WHERE UPPER(LOGINID)=UPPER(:loginid) AND TENANT_ID=:tenant AND COMPANY_CODE=:company`,
                        { loginid, tenant: devTenant, company: devCompany, active: activeFlag }
                    );
                } else {
                    await c.execute(
                        `INSERT INTO CUSTOMERS.SUPPORT_MEMBER (LOGINID, TENANT_ID, COMPANY_CODE, SUPPORT_ROLE, ACTIVE_FLAG, CREATED_BY)
                         VALUES (:loginid, :tenant, :company, 'DEVELOPER', :active, :actor)`,
                        { loginid, tenant: devTenant, company: devCompany, active: activeFlag, actor: identity(u).loginid }
                    );
                }
            } catch (memErr: any) {
                console.warn('[Support] SUPPORT_MEMBER sync warning:', memErr?.message || memErr);
            }

            // 5. Tenant Schemas Synchronization (BTIND, WMSDEV, and active tenant schemas)
            try {
                const regSchemas = await query(c, "SELECT DISTINCT UPPER(SCHEMA_NAME) AS SCHEMA_NAME FROM CUSTOMERS.TENANT_REGISTRY WHERE IS_ACTIVE='Y' AND SCHEMA_NAME IS NOT NULL");
                const schemaList = Array.from(new Set(['BTIND', 'WMSDEV', ...regSchemas.map(r => r.SCHEMA_NAME)]));

                for (const sch of schemaList) {
                    if (!/^[A-Z0-9_]+$/.test(sch)) continue;
                    try {
                        // 5a. Ensure developer exists in tenant schema SEC_LOGIN
                        // If already available, do NOT insert; if missing, copy full record from root SEC_LOGINTEST
                        try {
                            const [tenantUser] = await query(c,
                                `SELECT 1 FROM ${sch}.SEC_LOGIN WHERE UPPER(LOGINID) = UPPER(:loginid) OR UPPER(USER_CODE) = UPPER(:loginid) OR UPPER(USER_ID) = UPPER(:loginid)`,
                                { loginid }
                            );

                            if (tenantUser) {
                                // Already available - do not insert, only synchronize active status
                                await c.execute(
                                    `UPDATE ${sch}.SEC_LOGIN SET ACTIVE_FLAG = :flag WHERE UPPER(LOGINID) = UPPER(:loginid) OR UPPER(USER_CODE) = UPPER(:loginid) OR UPPER(USER_ID) = UPPER(:loginid)`,
                                    { flag: activeFlag, loginid }
                                );
                            } else {
                                // Missing in tenant schema - copy full user information from root CUSTOMERS.SEC_LOGINTEST
                                const [rootInfo] = await query(c,
                                    `SELECT * FROM CUSTOMERS.SEC_LOGINTEST WHERE UPPER(LOGINID) = UPPER(:loginid)`,
                                    { loginid }
                                );
                                const comp = rootInfo?.COMPANY_CODE || devCompany || 'BSG';
                                const uname = rootInfo?.USERNAME || devName;
                                const uemail = rootInfo?.EMAIL_ID || devEmail;
                                const upass = rootInfo?.USERPASS || rootInfo?.PASSWORD || 'welcome123';
                                const secPass = rootInfo?.SEC_PASSWD || upass;

                                await c.execute(
                                    `INSERT INTO ${sch}.SEC_LOGIN (
                                        COMPANY_CODE, LOGINID, USERID, LOGINID1, USERNAME, EMAIL_ID,
                                        USERPASS, SEC_PASSWD, PASSWORD, ACTIVE_FLAG, CREATED_BY, CREATED_AT,
                                        APPLICATION, USER_CODE, USER_ID, LANG_PREF
                                    ) VALUES (
                                        :comp, UPPER(:loginid), UPPER(:loginid), UPPER(:loginid), :uname, :uemail,
                                        :upass, :secPass, :upass, :flag, 'SYSTEM_SETUP', SYSTIMESTAMP,
                                        'Support', UPPER(:loginid), UPPER(:loginid), 'en'
                                    )`,
                                    { comp, loginid, uname, uemail, upass, secPass, flag: activeFlag }
                                );
                            }
                        } catch (secLoginErr: any) {
                            console.warn(`[Support] Schema ${sch}.SEC_LOGIN sync notice:`, secLoginErr?.message || secLoginErr);
                        }

                        // 5b. Ensure module entry and role function access in tenant schema
                        const [modRow] = await query(c, `SELECT SERIAL_NO FROM ${sch}.SEC_MODULE_DATA WHERE URL_PATH='support/assigned'`);
                        let modSerial = modRow?.SERIAL_NO;
                        if (!modSerial) {
                            const [maxRow] = await query(c, `SELECT NVL(MAX(SERIAL_NO), 980) + 1 AS MAX_ID FROM ${sch}.SEC_MODULE_DATA`);
                            modSerial = maxRow?.MAX_ID || 981;
                            await c.execute(
                                `INSERT INTO ${sch}.SEC_MODULE_DATA (SERIAL_NO, LEVEL1, LEVEL2, POSITION, RIGHTS, TERMINATOR, URL_PATH, APP_CODE, COMPANY_CODE, CREATE_USER, CREATE_DATE)
                                 VALUES (:modSerial, 'Developer desk', 'My assignments', 1, 'Y', 'Y', 'support/assigned', 'Support', :company, 'SYSTEM_SETUP', SYSDATE)`,
                                { modSerial, company: devCompany }
                            );
                        }

                        const flag = activeFlag; // 'Y' when active, 'N' when inactive
                        const accessExists = await query(c,
                            `SELECT 1 FROM ${sch}.SEC_ROLE_FUNCTION_ACCESS_USER WHERE UPPER(LOGINID)=UPPER(:loginid) AND SERIAL_NO_OR_ROLE_ID=:serialNo AND COMPANY_CODE=:company`,
                            { loginid, serialNo: modSerial, company: devCompany }
                        );

                        if (accessExists.length > 0) {
                            await c.execute(
                                `UPDATE ${sch}.SEC_ROLE_FUNCTION_ACCESS_USER
                                 SET SSEARCH=:flag, SSAVE=:flag, SMODIFY=:flag, SNEW=:flag, SDELETE=:flag, SHELP=:flag, SPRINT=:flag, USERID=:actor, USER_DT=SYSDATE
                                 WHERE UPPER(LOGINID)=UPPER(:loginid) AND SERIAL_NO_OR_ROLE_ID=:serialNo AND COMPANY_CODE=:company`,
                                { loginid, serialNo: modSerial, company: devCompany, flag, actor: identity(u).loginid }
                            );
                        } else {
                            await c.execute(
                                `INSERT INTO ${sch}.SEC_ROLE_FUNCTION_ACCESS_USER (COMPANY_CODE, LOGINID, SERIAL_NO_OR_ROLE_ID, SNEW, SMODIFY, SDELETE, SSAVE, SSEARCH, SSAVEAS, SUPLOAD, SUNDO, SPRINT, SPRINTSETUP, SHELP, USERID, CREATE_USER, CREATE_DATE)
                                 VALUES (:company, UPPER(:loginid), :serialNo, :flag, :flag, :flag, :flag, :flag, :flag, :flag, :flag, :flag, :flag, :flag, :actor, :actor, SYSDATE)`,
                                { company: devCompany, loginid, serialNo: modSerial, flag, actor: identity(u).loginid }
                            );
                        }
                    } catch (perSchErr: any) {
                        console.warn(`[Support] Schema ${sch} sync notice:`, perSchErr?.message || perSchErr);
                    }
                }
            } catch (schErr: any) {
                console.warn('[Support] Tenant schemas loop notice:', schErr?.message || schErr);
            }

            return { loginid, active_flag: activeFlag };
        }, true);
    }

    static async assignDeveloper(ticketId: number, input: any, u: any) {
        const developer = text(input.developer_loginid, 100).toUpperCase();
        const priority = text(input.priority, 20).toUpperCase();
        const minutes = Number(input.sla_minutes);

        if (!['LOW', 'NORMAL', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(priority))
            supportError('Select a valid priority');
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 43200)
            supportError('Estimated time must be 1 to 43200 minutes');

        await withSupportDb(async (c) => {
            const { ticket: t, role } = await ticketAccess(c, ticketId, u, true);
            if (role !== 'admin')
                supportError('Support admin access required', 403);
            if (['CLOSED', 'RESOLVED'].includes(t.STATUS))
                supportError('Reopen this ticket before assigning it', 409);

            const devs = await nativeSupportDevelopers(c);
            const d = devs.find(x => x.LOGINID === developer);
            if (!d)
                supportError('Select a valid support developer');
            if (d.ACTIVE_FLAG === 'N')
                supportError('This developer is disabled and cannot be assigned tickets', 400);

            const devEmail = d.EMAIL_ID || `${developer.toLowerCase()}@bayanattechnology.com`;
            const devName = d.USERNAME || developer;

            await c.execute(`UPDATE CUSTOMERS.SUPPORT_TICKET SET DEVELOPER_LOGINID=:developer,DEVELOPER_NAME=:name,DEVELOPER_EMAIL=:email,ASSIGNED_TO=:developer,ASSIGNED_BY=:actor,ASSIGNED_AT=${NOW},STATUS='ASSIGNED',DEV_STATUS='ASSIGNED',PRIORITY=:priority,SLA_MINUTES=:minutes,DUE_AT=${NOW}+(:minutes/1440),OVERDUE_NOTIFIED_AT=NULL,WORKFLOW_VERSION=1,UPDATED_AT=${NOW} WHERE TICKET_ID=:ticketId`, { developer, name: devName, email: devEmail, actor: identity(u).loginid, priority, minutes, ticketId });
            const note = `Assigned to ${devName}. Priority: ${priority}. Estimated time: ${minutes} minutes.${input.note ? ' ' + text(input.note, 1000) : ''}`;
            await insertMessage(c, ticketId, u, note, 'SYSTEM');
            await audit(c, ticketId, u, 'ASSIGNED', note);

            const emailHtml = buildSupportEmailHtml({
                title: `Support Ticket #${ticketId} Assigned`,
                ticketId,
                subject: t.SUBJECT,
                requesterName: devName,
                requesterLogin: developer,
                companyCode: t.COMPANY_CODE,
                tenantId: t.TENANT_ID,
                priority,
                status: 'ASSIGNED',
                message: note,
                note: `Assigned to ${devName}. Estimated time: ${minutes} minutes.`
            });

            const adminEmails = await admins(c);
            const allTo = Array.from(new Set([devEmail, ...adminEmails.split(',')].map(e => e.trim()).filter(Boolean))).join(',');

            await queueSupportEmail(
                c,
                ticketId,
                `assigned:${ticketId}:${Date.now()}`,
                allTo,
                `Support ticket #${ticketId} assigned - ${priority}: ${t.SUBJECT}`,
                emailHtml
            );
        }, true);

        await changed(ticketId, u);
        return { ticketId, emailQueued: true };
    }

    static async updateDeveloperStatus(ticketId: number, input: any, u: any) {
        const status = text(input.dev_status, 30);
        if (!['IN_PROGRESS', 'WAITING_INFO', 'RESOLVED', 'CLOSED'].includes(status))
            supportError('Select a valid developer progress status');
        await withSupportDb(async (c) => {
            const a = await ticketAccess(c, ticketId, u, true);
            if (a.role !== 'developer' && a.role !== 'admin')
                supportError('Only the assigned developer or admin may update progress', 403);

            const isDone = status === 'RESOLVED' || status === 'CLOSED';
            const targetStatus = isDone ? 'RESOLVED' : status;
            const targetDevStatus = isDone ? 'DONE' : status;

            await c.execute(`UPDATE CUSTOMERS.SUPPORT_TICKET SET STATUS=:targetStatus,DEV_STATUS=:targetDevStatus,UPDATED_AT=${NOW} WHERE TICKET_ID=:ticketId`, { targetStatus, targetDevStatus, ticketId });
            await audit(c, ticketId, u, targetDevStatus, `Developer status updated to ${targetDevStatus}`);
        }, true);
        await changed(ticketId, u);
        return { ticketId, status };
    }

    static async markRead(ticketId: number, u: any, input: any = {}) {
        return withSupportDb(async (c) => {
            await ticketAccess(c, ticketId, u);
            const id = identity(u);
            const [max] = await query(c, 'SELECT NVL(MAX(MESSAGE_ID),0) MID FROM CUSTOMERS.SUPPORT_MESSAGE WHERE TICKET_ID=:ticketId', { ticketId });
            const requested = Number(input.last_message_id);
            const mid = Number.isSafeInteger(requested) && requested >= 0 ? Math.min(requested, max.MID) : max.MID;
            await c.execute(`MERGE INTO CUSTOMERS.SUPPORT_READ_RECEIPT d USING(SELECT :ticketId TICKET_ID,:loginid LOGINID,:tenantId TENANT_ID,:companyCode COMPANY_CODE FROM dual)s ON(d.TICKET_ID=s.TICKET_ID AND d.LOGINID=s.LOGINID AND d.TENANT_ID=s.TENANT_ID AND d.COMPANY_CODE=s.COMPANY_CODE) WHEN MATCHED THEN UPDATE SET LAST_MESSAGE_ID=GREATEST(d.LAST_MESSAGE_ID,:mid) WHEN NOT MATCHED THEN INSERT(TICKET_ID,LOGINID,TENANT_ID,COMPANY_CODE,LAST_MESSAGE_ID) VALUES(:ticketId,:loginid,:tenantId,:companyCode,:mid)`, { ticketId, ...id, mid });
            return { ticketId };
        }, true);
    }

    static async deleteMessage(ticketId: number, messageId: number, u: any) {
        await withSupportDb(async (c) => {
            await ticketAccess(c, ticketId, u, true);
            const id = identity(u);
            const [m] = await query(c, 'SELECT * FROM CUSTOMERS.SUPPORT_MESSAGE WHERE TICKET_ID=:ticketId AND MESSAGE_ID=:messageId', { ticketId, messageId });
            if (!m)
                supportError('Message not found', 404);
            if (m.SENDER_ROLE === 'SYSTEM' || m.SENDER_LOGINID.toUpperCase() !== id.loginid || m.SENDER_TENANT_ID !== id.tenantId || m.SENDER_COMPANY_CODE !== id.companyCode)
                supportError('You may delete only your own messages', 403);
            await c.execute(`UPDATE CUSTOMERS.SUPPORT_MESSAGE SET MESSAGE_TEXT='This message was deleted',IS_DELETED='Y',DELETED_BY=:loginid,DELETED_AT=${NOW},HAS_ATTACHMENTS='N' WHERE MESSAGE_ID=:messageId`, { loginid: id.loginid, messageId });
            await c.execute(`UPDATE CUSTOMERS.SUPPORT_TICKET SET LAST_MESSAGE=(SELECT DBMS_LOB.SUBSTR(MESSAGE_TEXT,1000,1) FROM CUSTOMERS.SUPPORT_MESSAGE WHERE TICKET_ID=:ticketId ORDER BY MESSAGE_ID DESC FETCH FIRST 1 ROW ONLY) WHERE TICKET_ID=:ticketId`, { ticketId });
            await audit(c, ticketId, u, 'MESSAGE_DELETED', `Message ${messageId}`);
        }, true);
        await changed(ticketId, u);
        return { ticketId, messageId, deleted: true };
    }

    static async events(ticketId: number, u: any) {
        return withSupportDb(async (c) => {
            await ticketAccess(c, ticketId, u);
            return query(c, `SELECT EVENT_ID,ACTOR_LOGINID,EVENT_TYPE,EVENT_TEXT,${fmt('CREATED_AT')} CREATED_AT FROM CUSTOMERS.SUPPORT_EVENT WHERE TICKET_ID=:ticketId ORDER BY EVENT_ID`, { ticketId });
        });
    }

    static async settings(u: any) {
        return withSupportDb(async (c) => {
            if (await supportRole(c, u) !== 'admin')
                supportError('Support admin access required', 403);
            const contacts = await query(c, "SELECT EMAIL_ID, DISPLAY_NAME, ACTIVE_FLAG, NVL(RECIPIENT_TYPE, 'CC') AS RECIPIENT_TYPE FROM CUSTOMERS.SUPPORT_CONTACT ORDER BY DISPLAY_NAME");
            const queue = await query(c, `SELECT EMAIL_ID,TICKET_ID,RECIPIENTS,SUBJECT,STATUS,ATTEMPTS,LAST_ERROR,${fmt('SENT_AT')} SENT_AT FROM CUSTOMERS.SUPPORT_EMAIL_OUTBOX ORDER BY EMAIL_ID DESC FETCH FIRST 50 ROWS ONLY`);
            return { contacts, queue };
        });
    }

    static async saveContact(input: any, u: any) {
        return withSupportDb(async (c) => {
            if (await supportRole(c, u) !== 'admin')
                supportError('Support admin access required', 403);
            const e = email(input.email_id);
            if (!e)
                supportError('Email is required');
            const rType = (input.recipient_type || 'CC').toUpperCase() === 'TO' ? 'TO' : 'CC';
            await c.execute(
                `MERGE INTO CUSTOMERS.SUPPORT_CONTACT d USING(SELECT :e EMAIL_ID FROM dual)s ON(d.EMAIL_ID=s.EMAIL_ID)
                 WHEN MATCHED THEN UPDATE SET DISPLAY_NAME=:name,ACTIVE_FLAG=:active,RECIPIENT_TYPE=:rType
                 WHEN NOT MATCHED THEN INSERT(EMAIL_ID,DISPLAY_NAME,ACTIVE_FLAG,RECIPIENT_TYPE) VALUES(:e,:name,:active,:rType)`,
                { e, name: text(input.display_name, 200), active: input.active_flag === 'N' ? 'N' : 'Y', rType }
            );
            return { email_id: e, recipient_type: rType };
        }, true);
    }

    static async getLiveChat(sessionKey: string, u: any) {
        return withSupportDb(async (c) => {
            const id = identity(u);
            const sess = text(sessionKey, 100);
            return query(c, `SELECT CHAT_ID, SESSION_KEY, LOGINID, USERNAME, SENDER_ROLE, MESSAGE_TEXT, ${fmt('CREATED_AT')} CREATED_AT 
                FROM CUSTOMERS.SUPPORT_LIVE_CHAT 
                WHERE SESSION_KEY = :sess AND UPPER(LOGINID) = :loginid 
                ORDER BY CHAT_ID`, { sess, loginid: id.loginid });
        });
    }

    static async sendLiveChat(sessionKey: string, messageText: string, pageUrl: string, u: any) {
        const id = identity(u);
        const sess = text(sessionKey, 100);
        const msg = text(messageText, 4000);
        const page = text(pageUrl, 500);

        return withSupportDb(async (c) => {
            const reqName = await resolveRequesterName(c, u);
            await c.execute(
                `INSERT INTO CUSTOMERS.SUPPORT_LIVE_CHAT (SESSION_KEY, LOGINID, USERNAME, TENANT_ID, COMPANY_CODE, PAGE_URL, SENDER_ROLE, MESSAGE_TEXT, CREATED_AT)
                 VALUES (:sess, :loginid, :name, :tenant, :company, :page, 'USER', :msg, ${NOW})`,
                { sess, loginid: id.loginid, name: reqName, tenant: id.tenantId, company: id.companyCode, page, msg }
            );

            // Generate helpful smart bot assistance based on message content
            let botReply = '';
            const lower = msg.toLowerCase();
            if (lower.includes('invoice') || lower.includes('bill')) {
                botReply = 'To view or create invoices, navigate to BT-Finance > Transactions > Invoices. If you are experiencing a document save error, you can click "+ New Issue" in the Tickets tab to attach a screenshot directly to our support team.';
            } else if (lower.includes('password') || lower.includes('login') || lower.includes('access')) {
                botReply = 'For login or password resets, your tenant security administrator or DEVADMIN can reset your credentials in BT-Security > User Master.';
            } else if (lower.includes('report') || lower.includes('download') || lower.includes('export')) {
                botReply = 'Reports can be filtered by month and year and exported using the Download/Excel button at the top right of each report screen.';
            } else {
                botReply = `Hello ${reqName}! Thank you for reaching out to Bayanat Instant Support. We have logged your inquiry. For specific technical issues or bugs with screenshots, click "+ New Issue" in the Tickets tab to alert our development team.`;
            }

            await c.execute(
                `INSERT INTO CUSTOMERS.SUPPORT_LIVE_CHAT (SESSION_KEY, LOGINID, USERNAME, TENANT_ID, COMPANY_CODE, PAGE_URL, SENDER_ROLE, MESSAGE_TEXT, CREATED_AT)
                 VALUES (:sess, :loginid, 'Bayanat Assistant', :tenant, :company, :page, 'ASSISTANT', :botReply, ${NOW})`,
                { sess, loginid: id.loginid, tenant: id.tenantId, company: id.companyCode, page, botReply }
            );

            return { success: true };
        }, true);
    }
}
