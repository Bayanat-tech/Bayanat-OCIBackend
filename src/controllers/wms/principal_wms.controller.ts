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
import dayjs from 'dayjs';

const formatDateForOracle = (date: string | Date): string => {
  return dayjs(date).format('YYYY-MM-DD');
};

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
        comm_reg_exp_date,
        prin_invdate,
        trn_exp_date,
        validate_expdate,
        ...prinicipalPayload
      } = req.body,
      created_by = requestUser.loginid,
      updated_by = requestUser.loginid;

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

    // Prepare the payload with formatted dates
    const createPayload: any = {
      created_by,
      updated_by,
      ...prinicipalPayload,
    };

    // Format each date field if it exists
    if (comm_reg_exp_date !== undefined && comm_reg_exp_date !== null && comm_reg_exp_date !== '') {
      createPayload.comm_reg_exp_date = formatDateForOracle(comm_reg_exp_date);
    }

    if (prin_invdate !== undefined && prin_invdate !== null && prin_invdate !== '') {
      createPayload.prin_invdate = formatDateForOracle(prin_invdate);
    }

    if (trn_exp_date !== undefined && trn_exp_date !== null && trn_exp_date !== '') {
      createPayload.trn_exp_date = formatDateForOracle(trn_exp_date);
    }

    if (validate_expdate !== undefined && validate_expdate !== null && validate_expdate !== '') {
      createPayload.validate_expdate = formatDateForOracle(validate_expdate);
    }

    // Debug log
    console.log('Creating principal with payload:', JSON.stringify(createPayload, null, 2));

    // Create principal record
    const principalData = await PrincipalService.createPrincipal(createPayload);

    if (!principalData) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Principal data creation failed" });
      return;
    }

    // Fetch the principal to get the trigger-generated prin_code
    const createdPrincipal = await PrincipalService.findByCode(principalData.prin_code);
    
    if (!createdPrincipal) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Failed to retrieve created principal" });
      return;
    }

    // Create contact details with the generated prin_code
    const contactDetails = await PrincipalContactDetlService.createPrincipalContact({
      company_code: req.body.company_code,
      prin_code: createdPrincipal.prin_code,
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
      await PrincipalService.deletePrincipal(createdPrincipal.prin_code);
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
          request_number: "PRI" + createdPrincipal.prin_code,
          created_by,
        });
      }
    }

    // Return success response
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `${createdPrincipal.prin_code} Principal ${constants.MESSAGES.CREATED_SUCCESSFULLY}`,
    });
    return;
  } catch (error: unknown) {
    const knownError = error as { message: string };
    console.error('Error in createPrincipal:', knownError);
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
    const requestUser = req.user;
    const { prin_code } = req.params;

    // Validate request data
    const { error } = principalSchema(req.body, requestUser.company_code, false);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    // Destructure request body
    const {
      prin_cont1, prin_cont2, prin_cont3,
      prin_cont_email1, prin_cont_email2, prin_cont_email3,
      prin_cont_telno1, prin_cont_telno2, prin_cont_telno3,
      prin_cont_faxno1, prin_cont_faxno2, prin_cont_faxno3,
      prin_cont_ref1,
      files,
      comm_reg_exp_date,
      prin_invdate,
      trn_exp_date,
      validate_expdate,
      ...principalPayload
    } = req.body;

    const updated_by = requestUser.loginid;
    const companyCode = principalPayload.company_code || requestUser.company_code;

    // Check if principal exists
    const existingPrincipal = await PrincipalService.findByCode(prin_code);
    if (!existingPrincipal) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Principal " + constants.MESSAGES.DOES_NOT_EXISTS,
      });
      return;
    }

    // Build update payload with formatted dates
    const updatePayload: any = { ...principalPayload, updated_by };

    if (comm_reg_exp_date !== undefined && comm_reg_exp_date !== null && comm_reg_exp_date !== '') {
      updatePayload.comm_reg_exp_date = formatDateForOracle(comm_reg_exp_date);
    }
    if (prin_invdate !== undefined && prin_invdate !== null && prin_invdate !== '') {
      updatePayload.prin_invdate = formatDateForOracle(prin_invdate);
    }
    if (trn_exp_date !== undefined && trn_exp_date !== null && trn_exp_date !== '') {
      updatePayload.trn_exp_date = formatDateForOracle(trn_exp_date);
    }
    if (validate_expdate !== undefined && validate_expdate !== null && validate_expdate !== '') {
      updatePayload.validate_expdate = formatDateForOracle(validate_expdate);
    }

    // Update principal record
    const isPrincipalUpdated = await PrincipalService.updatePrincipal(prin_code, updatePayload);
    if (!isPrincipalUpdated) {
      res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Principal data update failed" });
      return;
    }

    // Upsert contact details if any contact data is provided
    const contactPayload = {
      prin_cont1: prin_cont1 || '',
      prin_cont2: prin_cont2 || '',
      prin_cont3: prin_cont3 || '',
      prin_cont_email1: prin_cont_email1 || '',
      prin_cont_email2: prin_cont_email2 || '',
      prin_cont_email3: prin_cont_email3 || '',
      prin_cont_telno1: prin_cont_telno1 || '',
      prin_cont_telno2: prin_cont_telno2 || '',
      prin_cont_telno3: prin_cont_telno3 || '',
      prin_cont_faxno1: prin_cont_faxno1 || '',
      prin_cont_faxno2: prin_cont_faxno2 || '',
      prin_cont_faxno3: prin_cont_faxno3 || '',
      prin_cont_ref1: prin_cont_ref1 || '',
    };

    const hasContactData = Object.values(contactPayload).some(Boolean);

    if (hasContactData) {
      const existingContact = await PrincipalContactDetlService.findByCode(prin_code, companyCode);

      if (existingContact) {
        const isContactUpdated = await PrincipalContactDetlService.updatePrincipalContact(
          prin_code, companyCode, { ...contactPayload, updated_by }
        );
        if (!isContactUpdated) {
          console.warn(`Warning: Contact update failed for principal ${prin_code}, but continuing...`);
        }
      } else {
        const newContact = await PrincipalContactDetlService.createPrincipalContact({
          ...contactPayload,
          company_code: companyCode,
          prin_code,
          created_by: updated_by,
          updated_by,
        });
        if (!newContact) {
          console.warn(`Warning: Contact creation failed for principal ${prin_code}, but continuing...`);
        }
      }
    }

    // Append new files if any
    if (files?.length) {
      for (const file of files) {
        await UploadedFilesDltsService.createFile({
          ...file,
          company_code: companyCode,
          request_number: "PRI" + prin_code,
          created_by: updated_by,
        });
      }
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `Principal ${constants.MESSAGES.UPDATED_SUCCESSFULLY}`,
    });
  } catch (error: unknown) {
    const knownError = error as { message: string };
    console.error('Error in updatePrincipal:', knownError);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
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

    const emptyContactDetails = {
      prin_cont1: '',
      prin_cont2: '',
      prin_cont3: '',
      prin_cont_email1: '',
      prin_cont_email2: '',
      prin_cont_email3: '',
      prin_cont_telno1: '',
      prin_cont_telno2: '',
      prin_cont_telno3: '',
      prin_cont_faxno1: '',
      prin_cont_faxno2: '',
      prin_cont_faxno3: '',
      prin_cont_ref1: '',
    };

    // if (!contactDetails) {
    //   res.status(constants.STATUS_CODES.NOT_FOUND).json({
    //     success: false,
    //     message: "Principal contact details not found",
    //   });
    //   return;
    // }

    // Return combined data
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: { ...principalData, ...(contactDetails || emptyContactDetails) },
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
    
    // Create empty contact details structure
    const emptyContactDetails = {
      prin_cont1: '',
      prin_cont2: '',
      prin_cont3: '',
      prin_cont_email1: '',
      prin_cont_email2: '',
      prin_cont_email3: '',
      prin_cont_telno1: '',
      prin_cont_telno2: '',
      prin_cont_telno3: '',
      prin_cont_faxno1: '',
      prin_cont_faxno2: '',
      prin_cont_faxno3: '',
      prin_cont_ref1: '',
    };
    
    // Filter by company code through contact details
    const companyPrincipals = [];
    for (const principal of principals) {
      const contactDetails = await PrincipalContactDetlService.findByCode(principal.prin_code, company_code);
      
      // Include all principals, even without contact details
      companyPrincipals.push({
        ...principal,
        ...(contactDetails || emptyContactDetails)  // Use empty fields if no contact details
      });
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
                // Fetch the created principal to get trigger-generated prin_code
                const createdPrincipal = await PrincipalService.findByCode(newPrincipal.prin_code);
                
                if (!createdPrincipal) {
                  continue;
                }

                // Create contact details for the newly created principal
                const contactDetails = await PrincipalContactDetlService.createPrincipalContact({
                  company_code: principalPayload.company_code || requestUser.company_code,
                  prin_code: createdPrincipal.prin_code,
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
                  await PrincipalService.deletePrincipal(createdPrincipal.prin_code);
                  continue;
                }
      
                // Create files if provided in the bulk payload item
                if ((principal as any).files && (principal as any).files.length) {
                  for (const file of (principal as any).files) {
                    await UploadedFilesDltsService.createFile({
                      ...file,
                      company_code: principalPayload.company_code || requestUser.company_code,
                      request_number: "PRI" + createdPrincipal.prin_code,
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