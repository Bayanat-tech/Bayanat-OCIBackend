import { Op } from "sequelize";
import { differenceInHours, differenceInMinutes } from "date-fns";
import { v4 as uuidv4 } from "uuid";
import AttendanceRecord from "../models/Attendance/attendance_record";

export class AttendanceService {
  static async recordAttendance(
    employeeId: string,
    time: Date,
    type: "check_in" | "check_out"
  ) {
    const today = new Date(time);
    today.setHours(0, 0, 0, 0);

    let record = await AttendanceRecord.findOne({
      where: {
        employee_id: employeeId,
        date: today,
      },
    });

    if (!record && type === "check_in") {
      // Create new record for the day
      record = await AttendanceRecord.create({
        id: uuidv4(),
        employee_id: employeeId,
        date: today,
        check_in: time,
        first_check_in: time,
        status: this.determineStatus(time),
      });
    } else if (record) {
      // Update existing record
      if (type === "check_in") {
        if (!record.first_check_in || time < record.first_check_in) {
          record.first_check_in = time;
        }
        record.check_in = time;
      } else {
        record.check_out = time;
        record.last_check_out = time;

        // Calculate total hours if we have both check-in and check-out
        if (record.check_in) {
          const minutes = differenceInMinutes(time, record.check_in);
          record.total_hours = Number((minutes / 60).toFixed(2));
        }
      }
      await record.save();
    }

    return record;
  }

  private static determineStatus(
    checkInTime: Date
  ): "present" | "late" | "half-day" {
    const hour = checkInTime.getHours();
    const minutes = checkInTime.getMinutes();
    const totalMinutes = hour * 60 + minutes;

    if (totalMinutes <= 540) {
      // Before 9:00 AM
      return "present";
    } else if (totalMinutes <= 600) {
      // Before 10:00 AM
      return "late";
    } else {
      return "half-day";
    }
  }

  static async getDailyRecords(employeeId: string, date: Date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return await AttendanceRecord.findAll({
      where: {
        employee_id: employeeId,
        date: {
          [Op.between]: [startOfDay, endOfDay],
        },
      },
      order: [["check_in", "ASC"]],
    });
  }
}
