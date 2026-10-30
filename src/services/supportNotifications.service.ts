const nodemailer = require('nodemailer');
import { query, withSupportDb, supportEvents } from './supportDb';
import { queueSupportEmail } from './supportChat.service';
const NOW = 'CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS DATE)';
let running = false;
export async function processSupportNotifications(sendMail?: (mail: any) => Promise<any>) {
    if (running)
        return;
    running = true;
    try {
        await withSupportDb(async (c) => {
            const due = await query(c, `SELECT TICKET_ID,SUBJECT,DEVELOPER_EMAIL,DUE_AT FROM CUSTOMERS.SUPPORT_TICKET WHERE WORKFLOW_VERSION=1 AND STATUS NOT IN('CLOSED','RESOLVED') AND DUE_AT<${NOW} AND OVERDUE_NOTIFIED_AT IS NULL FOR UPDATE SKIP LOCKED`);
            const contacts = (await query(c, "SELECT EMAIL_ID FROM CUSTOMERS.SUPPORT_CONTACT WHERE ACTIVE_FLAG='Y'")).map(r => r.EMAIL_ID);
            for (const t of due) {
                await queueSupportEmail(c, t.TICKET_ID, `overdue:${t.TICKET_ID}:${new Date(t.DUE_AT).getTime()}`, [...new Set([...contacts, t.DEVELOPER_EMAIL].filter(Boolean))].join(','), `Overdue support ticket #${t.TICKET_ID}`, `${t.SUBJECT}\nThe estimated completion time has passed. Please update progress or contact support to revise the estimate.`);
                await c.execute(`UPDATE CUSTOMERS.SUPPORT_TICKET SET OVERDUE_NOTIFIED_AT=${NOW} WHERE TICKET_ID=:id`, { id: t.TICKET_ID });
            }
        }, true);
        const enabled = process.env.SUPPORT_EMAIL_ENABLED !== 'false';
        const username = process.env.SUPPORT_SMTP_USER || process.env.EMAIL_USER, password = process.env.SUPPORT_SMTP_PASSWORD || process.env.EMAIL_PASS;
        if (!sendMail && (!enabled || !username || !password))
            return; // Queue remains visible; never claim delivery.
        const transport = !sendMail ? nodemailer.createTransport({ host: process.env.SUPPORT_SMTP_HOST || 'smtp.office365.com', port: Number(process.env.SUPPORT_SMTP_PORT || 587), secure: process.env.SUPPORT_SMTP_SECURE === 'true', auth: { user: username, pass: password }, connectionTimeout: 10000, socketTimeout: 20000 }) : undefined;
        for (let n = 0; n < 10; n++) {
            const job = await withSupportDb(async (c) => {
                await c.execute(`UPDATE CUSTOMERS.SUPPORT_EMAIL_OUTBOX SET STATUS='PENDING' WHERE STATUS='PROCESSING' AND AVAILABLE_AT<${NOW}-(10/1440)`);
                const rows = await query(c, `SELECT EMAIL_ID,RECIPIENTS,SUBJECT,BODY,ATTEMPTS FROM CUSTOMERS.SUPPORT_EMAIL_OUTBOX WHERE STATUS IN('PENDING','RETRY') AND AVAILABLE_AT<=${NOW} AND ATTEMPTS<5 ORDER BY EMAIL_ID FOR UPDATE SKIP LOCKED`);
                const r = rows[0];
                if (!r)
                    return;
                await c.execute(`UPDATE CUSTOMERS.SUPPORT_EMAIL_OUTBOX SET STATUS='PROCESSING',ATTEMPTS=ATTEMPTS+1,AVAILABLE_AT=${NOW} WHERE EMAIL_ID=:id`, { id: r.EMAIL_ID });
                return r;
            }, true);
            if (!job)
                break;
            try {
                await (sendMail || ((m: any) => transport!.sendMail(m)))({ from: process.env.SUPPORT_MAIL_FROM || username, to: job.RECIPIENTS, subject: job.SUBJECT, text: job.BODY });
                await withSupportDb(async (c) => { await c.execute(`UPDATE CUSTOMERS.SUPPORT_EMAIL_OUTBOX SET STATUS='SENT',SENT_AT=${NOW},LAST_ERROR=NULL WHERE EMAIL_ID=:id`, { id: job.EMAIL_ID }); }, true);
            }
            catch (e: any) {
                await withSupportDb(async (c) => { await c.execute(`UPDATE CUSTOMERS.SUPPORT_EMAIL_OUTBOX SET STATUS=CASE WHEN ATTEMPTS>=5 THEN 'FAILED' ELSE 'RETRY' END,LAST_ERROR=:error,AVAILABLE_AT=${NOW}+(5/1440) WHERE EMAIL_ID=:id`, { id: job.EMAIL_ID, error: String(e.message || 'Delivery failed').slice(0, 1000) }); }, true);
            }
        }
        transport?.close();
    }
    finally {
        running = false;
    }
}
export function startSupportNotificationScheduler() {
    if (process.env.SCHEDULER_ENABLED === 'false')
        return;
    let queued: NodeJS.Timeout | undefined;
    const run = () => void processSupportNotifications().catch(() => console.error('Support notification worker failed'));
    supportEvents.on('changed', () => { if (queued)
        return; queued = setTimeout(() => { queued = undefined; run(); }, 250); queued.unref(); });
    const timer = setInterval(run, 60000);
    timer.unref();
}
