// models/Attendance/proxy_log.ts - FIXED
import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from "../../database/connection";

interface ProxyLogAttributes {
  id: string;
  uuid: string | null;                      
  timestamp: Date;
  proxy_employee_code: string;
  proxy_employee_name: string;
  actual_employee_code: string | null;      
  actual_employee_name: string | null;     
  confidence: number;
  s3_image_url?: string | null;             
  location_data?: any | null;               
  action: 'check_in' | 'check_out';
  action_taken: 'cancelled_by_user' | 'auto_rejected' | 'attempted_cancellation_after_confirmation';
  device_type?: string | null;
  status: string;
  created_at: Date | null;   
  reason: string | null;              
}

interface ProxyLogCreationAttributes extends Optional<
  ProxyLogAttributes, 
  'created_at' | 'uuid' | 'actual_employee_code' | 'actual_employee_name' | 's3_image_url' | 'location_data' | 'device_type'
> {}

class ProxyLog extends Model<ProxyLogAttributes, ProxyLogCreationAttributes> 
  implements ProxyLogAttributes {
  public id!: string;
  public uuid!: string | null;
  public timestamp!: Date;
  public proxy_employee_code!: string;
  public proxy_employee_name!: string;
  public actual_employee_code!: string | null;
  public actual_employee_name!: string | null;
  public confidence!: number;
  public s3_image_url!: string | null;
  public location_data!: any | null;
  public action!: 'check_in' | 'check_out';
  public action_taken!: 'cancelled_by_user' | 'auto_rejected' | 'attempted_cancellation_after_confirmation';
  public device_type!: string | null;
  public status!: string;
  public created_at!: Date | null;
  public reason !: string | null;
}

ProxyLog.init({
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
  },
  uuid: {
    type: DataTypes.STRING(100),
    allowNull: true,                      
  },
  timestamp: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  proxy_employee_code: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  proxy_employee_name: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  actual_employee_code: {
    type: DataTypes.STRING(100),
    allowNull: true,                      
  },
  actual_employee_name: {
    type: DataTypes.STRING(255),
    allowNull: true,                      
  },
  confidence: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
  },
  s3_image_url: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  location_data: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  action: {
    type: DataTypes.ENUM('check_in', 'check_out'),
    allowNull: false,
  },
  action_taken: {
    type: DataTypes.ENUM('cancelled_by_user', 'auto_rejected','attempted_cancellation_after_confirmation'),
    allowNull: false,
  },
  device_type: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  status: {
    type: DataTypes.STRING(50),
    defaultValue: 'reported',
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW, 
    allowNull: true, 
  },
  reason:
  {
    type: DataTypes.STRING(400),
    allowNull: false,
  }
}, {
  sequelize,
  tableName: 'proxy_logs',
  timestamps: false, 
});

export default ProxyLog;