// import { DataTypes, Model } from "sequelize";
// import { sequelize } from "../../database/connection";
// import constants from "../../helpers/constants";
// import AttendanceRecord from "./attendance_record";

// class Employee extends Model {
//   public id!: string;
//   public employee_id!: string;
//   public full_name!: string;
//   public email!: string;
//   public department!: string;
//   public position!: string;
//   public hire_date!: Date;
//   public phone_number?: string;
//   public is_active!: boolean;
//   public created_at!: Date;
//   public updated_at!: Date;
// }

// Employee.init(
//   {
//     id: {
//       type: DataTypes.UUID,
//       defaultValue: DataTypes.UUIDV4,
//       primaryKey: true,
//     },
//     employee_id: {
//       type: DataTypes.STRING(20),
//       allowNull: false,
//       unique: true,
//     },
//     full_name: {
//       type: DataTypes.STRING(100),
//       allowNull: false,
//     },
//     email: {
//       type: DataTypes.STRING(100),
//       allowNull: false,
//       unique: true,
//       validate: {
//         isEmail: true,
//       },
//     },
//     department: {
//       type: DataTypes.STRING(50),
//       allowNull: false,
//     },
//     position: {
//       type: DataTypes.STRING(50),
//       allowNull: false,
//     },
//     hire_date: {
//       type: DataTypes.DATEONLY,
//       allowNull: false,
//     },
//     phone_number: {
//       type: DataTypes.STRING(20),
//       allowNull: true,
//     },
//     is_active: {
//       type: DataTypes.BOOLEAN,
//       defaultValue: true,
//       allowNull: false,
//     },
//     created_at: {
//       type: DataTypes.DATE,
//       defaultValue: DataTypes.NOW,
//       field: "created_at", // Explicitly map to database column
//     },
//     updated_at: {
//       type: DataTypes.DATE,
//       defaultValue: DataTypes.NOW,
//       field: "updated_at", // Explicitly map to database column
//     },
//   },
//   {
//     sequelize,
//     tableName: constants.TABLE.employees,
//     timestamps: true,
//     createdAt: "created_at", // Map createdAt to created_at
//     updatedAt: "updated_at", // Map updatedAt to updated_at
//     underscored: true, // Use underscored naming convention
//   }
// );

// // Define the association
// Employee.hasMany(AttendanceRecord, {
//   foreignKey: "employee_id",
//   as: "attendance_records",
// });

// export default Employee;

// models/Attendance/employee.ts

import { DataTypes, Model } from "sequelize";
import { sequelize } from "../../database/connection";
import constants from "../../helpers/constants";

class Employee extends Model {
  public id!: string;
  public employee_id!: string;
  public employee_code!: string;
  public full_name!: string;
  public email!: string;
  public department!: string;
  public position!: string;
  public hire_date!: Date;
  public phone_number!: string;
  public is_active!: boolean;
  public created_at!: Date;
  public updated_at!: Date;
}

Employee.init(
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    employee_id: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
    },
    employee_code: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
    },
    full_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    department: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    position: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    hire_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    phone_number: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: constants.TABLE.employees,
    timestamps: false,
  }
);

export default Employee;
