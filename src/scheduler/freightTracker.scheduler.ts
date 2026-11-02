import cron from "node-cron";
import oracledb from "oracledb";
import TenantManager from "../database/TenantManager";
import logger from "../utils/logger";

/**
 * FREIGHT SHIPMENT TRACKER BACKGROUND SCHEDULER
 * 1. Morning DO Expiry Radar (Checks Delivery Orders expiring in <= 3 days)
 * 2. SLA Task Deadline Watchdog (Checks tasks approaching 1-hour deadline or overdue)
 */

export function startFreightTrackerScheduler(): void {
  logger.info("[FreightTrackerScheduler] Initializing Shipment Tracker background schedulers...");

  // 1. SLA Task Deadline Watchdog (Runs every 5 minutes)
  cron.schedule("*/5 * * * *", async () => {
    await runTaskDeadlineCheck();
  });

  // 2. DO Expiry Radar (Runs daily at 08:30 AM Muscat time = 04:30 UTC)
  cron.schedule("30 4 * * *", async () => {
    await runDoExpiryCheck();
  });

  // Run initial lightweight check on startup (after 10s delay)
  setTimeout(() => {
    void runTaskDeadlineCheck();
    void runDoExpiryCheck();
  }, 10000);
}

async function runDoExpiryCheck(): Promise<void> {
  let connection: oracledb.Connection | undefined;
  try {
    const tenantId = "WMSTST_TENANT";
    connection = await TenantManager.getConnection(tenantId);

    // Find Sea Import jobs where DO expires in <= 3 days
    const expiringDoRes = await connection.execute(
      `SELECT s.COMPANY_CODE, s.PRIN_CODE, s.JOB_NO, s.BL_NUMBER, s.DO_VALIDITY_DATE,
              ROUND(TRUNC(s.DO_VALIDITY_DATE) - TRUNC(SYSDATE)) AS DAYS_LEFT
         FROM TRK_SHIPMENT s
        WHERE s.CURRENT_STAGE != 'COMPLETED'
          AND s.DO_VALIDITY_DATE IS NOT NULL
          AND TRUNC(s.DO_VALIDITY_DATE) <= TRUNC(SYSDATE + 3)`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = (expiringDoRes.rows as any[]) || [];
    for (const r of rows) {
      const daysLeft = Number(r.DAYS_LEFT || 0);
      const title = `⚠️ DO Expiry Warning: Job ${r.JOB_NO}`;
      const msg = `Delivery Order for B/L ${r.BL_NUMBER || r.JOB_NO} expires in ${daysLeft} day(s) (Expiry: ${new Date(r.DO_VALIDITY_DATE).toLocaleDateString()}). Please verify container pull-out status.`;

      // Avoid inserting duplicate notifications on the same day
      const dupCheck = await connection.execute(
        `SELECT COUNT(*) AS CNT
           FROM TRK_NOTIFICATIONS
          WHERE COMPANY_CODE = :comp AND JOB_NO = :job AND CATEGORY = 'DO_EXPIRING'
            AND TRUNC(CREATED_DT) = TRUNC(SYSDATE)`,
        { comp: r.COMPANY_CODE, job: r.JOB_NO },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const alreadyNotified = Number((dupCheck.rows as any[])?.[0]?.CNT || 0) > 0;

      if (!alreadyNotified) {
        await connection.execute(
          `INSERT INTO TRK_NOTIFICATIONS (NOTIFICATION_ID, COMPANY_CODE, PRIN_CODE, JOB_NO, RECIPIENT_ID, CHANNEL, CATEGORY, TITLE, MESSAGE, IS_READ, CREATED_DT)
           VALUES (RAWTOHEX(SYS_GUID()), :comp, :prin, :job, 'ALL', 'IN_APP', 'DO_EXPIRING', :title, :msg, 'N', SYSDATE)`,
          {
            comp: r.COMPANY_CODE,
            prin: r.PRIN_CODE || "00000",
            job: r.JOB_NO,
            title,
            msg,
          },
          { autoCommit: true }
        );
        logger.info(`[FreightTrackerScheduler] DO Expiry notification logged for Job ${r.JOB_NO} (${daysLeft} days left)`);
      }
    }
  } catch (err: any) {
    logger.warn(`[FreightTrackerScheduler] DO Expiry check error: ${err?.message || err}`);
  } finally {
    if (connection) await connection.close();
  }
}

async function runTaskDeadlineCheck(): Promise<void> {
  let connection: oracledb.Connection | undefined;
  try {
    const tenantId = "WMSTST_TENANT";
    connection = await TenantManager.getConnection(tenantId);

    // Find in-progress tasks approaching due date within 1 hour or overdue
    const tasksRes = await connection.execute(
      `SELECT t.COMPANY_CODE, t.PRIN_CODE, t.JOB_NO, t.TASK_TYPE, t.DUE_AT,
              ROUND((t.DUE_AT - SYSDATE) * 24, 1) AS HOURS_LEFT
         FROM TRK_SHIPMENT_TASKS t
         JOIN TRK_SHIPMENT s ON s.COMPANY_CODE = t.COMPANY_CODE AND s.PRIN_CODE = t.PRIN_CODE AND s.JOB_NO = t.JOB_NO
        WHERE t.STATUS = 'IN_PROGRESS'
          AND s.CURRENT_STAGE != 'COMPLETED'
          AND t.DUE_AT IS NOT NULL
          AND t.DUE_AT <= SYSDATE + (1 / 24)`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = (tasksRes.rows as any[]) || [];
    for (const r of rows) {
      const hoursLeft = Number(r.HOURS_LEFT || 0);
      const isOverdue = hoursLeft <= 0;
      const title = isOverdue
        ? `🚨 Milestone Overdue: Job ${r.JOB_NO} (${r.TASK_TYPE})`
        : `⏱️ Deadline Approaching: Job ${r.JOB_NO} (${r.TASK_TYPE})`;
      const msg = isOverdue
        ? `Task ${r.TASK_TYPE} on Job ${r.JOB_NO} is OVERDUE by ${Math.abs(hoursLeft)} hour(s). Immediate action required.`
        : `Task ${r.TASK_TYPE} on Job ${r.JOB_NO} is due in ${hoursLeft} hour(s). Please complete milestone.`;

      // Avoid spamming if notified in last 6 hours
      const dupCheck = await connection.execute(
        `SELECT COUNT(*) AS CNT
           FROM TRK_NOTIFICATIONS
          WHERE COMPANY_CODE = :comp AND JOB_NO = :job AND CATEGORY = 'TASK_OVERDUE'
            AND CREATED_DT >= SYSDATE - (6 / 24)`,
        { comp: r.COMPANY_CODE, job: r.JOB_NO },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const alreadyNotified = Number((dupCheck.rows as any[])?.[0]?.CNT || 0) > 0;

      if (!alreadyNotified) {
        await connection.execute(
          `INSERT INTO TRK_NOTIFICATIONS (NOTIFICATION_ID, COMPANY_CODE, PRIN_CODE, JOB_NO, RECIPIENT_ID, CHANNEL, CATEGORY, TITLE, MESSAGE, IS_READ, CREATED_DT)
           VALUES (RAWTOHEX(SYS_GUID()), :comp, :prin, :job, 'ALL', 'IN_APP', 'TASK_OVERDUE', :title, :msg, 'N', SYSDATE)`,
          {
            comp: r.COMPANY_CODE,
            prin: r.PRIN_CODE || "00000",
            job: r.JOB_NO,
            title,
            msg,
          },
          { autoCommit: true }
        );
        logger.info(`[FreightTrackerScheduler] Task deadline notification logged for Job ${r.JOB_NO} (${r.TASK_TYPE})`);
      }
    }
  } catch (err: any) {
    logger.warn(`[FreightTrackerScheduler] Task deadline check notice: ${err?.message || err}`);
  } finally {
    if (connection) await connection.close();
  }
}

