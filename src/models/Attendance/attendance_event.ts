import { DataTypes, Model } from "sequelize";
import { sequelize } from "../../database/connection";
import constants from "../../helpers/constants";

class AttendanceEvent extends Model {
  public id!: string;
  public employee_id!: string;
  public employee_code!: string;
  public attendance_record_id?: string | null; 
  public event_time!: Date;
  public event_type!: "check_in" | "check_out";
  public data_transfer!: "Y" | "N";
  public transfer_date!: Date | null;
  public created_at!: Date;
  public latitude!: number | null;
  public longitude!: number | null;
  public accuracy!: number | null;
  public location_type!: string; 
  public address!: any; // JSON field
  public office_name!: string | null;
  public uuid!: string | null;
  public confidence!: number | null;
  public s3_image_url!: string | null;
  public status!: "pending_auto_confirm" | "confirmed" | "cancelled";
  public confirmed_by!: string | null;
  public confirmed_at!: Date | null;
  public auto_confirm_time!: Date | null;
  public location_data?: any | null; // keep TS property (virtual)
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
      allowNull: true,
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

    // Virtual composed field — NOT stored in DB (avoids selecting non-existing column)
    location_data: {
      type: DataTypes.VIRTUAL,
      get(this: any) {
        const lat = this.getDataValue ? this.getDataValue('latitude') : this.latitude;
        const lon = this.getDataValue ? this.getDataValue('longitude') : this.longitude;
        const acc = this.getDataValue ? this.getDataValue('accuracy') : this.accuracy;
        const locType = this.getDataValue ? this.getDataValue('location_type') : this.location_type;
        const office = this.getDataValue ? this.getDataValue('office_name') : this.office_name;
        const addr = this.getDataValue ? this.getDataValue('address') : this.address;
        if (lat == null && lon == null && acc == null && !addr && !locType && !office) return null;
        return {
          latitude: lat,
          longitude: lon,
          accuracy: acc,
          location_type: locType,
          office_name: office,
          address: addr
        };
      }
    },
    office_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    uuid: {
    type: DataTypes.STRING(100),
    allowNull: true,
    },
    confidence: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    },
    s3_image_url: {
    type: DataTypes.STRING(500),
    allowNull: true,
    },
    status: {
    type: DataTypes.ENUM('pending_auto_confirm', 'confirmed', 'cancelled'),
    defaultValue: 'confirmed'
    },
    confirmed_by: {
    type: DataTypes.STRING(50),
    allowNull: true,
    },
    confirmed_at: {
    type: DataTypes.DATE,
    allowNull: true,
    },
    auto_confirm_time: {
    type: DataTypes.DATE,
    allowNull: true,
    },
  },
  {
    sequelize,
    tableName: constants.TABLE.attendance_events,
    timestamps: false,
  }
);

export default AttendanceEvent;