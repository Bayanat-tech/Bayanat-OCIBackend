import { DataTypes, Model } from "sequelize";
import { sequelize } from "../../database/connection";
import constants from "../../helpers/constants";
import AttendanceEvent from "./attendance_event";

class AttendanceRecord extends Model {
  public id!: string;
  public employee_id!: string;
  public employee_code!:string;
  public date!: Date;
  public first_check_in!: Date;
  public last_check_out!: Date | null;
  public check_in!: Date;
  public check_out!: Date | null;
  public total_hours!: number;
  public status!: string;

  // Virtual fields for events
  public events?: AttendanceEvent[];
}

AttendanceRecord.init(
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    employee_id: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    employee_code:
    {
      type: DataTypes.STRING(40),
      allowNull: false,
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    first_check_in: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    last_check_out: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    check_in: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    check_out: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    total_hours: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: constants.TABLE.attendance_records,
    timestamps: false,
  }
);

export default AttendanceRecord;
