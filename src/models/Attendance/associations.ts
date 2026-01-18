// models/Attendance/associations.ts
import Employee from "./employee";
import AttendanceRecord from "./attendance_record";
import AttendanceEvent from "./attendance_event";
import EmployeeFace from "./employee_face";
import ProxyLog from "./ProxyLog"; // Import the new ProxyLog model

export const initializeAssociations = () => {
  // Only define associations if they don't already exist
  
  // Employee - AttendanceRecord (One-to-Many)
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

  // Employee - AttendanceEvent (One-to-Many)
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

  // AttendanceRecord - AttendanceEvent (One-to-Many)
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

  // Employee - EmployeeFace (One-to-Many)
  if (!Employee.associations.employeeFaces) {
    Employee.hasMany(EmployeeFace, {
      foreignKey: "employee_id",
      sourceKey: "employee_id",
      as: "employeeFaces",
    });
  }

  if (!EmployeeFace.associations.employee) {
    EmployeeFace.belongsTo(Employee, {
      foreignKey: "employee_id",
      targetKey: "employee_id",
      as: "employee",
    });
  }

  // 🆕 PROXY LOG ASSOCIATIONS
  
  // Employee - ProxyLog as Proxy Employee (One-to-Many)
  if (!Employee.associations.proxyLogsAsProxy) {
    Employee.hasMany(ProxyLog, {
      foreignKey: "proxy_employee_code",
      sourceKey: "employee_code",
      as: "proxyLogsAsProxy", // Logs where this employee was recognized as proxy
    });
  }

  // Employee - ProxyLog as Actual Employee (One-to-Many)
  if (!Employee.associations.proxyLogsAsActual) {
    Employee.hasMany(ProxyLog, {
      foreignKey: "actual_employee_code",
      sourceKey: "employee_code",
      as: "proxyLogsAsActual", // Logs where this employee reported proxy
    });
  }

  // ProxyLog - Employee as Proxy Employee (Many-to-One)
  if (!ProxyLog.associations.proxyEmployee) {
    ProxyLog.belongsTo(Employee, {
      foreignKey: "proxy_employee_code",
      targetKey: "employee_code",
      as: "proxyEmployee", // The employee that system recognized
    });
  }

  // ProxyLog - Employee as Actual Employee (Many-to-One)
  if (!ProxyLog.associations.actualEmployee) {
    ProxyLog.belongsTo(Employee, {
      foreignKey: "actual_employee_code",
      targetKey: "employee_code",
      as: "actualEmployee", // The employee who reported the proxy
    });
  }

  // 🆕 AttendanceEvent - ProxyLog (One-to-One via UUID)
  if (!AttendanceEvent.associations.proxyLog) {
    AttendanceEvent.hasOne(ProxyLog, {
      foreignKey: "uuid",
      sourceKey: "uuid",
      as: "proxyLog", // Proxy log related to this attendance event
    });
  }

  if (!ProxyLog.associations.attendanceEvent) {
    ProxyLog.belongsTo(AttendanceEvent, {
      foreignKey: "uuid",
      targetKey: "uuid",
      as: "attendanceEvent", // The original attendance event
    });
  }

  console.log("All database associations initialized successfully");
};

// Export all models
export { 
  Employee, 
  AttendanceRecord, 
  AttendanceEvent, 
  EmployeeFace,
  ProxyLog 
};