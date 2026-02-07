import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import constants from "../helpers/constants";

// AWS S3 Client Configuration
const awsS3Client = new S3Client({
  region: constants.AWS_S3_CREDENTIALS.REGION,
  credentials: {
    accessKeyId: constants.AWS_S3_CREDENTIALS.ACCESS_KEY,
    secretAccessKey: constants.AWS_S3_CREDENTIALS.SECRET_ACCESS_KEY,
  },
});

/**
 * Generate a presigned URL for AWS S3 file access
 * @param s3Key - The S3 object key (file path)
 * @param expirationSeconds - URL expiration time in seconds (default: 3600 = 1 hour)
 * @returns Presigned URL
 */
export const generatePresignedUrl = async (
  s3Key: string,
  expirationSeconds: number = 3600
): Promise<string> => {
  try {
    const command = new GetObjectCommand({
      Bucket: constants.AWS_S3_CREDENTIALS.S3_BUCKET,
      Key: s3Key,
    });

    const presignedUrl = await getSignedUrl(awsS3Client, command, {
      expiresIn: expirationSeconds,
    });

    return presignedUrl;
  } catch (error) {
    throw new Error(`Failed to generate presigned URL: ${error}`);
  }
};

/**
 * Extract S3 key from public URL
 * Handles multiple URL formats:
 * - AWS: https://amls-uploadpms.s3.me-central-1.amazonaws.com/PMSFiles/...
 * - OCI: https://namespace.compat.objectstorage.region.oraclecloud.com/...
 * 
 * Returns: PMSFiles/...
 */
export const extractS3KeyFromUrl = (publicUrl: string): string => {
  try {
    if (!publicUrl) {
      throw new Error("URL cannot be empty");
    }

    // AWS S3 URL pattern
    const awsMatch = publicUrl.match(
      /https:\/\/[^.]+\.s3\.[^.]+\.amazonaws\.com\/(.+)$/
    );
    if (awsMatch && awsMatch[1]) {
      return decodeURIComponent(awsMatch[1]);
    }

    // OCI S3 compatible URL pattern
    const ociMatch = publicUrl.match(
      /https:\/\/[^.]+\.compat\.objectstorage\.[^.]+\.oraclecloud\.com\/[^/]+\/(.+)$/
    );
    if (ociMatch && ociMatch[1]) {
      return decodeURIComponent(ociMatch[1]);
    }

    throw new Error(
      `Invalid S3 URL format: ${publicUrl}. Expected AWS or OCI format.`
    );
  } catch (error) {
    throw new Error(`Failed to extract S3 key from URL: ${error}`);
  }
};

/**
 * Get S3 key from database record
 * Handles both:
 * - New format: S3_KEY column stores "PMSFiles/..."
 * - New storage: AWS_FILE_LOCN stores just the S3 key "PMSFiles/..."
 * - Old format: AWS_FILE_LOCN stores full URL, extract key from it
 */
export const getS3KeyFromRecord = (record: any): string | null => {
  try {
    // Option 1: Use S3_KEY if it's already populated (new format)
    if (record.s3Key || record.S3_KEY) {
      return record.s3Key || record.S3_KEY;
    }

    // Option 2: Extract from AWS_FILE_LOCN (supports both S3 key and full URL)
    if (record.awsFileLocn || record.AWS_FILE_LOCN) {
      const value = record.awsFileLocn || record.AWS_FILE_LOCN;
      
      // Check if it's already an S3 key (doesn't start with http)
      if (!value.startsWith('http')) {
        console.log('AWS_FILE_LOCN is already an S3 key:', value);
        return value;
      }

      // It's a full URL, extract the key from it
      return extractS3KeyFromUrl(value);
    }

    return null;
  } catch (error) {
    console.error("Error getting S3 key from record:", error);
    return null;
  }
};

/**
 * Batch generate presigned URLs for multiple files
 */
export const generatePresignedUrlBatch = async (
  s3Keys: string[],
  expirationSeconds: number = 3600
): Promise<Record<string, string>> => {
  const urlMap: Record<string, string> = {};

  for (const key of s3Keys) {
    try {
      urlMap[key] = await generatePresignedUrl(key, expirationSeconds);
    } catch (error) {
      console.error(`Failed to generate presigned URL for key: ${key}`, error);
      urlMap[key] = ""; // Mark as failed
    }
  }

  return urlMap;
};

/**
 * Get presigned URL expiration time configuration
 */
export const getPresignedUrlConfig = () => {
  return {
    shortTerm: 900, // 15 minutes for sensitive operations
    standard: 3600, // 1 hour (default)
    longTerm: 86400, // 24 hours for batch downloads
  };
};

/**
 * Validate S3 key format
 */
export const isValidS3Key = (s3Key: string): boolean => {
  if (!s3Key || typeof s3Key !== "string") {
    return false;
  }
  // S3 key should have at least one character and not start with /
  return s3Key.length > 0 && !s3Key.startsWith("/");
};

/**
 * Migration helper: Check if record needs S3_KEY migration
 */
export const needsS3KeyMigration = (record: any): boolean => {
  const hasS3Key = record.s3Key || record.S3_KEY;
  const hasPublicUrl = record.awsFileLocn || record.AWS_FILE_LOCN;
  return hasPublicUrl && !hasS3Key;
};
