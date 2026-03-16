import cron from "node-cron";
import logger from "../../utils/logger";
import { HrService } from "../../services/hr.service";
import { getRepository } from "../../database/connection";
import { TenantManager } from "../../database/TenantManager";
import { AttendanceEvent, DataTransferFlag, AttendanceStatus } from "../../entity/Attendance/attendance_events.entity";
import { ensureCorrectSchema } from "../../database/TypeORMTenantInterceptor";

export class AttendanceEventScheduler {
  private static isRunning = false;
  private static readonly BATCH_SIZE = 100;

  static initializeScheduler(): void {
    
    cron.schedule("*/120 * * * * *", async () => {
      await this.processUnsentEvents();
   });

    logger.info(
      "Attendance event scheduler initialized (runs every 120 minutes)"
    );
  }

  static async processUnsentEvents(): Promise<void> {
    if (this.isRunning) {
      logger.info("Scheduler is already running, skipping this execution");
      return;
    }
    this.isRunning = true;

    try {
      logger.info("Starting to process unsent attendance events...");
      const configured = process.env.ATTENDANCE_SCHEDULER_TENANTS?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      const tenants = (configured && configured.length > 0)
        ? configured
        : await TenantManager.listActiveTenants();

      if (configured && configured.length > 0) {
        logger.info(`[AttendanceEventScheduler] Using configured tenant list: ${tenants.join(",")}`);
      }

      if (!tenants || tenants.length === 0) {
        logger.info("No active tenants found");
        return;
      }

      for (const tenantId of tenants) {
        try {
          await TenantManager.runForTenant(tenantId, async () => {
            const attendanceRepository = getRepository(AttendanceEvent);

            const unsentEvents = await attendanceRepository.find({
              where: {
                data_transfer: DataTransferFlag.N,
                status: AttendanceStatus.CONFIRMED,
              },
              take: AttendanceEventScheduler.BATCH_SIZE,
              order: {
                event_time: "ASC",
              },
            });

            if (!unsentEvents || unsentEvents.length === 0) {
              logger.info(`[${tenantId}] No unsent attendance events found`);
              return;
            }

            logger.info(`[${tenantId}] Found ${unsentEvents.length} unsent attendance events`);

            const eventsToSend = unsentEvents.map((event: any) => ({
              id: event.id,
              employeeId: event.employee_id,
              employeeCode: event.employee_code,
              attendanceRecordId: event.attendance_record_id ?? undefined,
              eventTime: event.event_time,
              eventType: event.event_type,
              createdAt: event.created_at

            }));

            const result = await HrService.bulkInsertAttendanceEvents(eventsToSend);

            if (result && result.successfulInserts > 0) {
              const eventIds = unsentEvents.map((event: any) => event.id);
              const transferDate = new Date();

              logger.info(`[${tenantId}] Updating ${eventIds.length} records with DATA_TRANSFER = 'Y'`);

              for (const eventId of eventIds) {
                await attendanceRepository.update(
                  { id: eventId },
                  {
                    data_transfer: DataTransferFlag.Y,
                    transfer_date: transferDate,
                  }
                );
              }

              logger.info(
                `[${tenantId}] Successfully processed ${unsentEvents.length} attendance events. DATA_TRANSFER updated to 'Y'.`
              );
            } else {
              logger.error(
                `[${tenantId}] API call completed but reported a failure: ${result?.message}`
              );
            }
          });
        } catch (tenantErr) {
          logger.error(`[${tenantId}] Error processing tenant:`, tenantErr);
        } finally {
          if ((global as any).__currentRequestContext?.tenantId === tenantId) {
            delete (global as any).__currentRequestContext;
          }
        }
      }
    } catch (error: any) {
      logger.error("Error processing unsent attendance events:", error);
    } finally {
      this.isRunning = false;
    }
  }

  static async manualTrigger(): Promise<void> {
    logger.info("Manual trigger for attendance event processing");
    await this.processUnsentEvents();
  }

  static async getTransferStats(): Promise<{
    totalUnsent: number;
    totalSent: number;
    lastTransfer: Date | null;
  }> {
    // Ensure correct tenant schema before executing TypeORM queries
    await ensureCorrectSchema();

    const attendanceRepository = getRepository(AttendanceEvent);

    const totalUnsent = await attendanceRepository.count({
      where: { data_transfer: DataTransferFlag.N, status: AttendanceStatus.CONFIRMED },
    });

    const totalSent = await attendanceRepository.count({
      where: { data_transfer: DataTransferFlag.Y, status: AttendanceStatus.CONFIRMED },
    });

    const lastTransferRecord = await attendanceRepository.findOne({
      where: { data_transfer: DataTransferFlag.Y, status: AttendanceStatus.CONFIRMED },
      order: { transfer_date: "DESC" },
    });

    return {
      totalUnsent,
      totalSent,
      lastTransfer: lastTransferRecord?.transfer_date || null,
    };
  }
}
