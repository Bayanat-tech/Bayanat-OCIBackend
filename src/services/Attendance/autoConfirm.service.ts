// import cron from "node-cron";
// import { AttendanceService } from './Attendance.service';
// import logger from '../../utils/logger';
// import { Op } from 'sequelize';
// import {
//   Employee,
//   AttendanceRecord,
//   AttendanceEvent,
//   ProxyLog,
//   EmployeeFace,
// } from "../../models/Attendance/associations";

// export class AutoConfirmService {
//   static start() {
//     // configurable cron expression (default: every 15 minutes)
//     const cronExpr = process.env.AUTO_CONFIRM_CRON || '*/15 * * * *';
//     const job = cron.schedule(cronExpr, async () => {
//       try {
//         const startTime = Date.now();
//         await AttendanceService.processAutoConfirm();
//         logger.info(`Auto-confirm cron executed in ${Date.now() - startTime}ms`);
//       } catch (error) {
//         logger.error('Auto-confirm cron job failed:', error);
//       }
//     });
//     job.start();
//     logger.info(`Auto-confirm service started (cron: ${process.env.AUTO_CONFIRM_CRON || '*/15 * * * *'}) with cancellation support`);
//   }
// }