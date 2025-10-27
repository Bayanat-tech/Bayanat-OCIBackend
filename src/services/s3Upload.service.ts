// Import AWS S3 SDK components for file operations
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
// Import application constants including AWS credentials
import constants from "../helpers/constants";
// Import interface defining S3 upload parameters
import { UploadToS3ObjectInterface } from "../interfaces/common.interface";

const s3Client = new S3Client({
  region: constants.AWS_S3_CREDENTIALS.REGION,
  credentials: {
    accessKeyId: constants.AWS_S3_CREDENTIALS.ACCESS_KEY,
    secretAccessKey: constants.AWS_S3_CREDENTIALS.SECRET_ACCESS_KEY,
  },
});

export const uploadToS3 = async (req: any, res: any) => {
  const file = req.file;

  // Generate dynamic file path using current date (YYYY/MM/filename)
  const fileName: string = `uploads/${new Date().getFullYear()}/${
    new Date().getMonth() + 1
  }/${file.originalname}`;

  // Configure S3 upload parameters
  const objectParams: UploadToS3ObjectInterface = {
    Bucket: constants.AWS_S3_CREDENTIALS.S3_BUCKET,
    Key: fileName,
    Body: file.buffer,
    ACL: "public-read",
    ContentType: file.mimetype,
  };

  try {
    await s3Client.send(new PutObjectCommand(objectParams));

    const URL: string = constants.AWS_S3_CREDENTIALS.AWS_S3_URL(fileName);

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: URL,
    });
  } catch (error: any) {
    return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message,
    });
  }
};

export const uploadPFToS3 = async (req: any, res: any) => {
  const file = req.file;
  const requestNumber = req.body.request_number;
  const requestType = req.body.type;

  const fileName: string = `UploadWorkflow/${requestType}/${new Date().getFullYear()}/${
    new Date().getMonth() + 1
  }/${requestNumber}/${file.originalname}`;

  const objectParams: UploadToS3ObjectInterface = {
    Bucket: constants.AWS_S3_CREDENTIALS.S3_BUCKET,
    Key: fileName,
    Body: file.buffer,
    ACL: "public-read",
    ContentType: file.mimetype,
  };

  try {
    await s3Client.send(new PutObjectCommand(objectParams));

    const URL: string = constants.AWS_S3_CREDENTIALS.AWS_S3_URL(fileName);

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: URL,
    });
  } catch (error: any) {
    return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message,
    });
  }
};

export const deleteFileFromS3 = async (awsFileLocation: string) => {
  const params = {
    Bucket: constants.AWS_S3_CREDENTIALS.S3_BUCKET,
    Key: awsFileLocation,
  };

  try {
    await s3Client.send(new DeleteObjectCommand(params));
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to delete file from S3: ${error.message}`);
    } else {
      throw new Error("Failed to delete file from S3: Unknown error occurred");
    }
  }
};

export const uploadVendorAttachmentToS3 = async (req: any, res: any) => {
  const file = req.file;
  const docNo = req.body.doc_no;

  const fileName: string = `VendorDocument/${docNo}/${file.originalname}`;

  const objectParams: UploadToS3ObjectInterface = {
    Bucket: constants.AWS_S3_CREDENTIALS.S3_BUCKET,
    Key: fileName,
    Body: file.buffer,
    ACL: "public-read",
    ContentType: file.mimetype,
  };

  try {
    await s3Client.send(new PutObjectCommand(objectParams));

    const URL: string = constants.AWS_S3_CREDENTIALS.AWS_S3_URL(fileName);

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: URL,
    });
  } catch (error: any) {
    return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message,
    });
  }
};

export const deleteVendorAttachmentFromS3 = async (req: any, res: any) => {
  const docNo = req.params.doc_no;
  const fileName = `VendorDocument/${docNo}`;

  const params = {
    Bucket: constants.AWS_S3_CREDENTIALS.S3_BUCKET,
    Key: fileName,
  };

  try {
    await s3Client.send(new DeleteObjectCommand(params));
    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "File deleted successfully",
    });
  } catch (error: any) {
    return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message,
    });
  }
};

export const uploadEmployeeAttachmentToS3 = async (req: any, res: any) => {
  const file = req.file;
  const requestNumber = req.body.request_number;

  const fileName: string = `LeaveDocument/${requestNumber}/${file.originalname}`;

  const objectParams: UploadToS3ObjectInterface = {
    Bucket: constants.AWS_S3_CREDENTIALS.S3_BUCKET,
    Key: fileName,
    Body: file.buffer,
    ACL: "public-read",
    ContentType: file.mimetype,
  };

  try {
    await s3Client.send(new PutObjectCommand(objectParams));

    const URL: string = constants.AWS_S3_CREDENTIALS.AWS_S3_URL(fileName);

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: URL,
    });
  } catch (error: any) {
    return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message,
    });
  }
};

export const deleteEmployeeAttachmentFromS3 = async (req: any, res: any) => {
  const empId = req.params.emp_id;
  const fileName = `LeaveDocument/${empId}`;

  const params = {
    Bucket: constants.AWS_S3_CREDENTIALS.S3_BUCKET,
    Key: fileName,
  };

  try {
    await s3Client.send(new DeleteObjectCommand(params));
    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "File deleted successfully",
    });
  } catch (error: any) {
    return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message,
    });
  }
};
