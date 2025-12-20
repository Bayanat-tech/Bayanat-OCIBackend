import { Op } from "sequelize";
import cron from "node-cron";
import logger from "../../utils/logger";
import AttendanceEvent from "../../models/Attendance/attendance_event";
import { HrService } from "../../services/hr.service";
import { AppDataSource } from "../../database/connection";

export class AttendanceEventScheduler {
  private static isRunning = false;
  private static readonly BATCH_SIZE = 100;

  static initializeScheduler(): void {
    
    cron.schedule("*/60 * * * *", async () => {
      await this.processUnsentEvents();
    });

    logger.info(
      "Attendance event scheduler initialized (runs every 60 minutes)"
    );
  }

  static async processUnsentEvents(): Promise<void> {
    if (this.isRunning) {
      logger.info("Scheduler is already running, skipping this execution");
      return;
    }
    this.isRunning = true;

    const Attendance =AppDataSource.getRepository(AttendanceEvent);
    try {
      logger.info("Starting to process unsent attendance events...");

      const unsentEvents = await Attendance.find({
      where: {
          data_transfer: "N",     
          status: "confirmed",
        },
        take: this.BATCH_SIZE,
        order: {
          event_time: "ASC",
        },
      });

      if (unsentEvents.length === 0) {
        logger.info("No unsent attendance events found");
        return;
      }

      logger.info(`Found ${unsentEvents.length} unsent attendance events`);

      // Transform events for API
      const eventsToSend = unsentEvents.map((event:any) => ({
        id: event.id,
        employeeId: event.employee_id,
        employeeCode: event.employee_code,
        attendanceRecordId: event.attendance_record_id ?? undefined,
        eventTime: event.event_time,
        eventType: event.event_type,
        createdAt: event.created_at,
      }));

      // Send to .NET API
      const result = await HrService.bulkInsertAttendanceEvents(eventsToSend);
      if (result && result.successfulInserts > 0) {
        const eventIds = unsentEvents.map((event: any) => event.id);

        await AttendanceEvent.update(
          {
            data_transfer: "Y",
            transfer_date: new Date(),
          },
          {
            where: {
              id: {
                [Op.in]: eventIds,
              },
            },
          }
        );

        logger.info(
          `Successfully processed ${unsentEvents.length} attendance events. Transfer date updated.`
        );
      } else {
        
        logger.error(
          `API call completed but reported a failure: ${result.message}`
        );
      }
    } catch (error: any) {
      logger.error("Error processing unsent attendance events:", error);
    } finally {
      this.isRunning = false;
    }
  }

  // Manual trigger for testing or immediate processing
  static async manualTrigger(): Promise<void> {
    logger.info("Manual trigger for attendance event processing");
    await this.processUnsentEvents();
  }

  // Get statistics about unsent events
  static async getTransferStats(): Promise<{
    totalUnsent: number;
    totalSent: number;
    lastTransfer: Date | null;
  }> 
  {
    const totalUnsent = await AttendanceEvent.count({
      where: { data_transfer: "N", status: "confirmed" },
    });

    const totalSent = await AttendanceEvent.count({
      where: { data_transfer: "Y", status: "confirmed" },
    });

    const lastTransferRecord = await AttendanceEvent.findOne({
      where: { data_transfer: "Y", status: "confirmed" },
      order: [["transfer_date", "DESC"]],
    });

    return {
      totalUnsent,
      totalSent,
      lastTransfer: lastTransferRecord?.transfer_date || null,
    };
  }
}
