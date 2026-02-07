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

// AWS S3 client for PF module uploads (uses standard AWS credentials)
let awsS3Client: S3Client | null = null;
if (constants.AWS_S3_CREDENTIALS && constants.AWS_S3_CREDENTIALS.ACCESS_KEY) {
  awsS3Client = new S3Client({
    region: constants.AWS_S3_CREDENTIALS.REGION,
    credentials: {
      accessKeyId: constants.AWS_S3_CREDENTIALS.ACCESS_KEY,
      secretAccessKey: constants.AWS_S3_CREDENTIALS.SECRET_ACCESS_KEY,
    },
  });
}

export const uploadToS3 = async (req: any, res: any) => {
  const file = req.file;

  const fileName: string = `uploads/${new Date().getFullYear()}/${
    new Date().getMonth() + 1
  }/${file.originalname}`;

  const objectParams: UploadToS3ObjectInterface = {
    Bucket: constants.OCI_S3_COMPATIBILITY.BUCKET_NAME,
    Key: fileName,
    Body: file.buffer,
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

  const fileName: string = `PMSFiles/${requestType}/${new Date().getFullYear()}/${
    new Date().getMonth() + 1
  }/${requestNumber}/${file.originalname}`;
  
  if (!awsS3Client) {
    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'AWS S3 client not configured for PF uploads',
    });
  }
  
  try {
    const awsParams = {
      Bucket: constants.AWS_S3_CREDENTIALS.S3_BUCKET,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    await awsS3Client.send(new PutObjectCommand(awsParams));

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

// Delete PF file from AWS S3 (PF uploads use AWS S3)
export const deletePFFromS3 = async (awsFileLocation: string) => {
  if (!awsS3Client) {
    throw new Error("AWS S3 client not configured for PF uploads");
  }

  if (!awsFileLocation) return;

  // awsFileLocation may be a full URL or a key. Try to extract the key.
  const awsBaseUrl = process.env.AWS_S3_URL ? String(process.env.AWS_S3_URL) : "";
  let key = awsFileLocation;

  if (awsBaseUrl && awsFileLocation.startsWith(awsBaseUrl)) {
    key = awsFileLocation.substring(awsBaseUrl.length + (awsBaseUrl.endsWith("/") ? 0 : 1));
  } else {
    // If URL contains the bucket name, strip up to and including the bucket name
    const bucketName = constants.AWS_S3_CREDENTIALS.S3_BUCKET;
    const idx = awsFileLocation.indexOf(bucketName);
    if (idx !== -1) {
      key = awsFileLocation.substring(idx + bucketName.length + 1);
    }
  }

  const params = {
    Bucket: constants.AWS_S3_CREDENTIALS.S3_BUCKET,
    Key: key,
  };

  try {
    await awsS3Client.send(new DeleteObjectCommand(params));
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to delete PF file from AWS S3: ${error.message}`);
    } else {
      throw new Error("Failed to delete PF file from AWS S3: Unknown error occurred");
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
