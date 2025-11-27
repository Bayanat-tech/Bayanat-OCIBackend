// import { Op } from "sequelize";
// import logger from "../../utils/logger";
// import {
//   Employee,
//   AttendanceRecord,
//   initializeAssociations,
// } from "../../models/Attendance/associations";

// // Initialize associations
// initializeAssociations();

// export class AttendanceService {
//   static async markAttendance(
//     employeeId: string,
//     action: "check-in" | "check-out"
//   ): Promise<{ status: string; timestamp: Date }> {
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);

//     const now = new Date();
//     const businessHours = this.getBusinessHours(now);

//     if (action === "check-in") {
//       const status = this.calculateStatus(now, businessHours.startTime);

//       const [record, created] = await AttendanceRecord.findOrCreate({
//         where: {
//           employee_id: employeeId,
//           date: today,
//         },
//         defaults: {
//           id: require("uuid").v4(),
//           employee_id: employeeId,
//           date: today,
//           check_in: now,
//           status,
//         },
//       });

//       if (!created) {
//         record.check_in = now;
//         record.status = status;
//         await record.save();
//       }

//       logger.info(`Employee ${employeeId} checked in at ${now}`);
//       return { status, timestamp: now };
//     } else {
//       const record = await AttendanceRecord.findOne({
//         where: {
//           employee_id: employeeId,
//           date: today,
//         },
//       });

//       if (!record) {
//         throw new Error("No check-in record found for today");
//       }

//       record.check_out = now;
//       await record.save();

//       logger.info(`Employee ${employeeId} checked out at ${now}`);
//       return { status: record.status, timestamp: now };
//     }
//   }

//   static async getAttendanceReport(
//     startDate: Date,
//     endDate: Date,
//     department?: string,
//     page: number = 1,
//     limit: number = 20
//   ): Promise<any> {
//     const offset = (page - 1) * limit;

//     const whereClause: any = {
//       date: {
//         [Op.between]: [startDate, endDate],
//       },
//     };

//     const { count, rows } = await AttendanceRecord.findAndCountAll({
//       where: whereClause,
//       include: [
//         {
//           model: Employee,
//           as: "employee",
//           attributes: ["full_name", "department", "position"],
//           required: true,
//           where: department ? { department } : {},
//         },
//       ],
//       order: [
//         ["date", "DESC"],
//         ["check_in", "DESC"],
//       ],
//       offset,
//       limit,
//       raw: true,
//     });

//     return {
//       total: count,
//       page,
//       limit,
//       data: rows.map((record: any) => ({
//         employee_id: record.employee_id,
//         full_name: record["employee.full_name"],
//         department: record["employee.department"],
//         position: record["employee.position"],
//         date: record.date,
//         check_in: record.check_in,
//         check_out: record.check_out,
//         status: record.status,
//       })),
//     };
//   }

//   private static getBusinessHours(date: Date): {
//     startTime: string;
//     endTime: string;
//   } {
//     return {
//       startTime: "10:00",
//       endTime: "18:30",
//     };
//   }

//   private static calculateStatus(
//     time: Date,
//     startTime: string
//   ): "present" | "late" | "half-day" {
//     const [hours, minutes] = startTime.split(":").map(Number);
//     const lateThreshold = new Date(time);
//     lateThreshold.setHours(hours, minutes, 0, 0);

//     return time > lateThreshold ? "late" : "present";
//   }
// }

import { Op } from "sequelize";
import { differenceInMinutes } from "date-fns";
import { v4 as uuidv4 } from "uuid";
import logger from "../../utils/logger";
import {
  Employee,
  AttendanceRecord,
  AttendanceEvent,
} from "../../models/Attendance/associations";

export class AttendanceService {
  // static async markAttendance(
  //   employeeId: string,
  //   action: "check-in" | "check-out"
  // ): Promise<{ status: string; timestamp: Date }> {
  //   const today = new Date();
  //   today.setHours(0, 0, 0, 0);

  //   const now = new Date();
  //   const businessHours = this.getBusinessHours(now);

  //   // Verify employee exists
  //   const employee = await Employee.findOne({
  //     where: { employee_id: employeeId },
  //   });

  //   if (!employee) {
  //     throw new Error("Employee not found");
  //   }

  //   const [record, created] = await AttendanceRecord.findOrCreate({
  //     where: {
  //       employee_id: employeeId,
  //       date: today,
  //     },
  //     defaults: {
  //       id: uuidv4(),
  //       employee_id: employeeId,
  //       date: today,
  //       first_check_in: now,
  //       check_in: now,
  //       status: "present",
  //       last_check_out: null,
  //       check_out: null,
  //       total_hours: 0,
  //     },
  //   });

  //   if (action === "check-in") {
  //     // Create check-in event
  //     await AttendanceEvent.create({
  //       id: uuidv4(),
  //       employee_id: employeeId,
  //       attendance_record_id: record.id,
  //       event_time: now,
  //       event_type: "check_in",
  //       data_transfer: "N",
  //     });

  //     // Update first_check_in if this is the first check-in of the day
  //     if (!record.first_check_in || now < record.first_check_in) {
  //       record.first_check_in = now;
  //       record.check_in = now; // Keep original field for compatibility
  //       record.status = this.calculateStatus(now, businessHours.startTime);
  //       await record.save();
  //     }

  //     logger.info(`Employee ${employeeId} checked in at ${now}`);
  //     return { status: record.status, timestamp: now };
  //   } else {
  //     // Create check-out event
  //     await AttendanceEvent.create({
  //       id: uuidv4(),
  //       employee_id: employeeId,
  //       attendance_record_id: record.id,
  //       event_time: now,
  //       event_type: "check_out",
  //       data_transfer: "N",
  //     });

  //     // Update last_check_out if this is the last check-out of the day
  //     if (!record.last_check_out || now > record.last_check_out) {
  //       record.last_check_out = now;
  //       record.check_out = now; // Keep original field for compatibility

  //       // Calculate total hours if we have both first_check_in and last_check_out
  //       if (record.first_check_in) {
  //         const minutes = differenceInMinutes(now, record.first_check_in);
  //         record.total_hours = Number((minutes / 60).toFixed(2));
  //       }

  //       await record.save();
  //     }

  //     logger.info(`Employee ${employeeId} checked out at ${now}`);
  //     return { status: record.status, timestamp: now };
  //   }
  // }

  static async markAttendance(
    employeeId: string,
    action: "check-in" | "check-out"
  ): Promise<{ status: string; timestamp: Date }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const now = new Date();
    const businessHours = this.getBusinessHours(now);

    // Verify employee exists
    const employee = await Employee.findOne({
      where: { employee_id: employeeId  },
    });

    if (!employee) {
      throw new Error("Employee not found");
    }

    const [record, created] = await AttendanceRecord.findOrCreate({
      where: {
        employee_id: employeeId,
        date: today,
      },
      defaults: {
        id: uuidv4(),
        employee_id: employeeId,
        employee_code: employee.employee_code,
        date: today,
        first_check_in: now,
        check_in: now, // Set initial check_in
        status: "present",
        last_check_out: null,
        check_out: null, // Initially null for check_out
        total_hours: 0,
      },
    });

    if (action === "check-in") {
      // Create check-in event
      await AttendanceEvent.create({
        id: uuidv4(),
        employee_id: employeeId,
        employee_code: employee.employee_code,
        attendance_record_id: record.id,
        event_time: now,
        event_type: "check_in",
        data_transfer: "N",
      });

      // Update first_check_in if this is the first check-in of the day
      if (!record.first_check_in || now < record.first_check_in) {
        record.first_check_in = now;
        record.status = this.calculateStatus(now, businessHours.startTime);
      }

      // ALWAYS update check_in with the latest check-in time
      record.check_in = now;
      await record.save();

      logger.info(`Employee ${employeeId} checked in at ${now}`);
      return { status: record.status, timestamp: now };
    } else {
      // Create check-out event
      await AttendanceEvent.create({
        id: uuidv4(),
        employee_id: employeeId,
        employee_code: employee.employee_code,
        attendance_record_id: record.id,
        event_time: now,
        event_type: "check_out",
        data_transfer: "N",
      });

      // Update last_check_out if this is the last check-out of the day
      if (!record.last_check_out || now > record.last_check_out) {
        record.last_check_out = now;
      }

      // ALWAYS update check_out with the latest check-out time
      record.check_out = now;

      // Calculate total hours if we have both first_check_in and last_check_out
      if (record.first_check_in && record.last_check_out) {
        const minutes = differenceInMinutes(
          record.last_check_out,
          record.first_check_in
        );
        record.total_hours = Number((minutes / 60).toFixed(2));
      }

      await record.save();

      logger.info(`Employee ${employeeId} checked out at ${now}`);
      return { status: record.status, timestamp: now };
    }
  }

  // Update the report method to include events
  // static async getAttendanceReport(
  //   startDate: Date,
  //   endDate: Date,
  //   department?: string,
  //   page: number = 1,
  //   limit: number = 20
  // ): Promise<any> {
  //   const offset = (page - 1) * limit;

  //   const whereClause: any = {
  //     date: {
  //       [Op.between]: [startDate, endDate],
  //     },
  //   };

  //   const { count, rows } = await AttendanceRecord.findAndCountAll({
  //     where: whereClause,
  //     include: [
  //       {
  //         model: Employee,
  //         as: "employee",
  //         attributes: ["full_name", "department", "position"],
  //         required: true,
  //         where: department ? { department } : {},
  //       },
  //       {
  //         model: AttendanceEvent,
  //         as: "events",
  //         attributes: ["event_time", "event_type"],
  //         order: [["event_time", "ASC"]],
  //       },
  //     ],
  //     order: [
  //       ["date", "DESC"],
  //       ["first_check_in", "DESC"],
  //     ],
  //     offset,
  //     limit,
  //   });

  //   return {
  //     total: count,
  //     page,
  //     limit,
  //     data: rows.map((record: any) => ({
  //       employee_id: record.employee_id,
  //       full_name: record.employee?.full_name,
  //       department: record.employee?.department,
  //       position: record.employee?.position,
  //       date: record.date,
  //       check_in: record.check_in,
  //       check_out: record.check_out,
  //       first_check_in: record.first_check_in,
  //       last_check_out: record.last_check_out,
  //       total_hours: record.total_hours,
  //       status: record.status,
  //       events: record.events?.map((event: any) => ({
  //         time: event.event_time,
  //         type: event.event_type,
  //       })),
  //     })),
  //   };
  // }

  static async getAttendanceReport(
    startDate: Date,
    endDate: Date,
    department?: string,
    page: number = 1,
    limit: number = 20
  ): Promise<any> {
    const offset = (page - 1) * limit;

    // Fix: Include the entire end date by setting time to 23:59:59
    const adjustedStartDate = new Date(startDate);
    adjustedStartDate.setHours(0, 0, 0, 0);

    const adjustedEndDate = new Date(endDate);
    adjustedEndDate.setHours(23, 59, 59, 999);

    // Build where clause for events
    const eventWhereClause: any = {
      event_time: {
        [Op.between]: [adjustedStartDate, adjustedEndDate],
      },
    };

    // If department is specified, we need to join with Employee table
    let employeeWhereClause = {};
    if (department) {
      employeeWhereClause = { department };
    }

    // Get events with employee and record information
    const { count, rows } = await AttendanceEvent.findAndCountAll({
      where: eventWhereClause,
      include: [
        {
          model: Employee,
          as: "employee",
          attributes: ["full_name", "department", "position"],
          required: true,
          where: employeeWhereClause,
        },
        {
          model: AttendanceRecord,
          as: "record",
          attributes: ["date", "status", "total_hours"],
        },
      ],
      order: [
        ["event_time", "DESC"], // Show latest events first
      ],
      offset,
      limit,
    });

    // Transform the data to show each event as a separate row
    const formattedData = rows.map((event: any) => {
      const eventTime = new Date(event.event_time);
      const eventDate = new Date(eventTime);
      eventDate.setHours(0, 0, 0, 0);

      return {
        // Event information
        event_id: event.id,
        event_type: event.event_type,
        event_time: event.event_time,

        // Employee information
        employee_id: event.employee_id,
        employee_code: event.employee_code,
        full_name: event.employee?.full_name,
        department: event.employee?.department,
        position: event.employee?.position,

        // Date information
        date: eventDate.toISOString().split("T")[0], // Format as YYYY-MM-DD

        // Record information (if available)
        daily_status: event.record?.status,
        total_hours: event.record?.total_hours,

        // Additional calculated fields
        time_only: eventTime.toTimeString().split(" ")[0], // HH:MM:SS
        day_of_week: eventTime.toLocaleDateString("en-US", { weekday: "long" }),
      };
    });

    return {
      total: count,
      page,
      limit,
      data: formattedData,
    };
  }

  // Add this method to get detailed event history
  static async getAttendanceEvents(
    employeeId: string,
    startDate: Date,
    endDate: Date
  ) {
    return await AttendanceEvent.findAll({
      where: {
        employee_id: employeeId,
        event_time: {
          [Op.between]: [startDate, endDate],
        },
      },
      order: [["event_time", "ASC"]],
      include: [
        {
          model: AttendanceRecord,
          as: "record",
          attributes: ["date", "status"],
        },
      ],
    });
  }

  // Keep your existing methods
  private static getBusinessHours(date: Date): {
    startTime: string;
    endTime: string;
  } {
    return {
      startTime: "10:00",
      endTime: "18:30",
    };
  }

  private static calculateStatus(
    time: Date,
    startTime: string
  ): "present" | "late" | "half-day" {
    const [hours, minutes] = startTime.split(":").map(Number);
    const lateThreshold = new Date(time);
    lateThreshold.setHours(hours, minutes, 0, 0);

    return time > lateThreshold ? "late" : "present";
  }
}
