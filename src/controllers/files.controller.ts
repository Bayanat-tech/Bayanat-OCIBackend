import { FilesVHService } from "../services/filesVH.service";
import {FilesVendorService} from "../services/filesVendor.service";
import { Response } from "express";
import { RequestWithUser } from "../interfaces/common.interface";
import constants from "../helpers/constants";
import { oracleDb } from "../database/connection";
import { FilesPFService } from "../services/filesPF.service";

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

    // send response
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
    const { modules } = req.query;

    if (!request_number) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.BAD_REQUEST,
      });
      return;
    }

    const conditions = {
      request_number,
      modules: modules || "vendor",
      company_code: req.user.company_code,
    };

    console.log("Searching with conditions:", conditions);

    const files = await filesVendorService.findAll(conditions);

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
    console.error("Error in getHrVendorFiles:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to retrieve files",
      error: error.message,
    });
  }
};

// export const editHrVendorFiles = async (
//   req: RequestWithUser,
//   res: Response
// ): Promise<void> => {
//   try {
//     const { aws_file_locn, request_number, user_file_name } = req.body;

//     const result = await filesVendorService.update(
//       {
//         awsFileLocn: aws_file_locn,
//         requestNumber: request_number,
//       },
//       {
//         userFileName: user_file_name,
//       }
//     );

//     if (result.affected === 0) {
//       res.status(constants.STATUS_CODES.NOT_FOUND).json({
//         success: false,
//         message: constants.MESSAGES.FILE_NOT_FOUND,
//       });
//       return;
//     }

//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       message: "File name updated successfully",
//     });
//   } catch (error: any) {
//     console.error("Error in editHrVendorFiles:", error);
//     res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };

// export const deleteHrVendorFiles = async (
//   req: RequestWithUser,
//   res: Response
// ): Promise<void> => {
//   try {
//     const { request_number, sr_no } = req.params;
//     console.log("Deleting file:", { request_number, sr_no });

//     if (!request_number) {
//       res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//         success: false,
//         message: constants.MESSAGES.BAD_REQUEST,
//       });
//       return;
//     }

//     const file = await filesVendorService.findOne({
//       requestNumber: request_number,
//       srNo: sr_no,
//     });

//     if (!file) {
//       res.status(constants.STATUS_CODES.NOT_FOUND).json({
//         success: false,
//         message: constants.MESSAGES.FILE_NOT_FOUND,
//       });
//       return;
//     }

//     const result = await filesVHService.delete({
//       requestNumber: request_number,
//       srNo: sr_no,
//     });

//     if (result.affected === 0) {
//       res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//         success: false,
//         message: "Delete operation failed",
//       });
//       return;
//     }

//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       message: constants.MESSAGES.DELETED_SUCCESSFULLY,
//     });
//   } catch (error: any) {
//     console.error("Error in deleteHrVendorFiles:", error);
//     res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };
export const editHrVendorFiles = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { 
      aws_file_locn, 
      request_number, 
      user_file_name,
      sr_no,           // Add SR_NO for specificity
      attachment_sr_no // Add ATTACHMENT_SR_NO for more specificity
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

    if (!request_number || !sr_no) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "request_number and sr_no are required",
      });
      return;
    }

    const conditions: any = {
      requestNumber: request_number,
      srNo: parseInt(sr_no),
      companyCode: req.user.company_code,
    };

    // Optional modules filter
    if (modules) {
      conditions.modules = modules;
    }

    console.log("Searching files by SR_NO with conditions:", conditions);

    const files = await filesVendorService.findAll(conditions);

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: files || [],
      message: files && files.length > 0 
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

    const conditions: any = {
      requestNumber: request_number,
      companyCode: req.user.company_code,
    };

    // Optional modules filter
    if (modules) {
      conditions.modules = modules;
    }

    console.log("Searching all vendor files with conditions:", conditions);

    const files = await filesVendorService.findAll(conditions);

    // Group files by SR_NO for better organization
    const groupedFiles = (files || []).reduce((acc: any, file: any) => {
      const srNo = file.srNo || 0;
      if (!acc[srNo]) {
        acc[srNo] = [];
      }
      acc[srNo].push(file);
      return acc;
    }, {});

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: {
        allFiles: files || [],
        groupedBySrNo: groupedFiles,
        statistics: {
          totalFiles: (files || []).length,
          filesBySrNo: Object.keys(groupedFiles).reduce((acc: any, srNo) => {
            acc[`SR_${srNo}`] = groupedFiles[srNo].length;
            return acc;
          }, {}),
          globalFiles: groupedFiles[0]?.length || 0,
          itemFiles: Object.keys(groupedFiles)
            .filter(srNo => srNo !== '0')
            .reduce((sum, srNo) => sum + groupedFiles[srNo].length, 0)
        }
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

    // Build query conditions based on what's provided
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