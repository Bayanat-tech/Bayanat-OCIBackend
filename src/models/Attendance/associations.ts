// import Employee from "./employee";
// import AttendanceRecord from "./attendance_record";

// export const initializeAssociations = () => {
//   Employee.hasMany(AttendanceRecord, {
//     foreignKey: "employee_id",
//     sourceKey: "employee_id",
//     as: "employeeAttendance",
//   });

//   AttendanceRecord.belongsTo(Employee, {
//     foreignKey: "employee_id",
//     targetKey: "employee_id",
//     as: "employee",
//   });
// };

// export { Employee, AttendanceRecord };

// models/Attendance/associations.ts

// models/Attendance/associations.ts

// models/Attendance/associations.ts

import Employee from "./employee.entity";
import AttendanceRecord from "./attendance_record";
import AttendanceEvent from "./attendance_event";

export const initializeAssociations = () => {
  // Only define associations if they don't already exist
  if (!Employee.associations.attendanceRecords) {
    Employee.hasMany(AttendanceRecord, {
      foreignKey: "employee_id",
      sourceKey: "employee_id",
      as: "attendanceRecords",
    });
  }

  if (!AttendanceRecord.associations.employee) {
    AttendanceRecord.belongsTo(Employee, {
      foreignKey: "employee_id",
      targetKey: "employee_id",
      as: "employee",
    });
  }

  if (!Employee.associations.attendanceEvents) {
    Employee.hasMany(AttendanceEvent, {
      foreignKey: "employee_id",
      sourceKey: "employee_id",
      as: "attendanceEvents",
    });
  }

  if (!AttendanceEvent.associations.employee) {
    AttendanceEvent.belongsTo(Employee, {
      foreignKey: "employee_id",
      targetKey: "employee_id",
      as: "employee",
    });
  }

  if (!AttendanceRecord.associations.events) {
    AttendanceRecord.hasMany(AttendanceEvent, {
      foreignKey: "attendance_record_id",
      sourceKey: "id",
      as: "events",
    });
  }

  if (!AttendanceEvent.associations.record) {
    AttendanceEvent.belongsTo(AttendanceRecord, {
      foreignKey: "attendance_record_id",
      targetKey: "id",
      as: "record",
    });
  }
};

export { Employee, AttendanceRecord, AttendanceEvent };
