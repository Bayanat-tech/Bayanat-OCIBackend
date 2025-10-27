import { Response } from "express";
import { Op } from "sequelize";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
//import Department from "../../models/wms/department_wms.model";
import Location from "../../models/wms/location_wms.model";
//import { departmentSchema } from "../../validation/wms/gm.validation";
import { locationSchema } from "../../validation/wms/gm.validation";

export const createlocation = async (req: RequestWithUser, res: Response) => {
  try {
    //console.log("data aaya ki nhi in function bakend..yesr", req.body);
    const requestUser: IUser = req.user;
    const { error } = locationSchema(req.body);

    const location_code = `${req.body.aisle}${req.body.column_no}${req.body.height}`;
    const loc_desc = `${req.body.site_code}-${req.body.aisle}${req.body.column_no}${req.body.height}`;

    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    //console.log("called0");

    const { company_code } = req.body;
    const location = await Location.findOne({
      where: {
        [Op.and]: [{ company_code: company_code }, { loc_desc: loc_desc }],
      },
    });

    if (location) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.LOCATION_WMS.LOCATION_ALREADY_EXISTS,
      });
      return;
    }

    // Log the values to the console
    // console.log("Location Code:", location_code);
    //console.log("Location Description:", loc_desc);

    const createlocation = await Location.create({
      ...req.body,
      company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,
      location_code: location_code,
      loc_desc: loc_desc,
    });
    if (!createlocation) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.LOCATION_WMS.LOCATION_CREATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const updatelocation = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;
    const { error } = locationSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { location_code, company_code } = req.body;

    const location = await Location.findOne({
      where: {
        [Op.and]: [{ company_code: company_code }, { loc_desc: location_code }],
      },
    });

    if (!location) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.LOCATION_WMS.LOCATION_DOES_NOT_EXISTS,
      });
      return;
    }
    const createlocation = await location.update(
      {
        company_code,
        created_by: requestUser.loginid,
        updated_by: requestUser.loginid,

        ...req.body,
      },

      {
        where: {
          [Op.and]: [
            { company_code: company_code },
            { location_code: location_code },
          ],
        },
      }
    );
    if (!createlocation) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.LOCATION_WMS.LOCATION_UPDATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
// export const deleteLocations = async (req: RequestWithUser, res: Response) => {
//   try {
//     const locationsCode = req.body;
//     console.log(locationsCode);

//     if (!req.body.length) {
//       res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//         success: false,
//         message: constants.MESSAGES.LOCATION_WMS.SELECT_AT_LEAST_ONE_LOCATION,
//       });
//       return;
//     }
//     const locationsDeleteResponse = await Location.destroy({
//       where: {
//         location_code: locationsCode,
//       },
//     });
//     if (locationsDeleteResponse === 0) {
//       res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//         success: false,
//         message: locationsDeleteResponse,
//       });
//       return;
//     }
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       message: constants.MESSAGES.LOCATION_WMS.LOCATION_DELETED_SUCCESSFULLY,
//     });
//     return;
//   } catch (error: any) {
//     res
//       .status(constants.STATUS_CODES.BAD_REQUEST)
//       .json({ success: false, message: error.message });
//     return;
//   }
// };
