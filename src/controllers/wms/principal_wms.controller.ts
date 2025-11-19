// Import required dependencies
import { Response } from "express";
import * as fastCsv from "fast-csv";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import { principalSchema } from "../../validation/wms/gm.validation";
// import { IPrincipalWms } from "../../interfaces/wms/principal_wms.interface";
import WmsCsvHeaders from "../../utils/exportCsv/WmsCsvHeaders";
import { PrincipalService } from "../../services/WMS/principal.service";
import { PrincipalContactDetlService } from "../../services/WMS/principalcontactdetl.service";
import { UploadedFilesDltsService } from "../../services/WMS/principalfile.service";

/**
 * Creates a new principal record with contact details and files
 * @param req Request object containing principal data
 * @param res Response object
 */
export const createPrincipal = async (req: RequestWithUser, res: Response) => {
  try {
    // Validate request data
    const requestUser = req.user;
    const { error } = principalSchema(
      req.body,
      requestUser.company_code,
      false
    );
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    // Destructure request body
    const {
        prin_cont1,
        prin_cont2,
        prin_cont3,
        prin_cont_email1,
        prin_cont_email2,
        prin_cont_email3,
        prin_cont_telno1,
        prin_cont_telno2,
        prin_cont_telno3,
        prin_cont_faxno1,
        prin_cont_faxno2,
        prin_cont_faxno3,
        prin_cont_ref1,
        files,
        ...prinicipalPayload
      } = req.body,
      created_by = requestUser.loginid,
      updated_by = requestUser.loginid;

    // Ensure prin_code is not null
    if (!prinicipalPayload.prin_code) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Principal code is required",
      });
      return;
    }

    // Remove user_date if present in payload
    // if ('user_dt' in prinicipalPayload) {
    //   delete prinicipalPayload.user_date;
    // }

    // Debug log for payload
    // console.log("Principal Payload:", prinicipalPayload);

    // Check for duplicate principal
    const existingPrincipal = await PrincipalService.findDuplicate({
      prin_code: prinicipalPayload.prin_code,
      prin_name: prinicipalPayload.prin_name,
    });

    if (existingPrincipal) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Principal already exists with this code and name",
      });
      return;
    }

    // Create principal record
    const principalData = await PrincipalService.createPrincipal({
      created_by,
      updated_by,
      ...prinicipalPayload,
    });

    if (!principalData) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Principal data creation failed" });
      return;
    }

    // Create contact details
    const contactDetails = await PrincipalContactDetlService.createPrincipalContact({
      company_code: req.body.company_code,
      prin_code: principalData.prin_code,
      prin_cont1,
      prin_cont2,
      prin_cont3,
      prin_cont_email1,
      prin_cont_email2,
      prin_cont_email3,
      prin_cont_telno1,
      prin_cont_telno2,
      prin_cont_telno3,
      prin_cont_faxno1,
      prin_cont_faxno2,
      prin_cont_faxno3,
      prin_cont_ref1,
      created_by,
      updated_by,
    });

    if (!contactDetails) {
      // Rollback principal creation if contact details fail
      await PrincipalService.deletePrincipal(principalData.prin_code);
      res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: `Principal contact details creation failed`,
      });
      return;
    }

    // Process and create files if any
    if (files && files.length) {
      for (const file of files) {
        await UploadedFilesDltsService.createFile({
          ...file,
          company_code: req.body.company_code,
          request_number: "PRI" + principalData.prin_code,
          created_by,
        });
      }
    }

    // Return success response
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `${principalData.prin_code} Principal ${constants.MESSAGES.CREATED_SUCCESSFULLY}`,
    });
    return;
  } catch (error: unknown) {
    const knownError = error as { message: string };
    res
      .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: knownError.message });
  }
};

/**
 * Updates an existing principal record
 * @param req Request object containing updated principal data
 * @param res Response object
 */
export const updatePrincipal = async (req: RequestWithUser, res: Response) => {
  try {
    // Get request data and validate
    const requestUser = req.user;
    const { prin_code } = req.params;
    
    const { error } = principalSchema(
      req.body,
      requestUser.company_code,
      false
    );
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    // Destructure request body
    const {
        prin_cont1,
        prin_cont2,
        prin_cont3,
        prin_cont_email1,
        prin_cont_email2,
        prin_cont_email3,
        prin_cont_telno1,
        prin_cont_telno2,
        prin_cont_telno3,
        prin_cont_faxno1,
        prin_cont_faxno2,
        prin_cont_faxno3,
        prin_cont_ref1,
        files,
        ...prinicipalPayload
      } = req.body,
      updated_by = requestUser.loginid;

    // Check if principal exists
    const existingPrincipal = await PrincipalService.findByCode(prin_code);

    if (!existingPrincipal) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Principal " + constants.MESSAGES.DOES_NOT_EXISTS,
      });
      return;
    }

    // Update principal data
    const isPrincipalUpdated = await PrincipalService.updatePrincipal(
      prin_code, 
      {
        ...prinicipalPayload,
        updated_by,
      }
    );

    if (!isPrincipalUpdated) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Principal data update failed" });
      return;
    }

    // Update contact details
    const isContactUpdated = await PrincipalContactDetlService.updatePrincipalContact(
      prin_code,
      prinicipalPayload.company_code || requestUser.company_code,
      {
        prin_cont1,
        prin_cont2,
        prin_cont3,
        prin_cont_email1,
        prin_cont_email2,
        prin_cont_email3,
        prin_cont_telno1,
        prin_cont_telno2,
        prin_cont_telno3,
        prin_cont_faxno1,
        prin_cont_faxno2,
        prin_cont_faxno3,
        prin_cont_ref1,
        updated_by,
      }
    );

    if (!isContactUpdated) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Principal contact details update failed" });
      return;
    }

    // Create new files if any
    if (files && files.length) {
      for (const file of files) {
        await UploadedFilesDltsService.createFile({
          ...file,
          company_code: req.body.company_code,
          request_number: "PRI" + prin_code,
          created_by: updated_by,
        });
      }
    }

    // Return success response
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `Principal ${constants.MESSAGES.UPDATED_SUCCESSFULLY}`,
    });
    return;
  } catch (error: unknown) {
    const knownError = error as { message: string };
    res
      .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: knownError.message });
  }
};

/**
 * Retrieves principal data by code
 * @param req Request object containing principal code
 * @param res Response object
 */
export const getPrincipal = async (req: RequestWithUser, res: Response) => {
  try {
    const { prin_code } = req.params;
    const { company_code } = req.user;

    // Get principal data first
    const principalData = await PrincipalService.findByCode(prin_code);

    if (!principalData) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Principal " + constants.MESSAGES.DOES_NOT_EXISTS,
      });
      return;
    }

    // Get contact details using the company_code from principalData or user
    const contactDetails = await PrincipalContactDetlService.findByCode(
      prin_code, 
      principalData.company_code || company_code
    );

    if (!contactDetails) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Principal contact details not found",
      });
      return;
    }

    // Return combined data
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: { ...principalData, ...contactDetails },
    });
    return;
  } catch (error: unknown) {
    const knownError = error as { message: string };
    res
      .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: knownError.message });
  }
};

/**
 * Gets all principals for a company
 * @param req Request object
 * @param res Response object
 */
export const getAllPrincipals = async (req: RequestWithUser, res: Response) => {
  try {
    const { company_code } = req.user;
    
    // Get all principals
    const principals = await PrincipalService.findAll();
    
    // Filter by company code through contact details
    const companyPrincipals = [];
    for (const principal of principals) {
      const contactDetails = await PrincipalContactDetlService.findByCode(principal.prin_code, company_code);
      if (contactDetails) {
        companyPrincipals.push({
          ...principal,
          ...contactDetails
        });
      }
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: companyPrincipals,
    });
    return;
  } catch (error: unknown) {
    const knownError = error as { message: string };
    res
      .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: knownError.message });
  }
};

/**
 * Creates multiple principal records in bulk
 * @param req Request object containing array of principal data
 * @param res Response object
 */
export const createBulkPrincipal = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;

    // Validate request data
    const { error } = principalSchema(req.body, requestUser.company_code, true);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    // Process each principal
    let createdCount = 0;
    for (const principal of req.body) {
      const { 
        prin_cont1, prin_cont2, prin_cont3,
        prin_cont_email1, prin_cont_email2, prin_cont_email3,
        prin_cont_telno1, prin_cont_telno2, prin_cont_telno3,
        prin_cont_faxno1, prin_cont_faxno2, prin_cont_faxno3,
        prin_cont_ref1,
        ...principalPayload 
      } = principal;

      // Validate prin_code exists
      if (!principalPayload.prin_code) {
        continue; // Skip this record if prin_code is missing
      }

      // Check if principal already exists
      const existingPrincipal = await PrincipalService.findDuplicate({
        prin_code: principalPayload.prin_code,
        prin_name: principalPayload.prin_name,
      });

            if (!existingPrincipal) {
              // Create principal
              const newPrincipal = await PrincipalService.createPrincipal({
                ...principalPayload,
                created_by: requestUser.loginid,
                updated_by: requestUser.loginid,
              });
      
              if (newPrincipal) {
                // Create contact details for the newly created principal
                const contactDetails = await PrincipalContactDetlService.createPrincipalContact({
                  company_code: principalPayload.company_code || requestUser.company_code,
                  prin_code: newPrincipal.prin_code,
                  prin_cont1,
                  prin_cont2,
                  prin_cont3,
                  prin_cont_email1,
                  prin_cont_email2,
                  prin_cont_email3,
                  prin_cont_telno1,
                  prin_cont_telno2,
                  prin_cont_telno3,
                  prin_cont_faxno1,
                  prin_cont_faxno2,
                  prin_cont_faxno3,
                  prin_cont_ref1,
                  created_by: requestUser.loginid,
                  updated_by: requestUser.loginid,
                });
      
                if (!contactDetails) {
                  // Rollback principal if contact creation failed
                  await PrincipalService.deletePrincipal(newPrincipal.prin_code);
                  continue;
                }
      
                // Create files if provided in the bulk payload item
                if ((principal as any).files && (principal as any).files.length) {
                  for (const file of (principal as any).files) {
                    await UploadedFilesDltsService.createFile({
                      ...file,
                      company_code: principalPayload.company_code || requestUser.company_code,
                      request_number: "PRI" + newPrincipal.prin_code,
                      created_by: requestUser.loginid,
                    });
                  }
                }
      
                createdCount++;
              }
            }
          }
      
          // Return bulk create result
          res.status(constants.STATUS_CODES.OK).json({
            success: true,
            message: `${createdCount} Principals ${constants.MESSAGES.CREATED_SUCCESSFULLY}`,
          });
          return;
        } catch (error: unknown) {
          const knownError = error as { message: string };
          res
            .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
            .json({ success: false, message: knownError.message });
        }
      };