const nodemailer = require('nodemailer');
import { query, withSupportDb, supportEvents } from './supportDb';
import { queueSupportEmail } from './supportChat.service';
import { buildSupportEmailHtml } from './supportEmailTemplate';

const NOW = 'CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS DATE)';
let running = false;

export async function processSupportNotifications(sendMail?: (mail: any) => Promise<any>) {
    if (running)
        return;
    running = true;
    try {
        await withSupportDb(async (c) => {
            const due = await query(c, `SELECT TICKET_ID,COMPANY_CODE,TENANT_ID,SUBJECT,DEVELOPER_EMAIL,DEVELOPER_NAME,DUE_AT FROM CUSTOMERS.SUPPORT_TICKET WHERE WORKFLOW_VERSION=1 AND STATUS NOT IN('CLOSED','RESOLVED') AND DUE_AT<${NOW} AND OVERDUE_NOTIFIED_AT IS NULL FOR UPDATE SKIP LOCKED`);
            const contacts = (await query(c, "SELECT EMAIL_ID FROM CUSTOMERS.SUPPORT_CONTACT WHERE ACTIVE_FLAG='Y'")).map(r => r.EMAIL_ID);
            for (const t of due) {
                const emailHtml = buildSupportEmailHtml({
                    title: `Overdue Support Ticket #${t.TICKET_ID}`,
                    ticketId: t.TICKET_ID,
                    subject: t.SUBJECT,
                    requesterName: t.DEVELOPER_NAME || 'Assigned Developer',
                    requesterLogin: t.DEVELOPER_EMAIL || 'DEVELOPER',
                    companyCode: t.COMPANY_CODE || 'General',
                    tenantId: t.TENANT_ID || 'General',
                    status: 'OVERDUE',
                    priority: 'HIGH',
                    message: `The estimated completion time for this ticket has passed.\nPlease update progress or contact support to revise the estimate.`,
                    note: 'Automated SLA overdue alert'
                });
                await queueSupportEmail(
                    c,
                    t.TICKET_ID,
                    `overdue:${t.TICKET_ID}:${new Date(t.DUE_AT).getTime()}`,
                    [...new Set([...contacts, t.DEVELOPER_EMAIL].filter(Boolean))].join(','),
                    `Overdue support ticket #${t.TICKET_ID}: ${t.SUBJECT}`,
                    emailHtml
                );
                await c.execute(`UPDATE CUSTOMERS.SUPPORT_TICKET SET OVERDUE_NOTIFIED_AT=${NOW} WHERE TICKET_ID=:id`, { id: t.TICKET_ID });
            }
        }, true);

        const enabled = process.env.SUPPORT_EMAIL_ENABLED !== 'false';
        const username = process.env.SUPPORT_SMTP_USER || process.env.EMAIL_USER;
        const password = process.env.SUPPORT_SMTP_PASSWORD || process.env.EMAIL_PASS;
        if (!sendMail && (!enabled || !username || !password))
            return; // Queue remains visible; never claim delivery.

        const transport = !sendMail
            ? nodemailer.createTransport({
                  host: process.env.SUPPORT_SMTP_HOST || 'smtp.office365.com',
                  port: Number(process.env.SUPPORT_SMTP_PORT || 587),
                  secure: process.env.SUPPORT_SMTP_SECURE === 'true',
                  auth: { user: username, pass: password },
                  connectionTimeout: 10000,
                  socketTimeout: 20000,
              })
            : undefined;

        const defaultCc = process.env.SUPPORT_EMAIL_CC || 'prem@bayanattechnology.com';

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
                const rawBody = String(job.BODY || '');
                const isHtml = rawBody.includes('<html') || rawBody.includes('<table') || rawBody.includes('<div');

                // Filter out defaultCc from TO so Prem is never duplicated in both TO and CC
                const toList = (job.RECIPIENTS || '')
                    .split(',')
                    .map((e: string) => e.trim())
                    .filter((e: string) => e && e.toLowerCase() !== defaultCc.toLowerCase());
                const finalTo = toList.length > 0 ? toList.join(', ') : (job.RECIPIENTS || defaultCc);

                const mailOptions: any = {
                    from: process.env.SUPPORT_MAIL_FROM || username,
                    to: finalTo,
                    cc: defaultCc,
                    subject: job.SUBJECT,
                };
                if (isHtml) {
                    mailOptions.html = rawBody;
                    mailOptions.text = rawBody
                        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s{2,}/g, ' ')
                        .trim();
                } else {
                    mailOptions.text = rawBody;
                }

                await (sendMail || ((m: any) => transport!.sendMail(m)))(mailOptions);
                await withSupportDb(async (c) => {
                    await c.execute(`UPDATE CUSTOMERS.SUPPORT_EMAIL_OUTBOX SET STATUS='SENT',SENT_AT=${NOW},LAST_ERROR=NULL WHERE EMAIL_ID=:id`, { id: job.EMAIL_ID });
                }, true);
            }
            catch (e: any) {
                await withSupportDb(async (c) => {
                    await c.execute(`UPDATE CUSTOMERS.SUPPORT_EMAIL_OUTBOX SET STATUS=CASE WHEN ATTEMPTS>=5 THEN 'FAILED' ELSE 'RETRY' END,LAST_ERROR=:error,AVAILABLE_AT=${NOW}+(5/1440) WHERE EMAIL_ID=:id`, { id: job.EMAIL_ID, error: String(e.message || 'Delivery failed').slice(0, 1000) });
                }, true);
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
    supportEvents.on('changed', () => {
        if (queued)
            return;
        queued = setTimeout(() => {
            queued = undefined;
            run();
        }, 250);
        queued.unref();
    });
    const timer = setInterval(run, 60000);
    timer.unref();
}
