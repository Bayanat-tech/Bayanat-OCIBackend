import { FilesVHService } from "../services/filesVH.service";
import {FilesVendorService} from "../services/filesVendor.service";
import { Response } from "express";
import { RequestWithUser } from "../interfaces/common.interface";
import constants from "../helpers/constants";
import { oracleDb } from "../database/connection";
import { QueryExecutor } from "../database/QueryExecutor";
import { FilesPFService } from "../services/filesPF.service";
import { FilesAFService } from "../services/accountfiles.service";
import { deleteFile, deleteFileFromS3 } from "../services/ociUpload.service";

let filesVHService: FilesVHService;
let filesPFService: FilesPFService;
let filesVendorService: FilesVendorService;
let filesAFService: FilesAFService;

function routeParamValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

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

// Initialize service for AF files
(async () => {
  filesAFService = await FilesAFService.getInstance();
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

export const getAfFiles = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { request_number } = req.params;

    const { modules } = req.query;
     console.log("--------------------get api hit-----------------")

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

    const files = await filesAFService.findAll(conditions);

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
      { awsFileLocn: aws_file_locn, },
      { userFileName:user_file_name }
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

    const result: any = await QueryExecutor.execMaybe(sql, binds);
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

export const editAFFiles = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { aws_file_locn, request_number, user_file_name } = req.body;
    console.log(user_file_name, aws_file_locn, request_number);

    const sql = `
      UPDATE ACCOUNTS_FILES
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

export const deleteFilesAF = async (
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
    const file = await filesAFService.findOne({ request_number, sr_no });

    if (!file) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.FILE_NOT_FOUND,
      });
      return;
    }

    if (file.awsFileLocn) {
  const key = getOCIObjectKey(file.awsFileLocn);
  await deleteFile(key);
}


    const result = await filesAFService.delete({ request_number, sr_no });

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
    const result = await QueryExecutor.execMaybe(sql, binds);
    const files = result.rows || result;

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
    
    const srNoValue = routeParamValue(sr_no);
    const params: any = {
      request_number: { val: request_number },
      sr_no: { val: parseInt(srNoValue, 10) },
      company_code: { val: req.user.company_code }
    };
    
    if (modules) {
      params.modules = { val: modules };
    }
    
    const result = await QueryExecutor.execMaybe(query, params);
    const files = result.rows || result;

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
    const result = await QueryExecutor.executeRawQuery(sql, binds);
    const files = result.rows || result || [];

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
    const selectSql = `
      SELECT AWS_FILE_LOCN
      FROM UPLOADED_FILES_DLTS_VENDOR
      WHERE REQUEST_NUMBER = :request_number
        AND COMPANY_CODE = :company_code
        AND NVL(SR_NO, 0) = :sr_no
        ${attachment_sr_no !== undefined ? "AND ATTACHMENT_SR_NO = :attachment_sr_no" : ""}
      FETCH FIRST 1 ROW ONLY
    `;

    const binds: any = {
      request_number: { val: request_number },
      company_code: { val: req.user.company_code },
      sr_no: { val: Number(sr_no || 0) },
    };
    if (attachment_sr_no !== undefined) {
      binds.attachment_sr_no = { val: Number(attachment_sr_no) };
    }

    const fileResult = await QueryExecutor.executeRawQuery(selectSql, binds);
    const file = fileResult.rows?.[0] || fileResult[0];

    if (!file) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.FILE_NOT_FOUND,
      });
      return;
    }

    const fileLocation = file.AWS_FILE_LOCN || file.awsFileLocn;
    if (fileLocation) {
      await deleteFileFromS3(fileLocation);
    }

    const deleteSql = `
      DELETE FROM UPLOADED_FILES_DLTS_VENDOR
      WHERE REQUEST_NUMBER = :request_number
        AND COMPANY_CODE = :company_code
        AND NVL(SR_NO, 0) = :sr_no
        ${attachment_sr_no !== undefined ? "AND ATTACHMENT_SR_NO = :attachment_sr_no" : ""}
    `;

    const result = await QueryExecutor.executeRawQuery(deleteSql, binds);

    if ((result.rowsAffected || 0) === 0) {
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

    request_number = decodeURIComponent(routeParamValue(request_number));

    if (!request_number) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.BAD_REQUEST,
      });
      return;
    }

    const sql = `
      SELECT
        COMPANY_CODE as "companyCode",
        REQUEST_NUMBER as "requestNumber",
        SR_NO as "srNo",
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
      FROM UPLOADED_FILES_DLTS_VH
      WHERE REQUEST_NUMBER = :request_number
        AND COMPANY_CODE = :company_code
        ${modules ? "AND MODULES = :modules" : ""}
      ORDER BY NVL(SR_NO, 0) ASC, CREATED_AT DESC
    `;

    const binds: any = {
      request_number: { val: request_number },
      company_code: { val: req.user.company_code },
    };
    if (modules) binds.modules = { val: String(modules) };

    const result = await QueryExecutor.executeRawQuery(sql, binds);
    const files = result.rows || result || [];

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

    const result = await QueryExecutor.executeRawQuery(
      `
        UPDATE UPLOADED_FILES_DLTS_VH
        SET USER_FILE_NAME = :user_file_name,
            UPDATED_AT = SYSDATE,
            UPDATED_BY = :updated_by
        WHERE REQUEST_NUMBER = :request_number
          AND COMPANY_CODE = :company_code
          AND AWS_FILE_LOCN = :aws_file_locn
      `,
      {
        user_file_name: { val: user_file_name },
        updated_by: { val: req.user.loginid || req.user.loginid1 || req.user.username || null },
        request_number: { val: request_number },
        company_code: { val: req.user.company_code },
        aws_file_locn: { val: aws_file_locn },
      }
    );

    if ((result.rowsAffected || 0) === 0) {
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

    const selectResult = await QueryExecutor.executeRawQuery(
      `
        SELECT AWS_FILE_LOCN
        FROM UPLOADED_FILES_DLTS_VH
        WHERE REQUEST_NUMBER = :request_number
          AND COMPANY_CODE = :company_code
          AND SR_NO = :sr_no
        FETCH FIRST 1 ROW ONLY
      `,
      {
        request_number: { val: request_number },
        company_code: { val: req.user.company_code },
        sr_no: { val: Number(sr_no) },
      }
    );
    const file = selectResult.rows?.[0] || selectResult[0];

    if (!file) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.FILE_NOT_FOUND,
      });
      return;
    }

    const fileLocation = file.AWS_FILE_LOCN || file.awsFileLocn;
    if (fileLocation) {
      await deleteFileFromS3(fileLocation);
    }

    const result = await QueryExecutor.executeRawQuery(
      `
        DELETE FROM UPLOADED_FILES_DLTS_VH
        WHERE REQUEST_NUMBER = :request_number
          AND COMPANY_CODE = :company_code
          AND SR_NO = :sr_no
      `,
      {
        request_number: { val: request_number },
        company_code: { val: req.user.company_code },
        sr_no: { val: Number(sr_no) },
      }
    );

    if ((result.rowsAffected || 0) === 0) {
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

function getOCIObjectKey(awsFileLocn: string): string {
  if (!awsFileLocn) {
    throw new Error("File location is missing");
  }

  // If already an object key
  if (!awsFileLocn.startsWith("http")) {
    return awsFileLocn;
  }

  const url = new URL(awsFileLocn);

  // pathname example:
  // /app-dev-bucket-test/Accounts/Cheque Payment/2026/2/2260100001/CATS.jpg
  const pathParts = url.pathname.split("/").filter(Boolean);

  // Remove bucket name
  pathParts.shift();

  return decodeURIComponent(pathParts.join("/"));
}
