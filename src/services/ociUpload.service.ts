import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import constants from "../helpers/constants";
import { UploadToS3ObjectInterface } from "../interfaces/common.interface";

// Configure S3 client for OCI S3 Compatibility API
const s3Client = new S3Client({
  region: constants.OCI_S3_COMPATIBILITY.REGION,
  endpoint: constants.OCI_S3_COMPATIBILITY.ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: constants.OCI_S3_COMPATIBILITY.ACCESS_KEY_ID,
    secretAccessKey: constants.OCI_S3_COMPATIBILITY.SECRET_ACCESS_KEY,
  },
});

export const uploadToS3 = async (req: any, res: any) => {
  const file = req.file;

  const fileName: string = `uploads/${new Date().getFullYear()}/${
    new Date().getMonth() + 1
  }/${file.originalname}`;

  const objectParams: UploadToS3ObjectInterface = {
    Bucket: constants.OCI_S3_COMPATIBILITY.BUCKET_NAME,
    Key: fileName,
    Body: file.buffer,
    ACL: "public-read",
    ContentType: file.mimetype,
  };

  try {
    await s3Client.send(new PutObjectCommand(objectParams));

    const URL: string = constants.OCI_S3_COMPATIBILITY.getObjectUrl(fileName);

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
    Bucket: constants.OCI_S3_COMPATIBILITY.BUCKET_NAME,
    Key: fileName,
    Body: file.buffer,
    ACL: "public-read",
    ContentType: file.mimetype,
  };

  try {
    await s3Client.send(new PutObjectCommand(objectParams));

    const URL: string = constants.OCI_S3_COMPATIBILITY.getObjectUrl(fileName);

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
    Bucket: constants.OCI_S3_COMPATIBILITY.BUCKET_NAME,
    Key: awsFileLocation,
  };

  try {
    await s3Client.send(new DeleteObjectCommand(params));
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to delete file from OCI: ${error.message}`);
    } else {
      throw new Error("Failed to delete file from OCI: Unknown error occurred");
    }
  }
};

export const uploadVendorAttachmentToS3 = async (req: any, res: any) => {
  const file = req.file;
  const docNo = req.body.doc_no;

  const fileName: string = `VendorDocument/${docNo}/${file.originalname}`;

  const objectParams: UploadToS3ObjectInterface = {
    Bucket: constants.OCI_S3_COMPATIBILITY.BUCKET_NAME,
    Key: fileName,
    Body: file.buffer,
    ACL: "public-read",
    ContentType: file.mimetype,
  };

  try {
    await s3Client.send(new PutObjectCommand(objectParams));

    const URL: string = constants.OCI_S3_COMPATIBILITY.getObjectUrl(fileName);

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
    Bucket: constants.OCI_S3_COMPATIBILITY.BUCKET_NAME,
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
    Bucket: constants.OCI_S3_COMPATIBILITY.BUCKET_NAME,
    Key: fileName,
    Body: file.buffer,
    ACL: "public-read",
    ContentType: file.mimetype,
  };

  try {
    await s3Client.send(new PutObjectCommand(objectParams));

    const URL: string = constants.OCI_S3_COMPATIBILITY.getObjectUrl(fileName);

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
    Bucket: constants.OCI_S3_COMPATIBILITY.BUCKET_NAME,
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
