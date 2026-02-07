import { FilesVHService } from "../services/filesVH.service";
import {FilesVendorService} from "../services/filesVendor.service";
import { Response } from "express";
import { RequestWithUser } from "../interfaces/common.interface";
import constants from "../helpers/constants";
import { oracleDb } from "../database/connection";
import { FilesPFService } from "../services/filesPF.service";
import { generatePresignedUrl, extractS3KeyFromUrl, generatePresignedUrlBatch, getS3KeyFromRecord } from "../services/presignedUrlHelper";

let filesVHService: FilesVHService;
let filesPFService: FilesPFService;
let filesVendorService: FilesVendorService;

// Initialize service
(async () => {
  filesVHService = await FilesVHService.getInstance();
})().catch(console.error);

// Initialize service for PF files
(async () => {
  filesPFService = await FilesPFService.getInstance();
})().catch(console.error);

// Initialize service for Vendor files
(async () => {
  filesVendorService = await FilesVendorService.getInstance();
})().catch(console.error);

export const getFiles = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { request_number } = req.params;

    const { modules } = req.query;

    if (request_number === undefined) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: true,
        message: constants.MESSAGES.BAD_REQUEST,
      });
      return;
    }

    const conditions =
      modules === "IMPORT"
        ? { modules, request_number }
        : { company_code: req.user.company_code, request_number };

    const files = await filesVHService.findAll(conditions);

    // send response
    res.status(constants.STATUS_CODES.OK).json({ success: true, data: files });

    return;
  } catch (error: any) {
    // handle error
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};

export const getpfFiles = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { request_number } = req.params;

    const { modules } = req.query;

    if (request_number === undefined) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: true,
        message: constants.MESSAGES.BAD_REQUEST,
      });
      return;
    }

    const conditions =
      modules === "IMPORT"
        ? { modules, request_number }
        : { company_code: req.user.company_code, request_number };

    const files = await filesPFService.findAll(conditions);

    // send response
    res.status(constants.STATUS_CODES.OK).json({ success: true, data: files });

    return;
  } catch (error: any) {
    // handle error
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};

export const editFiles = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    // get request_number from req.params
    const { aws_file_locn } = req.body;
    // get modules from req.query
    const { user_file_name } = req.query;

    const result = await filesVHService.update(
      { aws_file_locn },
      { user_file_name }
    );

    if (result.affected === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.FILE_NOT_FOUND,
      });
      return;
    }

    
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "File name updated successfully",
    });

    return;
  } catch (error: any) {
    // handle error
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};

export const editPFFiles = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { aws_file_locn, request_number, user_file_name } = req.body;
    console.log(user_file_name, aws_file_locn, request_number);

    const sql = `
      UPDATE UPLOADED_FILES_DLTS
      SET user_file_name = :user_file_name
      WHERE aws_file_locn = :aws_file_locn
        AND request_number = :request_number
    `;
    const binds = {
      user_file_name,
      aws_file_locn,
      request_number,
    };

    const result: any = await oracleDb.query(sql, binds);
    const affected = result.rowsAffected ?? 0;

    if (Number(affected) === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.FILE_NOT_FOUND,
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "File name updated successfully",
    });

    return;
  } catch (error: any) {
    console.error("editPFFiles error:", error);
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};

export const deleteFiles = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { request_number, sr_no } = req.params;

    if (request_number === undefined) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: true,
        message: constants.MESSAGES.BAD_REQUEST,
      });
      return;
    }

    const result = await filesVHService.delete({
      company_code: req.user.company_code,
      request_number,
      sr_no,
    });

    if (result.affected === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Delete operation failed",
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.DELETED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    // handle error
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};


export const deleteFilesPF = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { request_number, sr_no } = req.params;

    if (request_number === undefined) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: true,
        message: constants.MESSAGES.BAD_REQUEST,
      });
      return;
    }

    // query to find the file details
    const file = await filesPFService.findOne({ request_number, sr_no });

    if (!file) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.FILE_NOT_FOUND,
      });
      return;
    }

    const result = await filesPFService.delete({ request_number, sr_no });

    if (result.affected === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Delete operation failed",
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.DELETED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};

//vendor and HR file attachment
export const getHrVendorFiles = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { request_number } = req.params;
    const { sr_no } = req.query;

    if (!request_number) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.BAD_REQUEST,
      });
      return;
    }

    // Build SQL with optional SR_NO filter
    let sql = `
      SELECT 
        COMPANY_CODE as "companyCode",
        REQUEST_NUMBER as "requestNumber",
        SR_NO as "srNo",
        ATTACHMENT_SR_NO as "attachmentSrNo",
        FILE_NAME as "fileName",
        ORG_FILE_NAME as "orgFileName",
        AWS_FILE_LOCN as "awsFileLocn",
        FLOW_LEVEL as "flowLevel",
        MODULES as "modules",
        UPDATED_AT as "updatedAt",
        UPDATED_BY as "updatedBy",
        CREATED_BY as "createdBy",
        CREATED_AT as "createdAt",
        EXTENSIONS as "extensions",
        USER_FILE_NAME as "userFileName",
        TYPE as "type",
        FILE_TRANSFER as "fileTransfer"
      FROM UPLOADED_FILES_DLTS_VENDOR
      WHERE REQUEST_NUMBER = :request_number
        AND COMPANY_CODE = :company_code
    `;

    const binds: any = {
      request_number: { val: request_number },
      company_code: { val: req.user.company_code },
    };

    if (sr_no !== undefined && sr_no !== null && String(sr_no).trim() !== "") {
      sql += " AND SR_NO = :sr_no";
      binds.sr_no = { val: Number(sr_no) };
    }

    sql += " ORDER BY ATTACHMENT_SR_NO ASC, CREATED_AT DESC";

    console.log("Executing getHrVendorFiles SQL:", { sql, binds });
    const result = await oracleDb.query(sql, binds);
    const files = result.rows || [];

    if (!files || files.length === 0) {
      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        data: [],
        message: "No files found for the given request number",
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: files,
      message: "Files retrieved successfully",
    });
    return;
  } catch (error: any) {
    console.error("Error in getHrVendorFiles:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to retrieve files",
      error: error.message,
    });
  }
};

export const editHrVendorFiles = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { 
      aws_file_locn, 
      request_number, 
      user_file_name,
      sr_no,          
      attachment_sr_no 
    } = req.body;

    // Build WHERE conditions
    const whereConditions: any = {
      awsFileLocn: aws_file_locn,
      requestNumber: request_number,
    };

    // Add SR_NO if provided
    if (sr_no !== undefined) {
      whereConditions.srNo = sr_no;
    }

    // Add ATTACHMENT_SR_NO if provided
    if (attachment_sr_no !== undefined) {
      whereConditions.attachmentSrNo = attachment_sr_no;
    }

    const result = await filesVendorService.update(
      whereConditions,
      {
        userFileName: user_file_name,
      }
    );

    if (result.affected === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.FILE_NOT_FOUND,
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "File name updated successfully",
    });
  } catch (error: any) {
    console.error("Error in editHrVendorFiles:", error);
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message,
    });
  }
};

export const getFilesBySrNo = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { request_number, sr_no } = req.params;
    const { modules } = req.query;
    console.log("Fetching files for:", { request_number, sr_no, modules });

    if (!request_number || !sr_no) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "request_number and sr_no are required",
      });
      return;
    }

    // Use raw SQL with correct column names
    const query = `
      SELECT 
        COMPANY_CODE as "companyCode",
        REQUEST_NUMBER as "requestNumber",
        SR_NO as "srNo",
        ATTACHMENT_SR_NO as "attachmentSrNo",
        FILE_NAME as "fileName",
        ORG_FILE_NAME as "orgFileName",
        AWS_FILE_LOCN as "awsFileLocn",
        FLOW_LEVEL as "flowLevel",
        MODULES as "modules",
        UPDATED_AT as "updatedAt",
        UPDATED_BY as "updatedBy",
        CREATED_BY as "createdBy",
        CREATED_AT as "createdAt",
        EXTENSIONS as "extensions",
        USER_FILE_NAME as "userFileName",
        TYPE as "type",
        FILE_TRANSFER as "fileTransfer"
      FROM UPLOADED_FILES_DLTS_VENDOR 
      WHERE REQUEST_NUMBER = :request_number 
        AND SR_NO = :sr_no
        AND COMPANY_CODE = :company_code
        ${modules ? "AND MODULES = :modules" : ""}
      ORDER BY ATTACHMENT_SR_NO ASC, CREATED_AT DESC
    `;
    
    const params: any = {
      request_number: { val: request_number },
      sr_no: { val: parseInt(sr_no) },
      company_code: { val: req.user.company_code }
    };
    
    if (modules) {
      params.modules = { val: modules };
    }
    
    const result = await oracleDb.query(query, params);
    const files = result.rows || [];

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: files,
      message: files.length > 0 
        ? "Files retrieved successfully" 
        : "No files found for the given request number and SR_NO",
    });
    
  } catch (error: any) {
    console.error("Error in getFilesBySrNo:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to retrieve files by SR_NO",
      error: error.message,
    });
  }
};
export const getAllVendorFiles = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { request_number } = req.params;
    const { modules } = req.query;

    if (!request_number) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "request_number is required",
      });
      return;
    }

    const sql = `
      SELECT
        COMPANY_CODE as "companyCode",
        REQUEST_NUMBER as "requestNumber",
        NVL(SR_NO,0) as "srNo",
        ATTACHMENT_SR_NO as "attachmentSrNo",
        FILE_NAME as "fileName",
        ORG_FILE_NAME as "orgFileName",
        AWS_FILE_LOCN as "awsFileLocn",
        FLOW_LEVEL as "flowLevel",
        MODULES as "modules",
        UPDATED_AT as "updatedAt",
        UPDATED_BY as "updatedBy",
        CREATED_BY as "createdBy",
        CREATED_AT as "createdAt",
        EXTENSIONS as "extensions",
        USER_FILE_NAME as "userFileName",
        TYPE as "type",
        FILE_TRANSFER as "fileTransfer"
      FROM UPLOADED_FILES_DLTS_VENDOR
      WHERE REQUEST_NUMBER = :request_number
        AND COMPANY_CODE = :company_code
        ${modules ? "AND MODULES = :modules" : ""}
      ORDER BY NVL(SR_NO,0) ASC, NVL(ATTACHMENT_SR_NO,0) ASC, CREATED_AT DESC
    `;

    const binds: any = {
      request_number: { val: request_number },
      company_code: { val: req.user.company_code },
    };
    if (modules) binds.modules = { val: modules };

    console.log("Executing getAllVendorFiles SQL:", { sql, binds });
    const result = await oracleDb.query(sql, binds);
    const files = result.rows || [];

    const groupedFiles = (files || []).reduce((acc: any, file: any) => {
      const srNo = Number(file.srNo ?? 0);
      if (!acc[srNo]) acc[srNo] = [];
      acc[srNo].push(file);
      return acc;
    }, {} as Record<number, any[]>);

    const filesBySrNo: Record<string, number> = {};
    let globalFiles = groupedFiles[0]?.length || 0;
    let itemFiles = 0;
    for (const [k, arr] of Object.entries(groupedFiles) as [string, any[]][]) {
      filesBySrNo[`SR_${k}`] = arr.length;
      if (Number(k) !== 0) itemFiles += arr.length;
    }
    
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: {
        allFiles: files,
        groupedBySrNo: groupedFiles,
        statistics: {
          totalFiles: files.length,
          filesBySrNo,
          globalFiles,
          itemFiles,
        },
      },
      message: "All vendor files retrieved successfully",
    });
     
   } catch (error: any) {
     console.error("Error in getAllVendorFiles:", error);
     res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
       success: false,
       message: "Failed to retrieve all vendor files",
       error: error.message,
     });
   }
 };

export const deleteHrVendorFiles = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { request_number, sr_no, attachment_sr_no } = req.params;
    console.log("Deleting file:", { request_number, sr_no, attachment_sr_no });

    if (!request_number) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.BAD_REQUEST,
      });
      return;
    }
    
    const conditions: any = {
      requestNumber: request_number,
    };

    if (sr_no !== undefined) {
      conditions.srNo = sr_no;
    }

    if (attachment_sr_no !== undefined) {
      conditions.attachmentSrNo = attachment_sr_no;
    }

    const file = await filesVendorService.findOne(conditions);

    if (!file) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.FILE_NOT_FOUND,
      });
      return;
    }

    const result = await filesVendorService.delete(conditions);

    if (result.affected === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Delete operation failed",
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.DELETED_SUCCESSFULLY,
    });
  } catch (error: any) {
    console.error("Error in deleteHrVendorFiles:", error);
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message,
    });
  }
};
export const getEmployeeFiles = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    let { request_number } = req.params;
    const { modules } = req.query;

    request_number = decodeURIComponent(request_number);

    if (!request_number) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.BAD_REQUEST,
      });
      return;
    }

    const conditions = {
      request_number, 
      modules: (modules as string) || "hr",
      company_code: req.user.company_code,
    };

    console.log("Searching with conditions:", conditions);

    const files = await filesVHService.findAll(conditions);

    // Handle no records found
    if (!files || files.length === 0) {
      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        data: [],
        message: "No files found for the given request number",
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: files,
      message: "Files retrieved successfully",
    });
    return;
  } catch (error: any) {
    console.error("Error in getEmployeeFiles:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to retrieve files",
      error: error.message,
    });
  }
};

export const editEmployeeFiles = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { aws_file_locn, request_number, user_file_name } = req.body;

    const result = await filesVHService.update(
      {
        awsFileLocn: aws_file_locn,
        requestNumber: request_number,
      },
      {
        userFileName: user_file_name,
      }
    );

    if (result.affected === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.FILE_NOT_FOUND,
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "File name updated successfully",
    });
  } catch (error: any) {
    console.error("Error in editHrVendorFiles:", error);
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message,
    });
  }
};
export const deleteEmployeeFiles = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { request_number, sr_no } = req.params;
    console.log("Deleting file:", { request_number, sr_no });

    if (!request_number) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.BAD_REQUEST,
      });
      return;
    }

    const file = await filesVHService.findOne({
      requestNumber: request_number,
      srNo: sr_no,
    });

    if (!file) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.FILE_NOT_FOUND,
      });
      return;
    }

    const result = await filesVHService.delete({
      requestNumber: request_number,
      srNo: sr_no,
    });

    if (result.affected === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Delete operation failed",
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.DELETED_SUCCESSFULLY,
    });
  } catch (error: any) {
    console.error("Error in deleteHriles:", error);
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get presigned URLs for PF files (for secure access)
 * Frontend can use these temporary URLs to download files
 * Works with both old (public URL) and new (S3_KEY) formats
 */
export const getPFFilesPresignedUrls = async (
  res: Response
): Promise<void> => {
  try {
    const { request_number } = req.params;
    const { modules } = req.query;

    if (!request_number) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "request_number is required",
      });
      return;
    }

    const conditions =
      modules === "IMPORT"
        ? { modules, request_number }
        : { company_code: req.user.company_code, request_number };

    const files = await filesPFService.findAll(conditions);

    if (!files || files.length === 0) {
      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        data: [],
        message: "No files found",
      });
      return;
    }

    // Generate presigned URLs for each file
    const filesWithPresignedUrls = await Promise.all(
      files.map(async (file: any) => {
        try {
          // Get S3 key from record (supports both old and new formats)
          const s3Key = getS3KeyFromRecord(file);
          
          if (!s3Key) {
            return {
              ...file,
              presignedUrl: null,
              error: "Failed to extract S3 key from file record",
            };
          }

          const presignedUrl = await generatePresignedUrl(s3Key, 3600);

          return {
            ...file,
            presignedUrl,
            publicUrl: file.awsFileLocn, 
          };
        } catch (error) {
          console.error(`Error generating presigned URL for file: ${file.fileName}`, error);
          return {
            ...file,
            presignedUrl: null,
            error: "Failed to generate presigned URL",
          };
        }
      })
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: filesWithPresignedUrls,
      message: "Files with presigned URLs retrieved successfully",
    });
  } catch (error: any) {
    console.error("Error in getPFFilesPresignedUrls:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to retrieve files with presigned URLs",
      error: error.message,
    });
  }
};

/**
 * Generate presigned URL on demand for a single file
 * Supports both S3_KEY and public URL formats
 */
export const generatePresignedUrlForFile = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { publicUrl, s3Key } = req.body;

    let finalS3Key: string | null = null;

    // If S3_KEY is provided, use it directly
    if (s3Key) {
      finalS3Key = s3Key;
    }
    // Otherwise, extract from public URL
    else if (publicUrl) {
      try {
        finalS3Key = extractS3KeyFromUrl(publicUrl);
      } catch (error) {
        res.status(constants.STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: "Invalid public URL format",
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    } else {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Either publicUrl or s3Key is required",
      });
      return;
    }

    if (!finalS3Key) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Failed to extract S3 key",
      });
      return;
    }

    const presignedUrl = await generatePresignedUrl(finalS3Key, 3600); // 1 hour expiration

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: {
        presignedUrl,
        expiresIn: 3600, // 1 hour in seconds
        originalUrl: publicUrl || null,
        s3Key: finalS3Key,
      },
      message: "Presigned URL generated successfully",
    });
  } catch (error: any) {
    console.error("Error in generatePresignedUrlForFile:", error);
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message,
    });
  }
};