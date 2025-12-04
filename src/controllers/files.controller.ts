import { FilesVHService } from "../services/filesVH.service";
import { Response } from "express";
import { RequestWithUser } from "../interfaces/common.interface";
import constants from "../helpers/constants";
import { oracleDb } from "../database/connection";
import { FilesPFService } from "../services/filesPF.service";

let filesVHService: FilesVHService;
let filesPFService: FilesPFService;

// Initialize service
(async () => {
  filesVHService = await FilesVHService.getInstance();
})().catch(console.error);

// Initialize service for PF files
(async () => {
  filesPFService = await FilesPFService.getInstance();
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
    // get request_number and aws_file_locn from req.body
    const { aws_file_locn, request_number, user_file_name } = req.body;
    // get user_file_name from req.query and ensure it's a string
    console.log(user_file_name, aws_file_locn, request_number);
    // execute direct SQL update query
    const [updateCount] = await oracleDb.query(
      `UPDATE UPLOADED_FILES_DLTS 
       SET user_file_name = :user_file_name 
       WHERE aws_file_locn = :aws_file_locn AND request_number = :request_number`,
      {
        replacements: { user_file_name, aws_file_locn, request_number },
      }
    );

    // check if any rows were updated
    if (Number(updateCount) === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.FILE_NOT_FOUND,
      });
      return;
    }

    // send response with direct success message
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

    const result = await filesVHService.delete({ request_number, sr_no });

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

export const deleteHrVendorFiles = async (
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