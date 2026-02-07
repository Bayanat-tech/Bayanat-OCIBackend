import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import constants from "../helpers/constants";
import { UploadToS3ObjectInterface } from "../interfaces/common.interface";

// OCI S3 Client Configuration
const ociS3Client = new S3Client({
  region: constants.OCI_S3_COMPATIBILITY.REGION,
  endpoint: constants.OCI_S3_COMPATIBILITY.ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: constants.OCI_S3_COMPATIBILITY.ACCESS_KEY_ID,
    secretAccessKey: constants.OCI_S3_COMPATIBILITY.SECRET_ACCESS_KEY,
  },
});

// AWS S3 Client Configuration (for PF Module)
const awsS3Client = new S3Client({
  region: constants.AWS_S3_CREDENTIALS.REGION,
  credentials: {
    accessKeyId: constants.AWS_S3_CREDENTIALS.ACCESS_KEY,
    secretAccessKey: constants.AWS_S3_CREDENTIALS.SECRET_ACCESS_KEY,
  },
});

// Generic upload function for reusability
const uploadToS3Generic = async (
  s3Client: S3Client,
  bucketConfig: any,
  fileName: string,
  file: any
) => {
  // Support both OCI and AWS credential shapes
  const bucketName = bucketConfig.BUCKET_NAME || bucketConfig.S3_BUCKET;

  const objectParams: UploadToS3ObjectInterface = {
    Bucket: bucketName,
    Key: fileName,
    Body: file.buffer,
    ContentType: file.mimetype,
  };

  await s3Client.send(new PutObjectCommand(objectParams));

  // Return a public URL if helper exists, otherwise construct a reasonable URL
  if (typeof bucketConfig.getObjectUrl === 'function') {
    return bucketConfig.getObjectUrl(fileName);
  }

  if (typeof bucketConfig.AWS_S3_URL === 'function') {
    return bucketConfig.AWS_S3_URL(fileName);
  }

  // Fallback to standard AWS S3 URL format
  const region = bucketConfig.REGION || 'us-east-1';
  return `https://${bucketName}.s3.${region}.amazonaws.com/${fileName}`;
};

// Generate presigned URL for AWS S3 (temporary access)
const generateAWSPresignedUrl = async (
  bucketName: string,
  key: string,
  expirationSeconds: number = 3600 // Default 1 hour
): Promise<string> => {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  const presignedUrl = await getSignedUrl(awsS3Client, command, {
    expiresIn: expirationSeconds,
  });

  return presignedUrl;
};

// OCI - General file upload
export const uploadToS3 = async (req: any, res: any) => {
  const file = req.file;

  const fileName: string = `uploads/${new Date().getFullYear()}/${
    new Date().getMonth() + 1
  }/${file.originalname}`;

  try {
    const URL = await uploadToS3Generic(
      ociS3Client,
      constants.OCI_S3_COMPATIBILITY,
      fileName,
      file
    );

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

// AWS - Purchase Flow (PF) Module Upload - Returns presigned URL
export const uploadPFToS3 = async (req: any, res: any) => {
  const file = req.file;
  const requestNumber = req.body.request_number;
  const requestType = req.body.type;

  const fileName: string = `PMSFiles/${requestType}/${new Date().getFullYear()}/${
    new Date().getMonth() + 1
  }/${requestNumber}/${file.originalname}`;

  try {
    await uploadToS3Generic(
      awsS3Client,
      constants.AWS_S3_CREDENTIALS,
      fileName,
      file
    );

    // Generate presigned URL for AWS S3
    const presignedUrl = await generateAWSPresignedUrl(
      constants.AWS_S3_CREDENTIALS.S3_BUCKET,
      fileName,
      3600 // 1 hour expiration
    );

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: {
        presignedUrl: presignedUrl,
        s3Key: fileName,
        fileName: fileName
      }
    });
  } catch (error: any) {
    return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message,
    });
  }
};

// Get presigned URL for existing AWS S3 file (for reading stored files)
export const getAWSPresignedUrl = async (req: any, res: any) => {
  try {
    const { s3Key } = req.body;

    if (!s3Key) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "s3Key is required",
      });
    }

    const presignedUrl = await generateAWSPresignedUrl(
      constants.AWS_S3_CREDENTIALS.S3_BUCKET,
      s3Key,
      3600 // 1 hour expiration
    );

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: presignedUrl,
      expiresIn: 3600,
    });
  } catch (error: any) {
    return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message,
    });
  }
};

// OCI - Delete file
export const deleteFileFromS3 = async (awsFileLocation: string) => {
  const params = {
    Bucket: constants.OCI_S3_COMPATIBILITY.BUCKET_NAME,
    Key: awsFileLocation,
  };

  try {
    await ociS3Client.send(new DeleteObjectCommand(params));
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to delete file from OCI: ${error.message}`);
    } else {
      throw new Error("Failed to delete file from OCI: Unknown error occurred");
    }
  }
};

// OCI - Vendor Attachment Upload
export const uploadVendorAttachmentToS3 = async (req: any, res: any) => {
  const file = req.file;
  const docNo = req.body.doc_no;

  const fileName: string = `VendorDocument/${docNo}/${file.originalname}`;

  try {
    const URL = await uploadToS3Generic(
      ociS3Client,
      constants.OCI_S3_COMPATIBILITY,
      fileName,
      file
    );

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

// OCI - Delete Vendor Attachment
export const deleteVendorAttachmentFromS3 = async (req: any, res: any) => {
  const docNo = req.params.doc_no;
  const fileName = `VendorDocument/${docNo}`;

  const params = {
    Bucket: constants.OCI_S3_COMPATIBILITY.BUCKET_NAME,
    Key: fileName,
  };

  try {
    await ociS3Client.send(new DeleteObjectCommand(params));
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

// OCI - Employee Attachment Upload
export const uploadEmployeeAttachmentToS3 = async (req: any, res: any) => {
  const file = req.file;
  const requestNumber = req.body.request_number;

  const fileName: string = `LeaveDocument/${requestNumber}/${file.originalname}`;

  try {
    const URL = await uploadToS3Generic(
      ociS3Client,
      constants.OCI_S3_COMPATIBILITY,
      fileName,
      file
    );

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

// OCI - Delete Employee Attachment
export const deleteEmployeeAttachmentFromS3 = async (req: any, res: any) => {
  const empId = req.params.emp_id;
  const fileName = `LeaveDocument/${empId}`;

  const params = {
    Bucket: constants.OCI_S3_COMPATIBILITY.BUCKET_NAME,
    Key: fileName,
  };

  try {
    await ociS3Client.send(new DeleteObjectCommand(params));
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
