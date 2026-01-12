import { DataTypes, Model } from "sequelize";
import { sequelize } from "../../database/connection";
import constants from "../../helpers/constants";

class EmployeeFace extends Model {
  public id!: string;
  public employee_id!: string;
  public s3_key!: string;
  public descriptor!: object;
  public is_active!: boolean;
  public created_at!: Date;
}

EmployeeFace.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    employee_id: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    s3_key: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    descriptor: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: constants.TABLE.employee_faces,
    timestamps: false,
    indexes: [
      {
        fields: ["employee_id"],
      },
    ],
  }
);

export default EmployeeFace;
