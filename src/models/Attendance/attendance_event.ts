// import { DataTypes, Model } from "sequelize";
// import { sequelize } from "../../database/connection";
// import constants from "../../helpers/constants";

// class AttendanceEvent extends Model {
//   public id!: string;
//   public employee_id!: string;
//   public employee_code!: string;
//   public attendance_record_id!: string;
//   public event_time!: Date;
//   public event_type!: "check_in" | "check_out";
//   public data_transfer!: "Y" | "N";
//   public transfer_date!: Date | null;
//   public created_at!: Date;
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
//     employee_code: {
//       type: DataTypes.STRING(50),
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
//     data_transfer: {
//       type: DataTypes.ENUM("Y", "N"),
//       defaultValue: "N",
//       allowNull: false,
//     },
//     transfer_date: {
//       type: DataTypes.DATE,
//       allowNull: true,
//     },
//     created_at: {
//       type: DataTypes.DATE,
//       defaultValue: DataTypes.NOW,
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
  
  // ✅ EXISTING location fields from your database
  public latitude!: number | null;
  public longitude!: number | null;
  public accuracy!: number | null;
  public location_type!: string; // VARCHAR(20) in your DB
  public address!: any; // JSON field
  public office_name!: string | null;
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
    
    latitude: {
      type: DataTypes.DECIMAL(10, 8),
      allowNull: true,
    },
    longitude: {
      type: DataTypes.DECIMAL(11, 8),
      allowNull: true,
    },
    accuracy: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: true,
    },
    location_type: {
      type: DataTypes.STRING(20), 
      defaultValue: 'unknown',
      allowNull: false,
    },
    address: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    office_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
    }
  },
  {
    sequelize,
    tableName: constants.TABLE.attendance_events,
    timestamps: false,
  }
);

export default AttendanceEvent;