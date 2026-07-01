import cron from "node-cron";
import logger from "../utils/logger";
import TenantManager from "../database/TenantManager";
import { notifyUser } from "../helpers/functions";
import constants from "../helpers/constants";
const SCHEDULE_EXPR = "*/2 * * * *"; 

async function sendEmail(row: any) {
  // Build an attractive, responsive HTML message and delegate sending
  const html = formatMailHtml(row.SUBJECT || "Notification", row.MAIL_BODY, row);

  await notifyUser({
    event: constants.EVENTS.TRANSACTION_COMPLETED,
    request_user: { company_code: row.COMPANY_CODE, loginid: "SYSTEM_SCHEDULER" },
    request_users: row.EMAIL_TO,
    cc: row.EMAIL_CC,
    subject: row.SUBJECT,
    htmlMessage: html,
    attachments: [],
  });
}

function escapeHtml(text: string) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatMailHtml(title: string, body: string, row: any) {
  const safeTitle = escapeHtml(title || "Notification");
  const safeBody = escapeHtml(body || "");
  const txn = row?.TXN_NO ? escapeHtml(row.TXN_NO) : "";
  const appUrl = "https://qa-app.bayanattechnology.com";

  return `
  <!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; margin:0; padding:0; background:#f4f6f8; }
      .container { max-width:600px; margin:20px auto; background:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08); }
      .header { background: linear-gradient(90deg,#0b69ff,#0066cc); color:#fff; padding:18px 20px; text-align:left; }
      .logo { font-weight:700; font-size:18px; }
      .title { margin:6px 0 0; font-size:16px; }
      .content { padding:20px; color:#333; line-height:1.5; font-size:15px; }
      .notice { background:#f1f8ff; border-left:4px solid #0b69ff; padding:12px; border-radius:4px; margin-bottom:12px; }
      .meta { color:#666; font-size:13px; margin-bottom:12px; }
      .cta { display:block; text-align:center; padding:14px 20px; margin:10px 20px 24px; background:#0b69ff; color:#fff; text-decoration:none; border-radius:6px; font-weight:600; }
      .footer { background:#fafafa; padding:12px 20px; color:#888; font-size:12px; text-align:center; }
      @media only screen and (max-width:480px) {
        .container { margin:8px; }
        .header { padding:14px; }
        .content { padding:14px; font-size:14px; }
        .cta { margin:8px 14px 18px; }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="logo">Bayanat Technology</div>
        <div class="title">${safeTitle}</div>
      </div>
      <div class="content">
        <div class="notice">
          <strong>Notification</strong>
        </div>
        <div class="meta">Transaction: ${txn}</div>
        <div>${safeBody.replace(/\n/g, '<br/>')}</div>

        <a href="${appUrl}" class="cta">Open Application</a>
      </div>
      <div class="footer">This is an automated message from Bayanat. Do not reply to this email.</div>
    </div>
  </body>
  </html>
  `;
}
export function startNotificationEmailScheduler() {
  logger.info("Starting Notification Email Scheduler...");

  cron.schedule(SCHEDULE_EXPR, async () => {
    logger.info("NotificationEmailScheduler triggered: checking NOTIFICATION_EMAIL_INFO...");

    try {
      const configured = process.env.NOTIFICATION_SCHEDULER_TENANTS
        ?.split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);

      const tenants = configured && configured.length > 0
        ? configured
        : await TenantManager.listActiveTenants();

      if (configured && configured.length > 0) {
        logger.info(`[NotificationEmailScheduler] Using configured tenant list: ${tenants.join(",")}`);
      }

      if (!tenants || tenants.length === 0) {
        logger.info("No active tenants found for NotificationEmailScheduler");
        return;
      }

      for (const tenantId of tenants) {
        try {
          await TenantManager.runForTenant(tenantId, async () => {
            const rows = await TenantManager.executeInTenant(tenantId, `SELECT COMPANY_CODE, TXN_NO, EMAIL_FROM, EMAIL_TO, EMAIL_CC, MAIL_BODY, SUBJECT, MAIL_ATTACH, ATTACH_FILENAME FROM NOTIFICATION_EMAIL_INFO WHERE EMAIL_SENT = 'N'`);

            if (!rows || rows.length === 0) {
              logger.info(`[${tenantId}] No unsent notification emails found`);
              return;
            }

            logger.info(`[${tenantId}] Found ${rows.length} unsent notification(s)`);

            for (const row of rows) {
                try {
                await sendEmail(row);
                logger.info(`[${tenantId}] Email sent for TXN_NO=${row.TXN_NO}`);

                // mark as sent
                const updateSql = `UPDATE NOTIFICATION_EMAIL_INFO SET EMAIL_SENT = 'Y' WHERE COMPANY_CODE = :company AND TXN_NO = :txn`;
                await TenantManager.executeInTenant(tenantId, updateSql, { company: row.COMPANY_CODE, txn: row.TXN_NO });
              } catch (err) {
                logger.error(`[${tenantId}] Failed to send email for TXN_NO=${row.TXN_NO}: ${err}`);
              }
            }
          });
        } catch (tenantErr) {
          logger.error(`[${tenantId}] Error in notification scheduler tenant loop:`, tenantErr);
        }
      }
    } catch (error) {
      logger.error("NotificationEmailScheduler failed:", error);
    }
  });

  logger.info("Notification Email Scheduler initialized (runs every 2 minutes)");
}

export default startNotificationEmailScheduler;
