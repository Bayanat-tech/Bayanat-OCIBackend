// import { DataTypes, Model } from "sequelize";
// import { sequelize } from "../../database/connection";
// import constants from "../../helpers/constants";

// class AttendanceEvent extends Model {
//   public id!: string;
//   public employee_id!: string;
//   public attendance_record_id!: string;
//   public event_time!: Date;
//   public event_type!: "check_in" | "check_out";
// }

// AttendanceEvent.init(
//   {
//     id: {
//       type: DataTypes.UUID,
//       primaryKey: true,
//       defaultValue: DataTypes.UUIDV4,
//     },
//     employee_id: {
//       type: DataTypes.STRING(20),
//       allowNull: false,
//     },
//     attendance_record_id: {
//       type: DataTypes.UUID,
//       allowNull: false,
//     },
//     event_time: {
//       type: DataTypes.DATE,
//       allowNull: false,
//     },
//     event_type: {
//       type: DataTypes.ENUM("check_in", "check_out"),
//       allowNull: false,
//     },
//   },
//   {
//     sequelize,
//     tableName: constants.TABLE.attendance_events,
//     timestamps: false,
//   }
// );

// export default AttendanceEvent;

// models/Attendance/attendance_event.ts

import { DataTypes, Model } from "sequelize";
import { sequelize } from "../../database/connection";
import constants from "../../helpers/constants";

class AttendanceEvent extends Model {
  public id!: string;
  public employee_id!: string;
  public employee_code!: string;
  public attendance_record_id!: string;
  public event_time!: Date;
  public event_type!: "check_in" | "check_out";
  public data_transfer!: "Y" | "N";
  public transfer_date!: Date | null;
  public created_at!: Date;
}

AttendanceEvent.init(
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    employee_id: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    employee_code: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    attendance_record_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    event_time: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    event_type: {
      type: DataTypes.ENUM("check_in", "check_out"),
      allowNull: false,
    },
    data_transfer: {
      type: DataTypes.ENUM("Y", "N"),
      defaultValue: "N",
      allowNull: false,
    },
    transfer_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: constants.TABLE.attendance_events,
    timestamps: false,
  }
);

export default AttendanceEvent;
