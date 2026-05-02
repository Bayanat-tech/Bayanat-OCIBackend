import { RequestWithUser } from "../../interfaces/common.interface";
import {BTFilesVHService} from '../service/BTfilesVH.service'
import { Response } from "express";
import constants from "../../helpers/constants";


let BTfilesVHService: BTFilesVHService;

(async () => {
  BTfilesVHService = await BTFilesVHService.getInstance();
})().catch(console.error);

export const BTgetEmployeeFiles = async (
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

    const files = await BTfilesVHService.findAll(conditions);

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

export const BTeditEmployeeFiles = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { aws_file_locn, request_number, user_file_name } = req.body;

    const result = await BTfilesVHService.update(
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
export const BTdeleteEmployeeFiles = async (
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

    const file = await BTfilesVHService.findOne({
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

    const result = await BTfilesVHService.delete({
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