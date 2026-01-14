import { DataTypes, Model } from "sequelize";
import { sequelize } from "../database/connection";
import constants from "../helpers/constants";
import { IFiles } from "../interfaces/common.interface";

// Define the Files class extending Model with IFiles type
class Files extends Model<IFiles> {
  aws_file_locn!: string; // Add this property
}

// Initialize the Files model with its attributes and configurations
Files.init(
  {
    // Define company code attribute
    company_code: {
      type: DataTypes.STRING(5),
      allowNull: false,
    },
    // Define request number attribute
    request_number: {
      type: DataTypes.STRING(25),
      allowNull: false,
    },
    // Define serial number attribute
    sr_no: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // Define file name attribute, set as primary key
    file_name: {
      type: DataTypes.STRING(180),
      allowNull: false,
      primaryKey: true,
    },
    // Define file extension attribute
    extensions: {
      type: DataTypes.STRING(5),
      allowNull: false,
    },
    // Define original file name attribute
    org_file_name: {
      type: DataTypes.STRING(400),
      allowNull: false,
    },
    // Define AWS file location attribute
    aws_file_locn: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    // Define flow level attribute
    flow_level: {
      type: DataTypes.TINYINT,
      allowNull: false,
    },
    // Define modules attribute
    modules: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    // Define updated by attribute
    updated_by: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    // Define created by attribute
    created_by: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    user_file_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  {
    // Configuration for the Sequelize model
    sequelize,
    modelName: "Files",
    tableName: constants.TABLE.UPLOADED_FILES_DLTS,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

// Export the Files model
export default Files;
