// This is for Almadina
import { Response } from "express";
import constants from "../../helpers/constants";
import { ISearch, RequestWithUser } from "../../interfaces/common.interface";

//import { RequestWithUser } from "../../interfaces/common.interface";

import { IUser } from "../../interfaces/user.interface";

import Costmaster from "../../models/Purchaseflow/costmaster_pf.model";
import Uommaster from "../../models/Purchaseflow/uommaster_pf.model";
//import { IUommaster } from "../../interfaces/Purchaseflow/Purucahseflow.interface";
import {
  ISupplier,
  IUommaster,
} from "../../interfaces/Purchaseflow/Purucahseflow.interface";
import { getSearchFilterQuery } from "../../helpers/functions";
import VProjectmaster from "../../models/Purchaseflow/projectmaster_pf_view.model";
import Itemmaster_pf from "../../models/Purchaseflow/itemmaster_pf_model";
import Divisionmaster from "../../models/Purchaseflow/divisionmaster_pf.model";
import DropdownProjectmaster from "../../models/Purchaseflow/dropdownprojectmaster_pf.model";
import { PurchaseRequestHeader } from "../../models/Purchaseflow_Al/purchaserequest_pf.model";
import IProdmaster from "../../models/Purchaseflow/prodmaster_pf.model";
import { POHeader } from "../../models/Purchaseflow/purchaserequest_pf.model";
import {
  ICostmaster,
  IdropdownProjectmaster,
  IItemtmaster,
  ITaxcategory,
} from "../../interfaces/Purchaseflow_Al/Purucahseflow.interface";

import { IVProjectmaster } from "../../interfaces/Purchaseflow_Al/Purucahseflow.interface";
import { IDivisionmaster } from "../../interfaces/Purchaseflow_Al/Purucahseflow.interface";
//import { QueryTypes, Sequelize } from "sequelize";
//import sequelize from "sequelize";
//import { sequelize } from "../../database/connection"
import { IPurchaseRequestHeader } from "../../models/Purchaseflow/purchaserequest_pf.model";

import { sequelize } from "../../database/connection";
import { Op, QueryTypes } from "sequelize";
import Projectmaster from "../../models/Purchaseflow/projectmaster_pf_model";
import { ISuppliermaster } from "../../interfaces/Purchaseflow/Purucahseflow.interface";
import Suppliermaster from "../../models/Purchaseflow/suppliermaster_pf.model";
import ddcurrency from "../../models/Purchaseflow/ddcurrency_pf_models";

import { IddCurrency } from "../../models/Purchaseflow/ddcurrency_pf_models";
import { IPOHeader } from "../../models/Purchaseflow/purchaserequest_pf.model";
// creating GT_MYTASK DATA
const getPurchaseRequestData = async (
  loginid: string | null | undefined,
  company_code: string | null | undefined
) => {
  try {
    // Validate input parameters
    if (!loginid || !company_code) {
      return {
        data: [],
        message: "Both loginid and company_code are required.",
      };
    }
    // calling Almadina Proedurure
    console.log("Inside PRO_CREATEORINERTGTMYTASK_AL ");
    // Call the procedure
    const procedureCall = `
      CALL PRO_CREATEORINERTGTMYTASK_AL(:gs_company_code, :gs_user_id);
    `;
    await sequelize.query(procedureCall, {
      replacements: {
        gs_user_id: loginid,
        gs_company_code: company_code,
      },
    });

    return {
      data: [],
      message: "Procedure executed successfully.",
    };
  } catch (error) {
    return {
      data: [],
      message: "An error occurred while executing the procedure.",
    };
  }
};

// This is for Purchase flow module
export const getPfMaster = async (req: RequestWithUser, res: Response) => {
  try {
    console.log("Enter in this getPfFunction today function..");
    const { master } = req.params;
    const requestUser: IUser = req.user;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = Number(page * limit - limit);
    let fetchedData: unknown[] = [];
    let totalCount = 0;
    const paginationOptions = limit ? { offset: skip, limit: limit } : {};
    const filter: ISearch = req.query.filter
      ? JSON.parse(req.query.filter)
      : {};
    console.log("master value:", master);
    switch (master) {
      case "division":
        console.log("inside division");
        {
          (fetchedData = await Divisionmaster.findAll({
            where: { company_code: requestUser.company_code },
            offset: skip,
            limit: limit,
          })) as unknown[] as IDivisionmaster[];
        }
        break;
      case "costmaster":
        {
          (fetchedData = await Costmaster.findAll({
            where: { company_code: requestUser.company_code },
            offset: skip,
            limit: limit,
          })) as unknown[] as ICostmaster[];
        }
        break;
      case "suppliermaster":
        {
          (fetchedData = await Suppliermaster.findAll({
            where: { company_code: requestUser.company_code },
            offset: skip,
            limit: limit,
          })) as unknown[] as ISupplier[];
        }
        break;
      case "dropdwonprojectmaster":
        console.log("At backend before fetch Project");
        {
          (fetchedData = await DropdownProjectmaster.findAll({
            attributes: {
              exclude: ["created_at", "updated_at", "company_code"],
            },
            where: { company_code: requestUser.company_code },
            offset: skip,
            limit: limit,
          })) as unknown[] as IdropdownProjectmaster[];
        }
        console.log(fetchedData);
        break;
      /*case "dropdwonprojects";
           const projects = await db.query('SELECT PROJECT_CODE, PROJECT_NAME FROM MS_PS_PROJECT_MASTER');
           res.json(projects);
           } catch (error) {
            res.status(500).json({ message: 'Error retrieving projects' });
           }
           break; */
      case "projectmaster":
        console.log("project master case", requestUser.loginid);
        {
          fetchedData = (await VProjectmaster.findAll({
            attributes: [
              "project_code",
              "project_name",
              "div_name",
              "total_project_cost",
              "project_date_from",
              "project_date_to",
              "facility_mgr_email",
            ],
            where: {
              project_code: {
                [Op.in]: sequelize.literal(
                  `(SELECT project_code FROM MS_PROJECT_USER_ASSIGN WHERE user_id = '${requestUser.loginid}')`
                ),
              },
            },
            offset: skip,
            limit: limit,
            raw: true, // Returns plain objects instead of Sequelize instances
          })) as unknown[] as IVProjectmaster[];

          console.log(requestUser.loginid);
          console.log(fetchedData);
        }
        break;
        case "ddCurrency":
          {
            (fetchedData = await ddcurrency.findAll({
              where: { company_code: requestUser.company_code },
              ...paginationOptions,
            })) as unknown[] as IddCurrency[];
            console.log("currency",fetchedData);
          }
          break;
      case "ddprojectmaster":
        console.log("project master case", requestUser.loginid);
        {
          fetchedData = (await VProjectmaster.findAll({
            attributes: [
              "project_code",
              "project_name",
              "div_name",
              "total_project_cost",
              "project_date_from",
              "project_date_to",
              "facility_mgr_email",
            ],
            where: {
              project_code: {
                [Op.in]: sequelize.literal(
                  `(SELECT project_code FROM MS_PROJECT_USER_ASSIGN WHERE user_id = '${requestUser.loginid}')`
                ),
              },
            },
            offset: skip,
            limit: limit,
            raw: true, // Returns plain objects instead of Sequelize instances
          })) as unknown[] as IVProjectmaster[];

          console.log(requestUser.loginid);
          console.log(fetchedData);
        }
        break;
      /*  case "ddcostmaster":
        console.log("Inside ddcostmaster");
        {
          (fetchedData = await Costmaster.findAll({
            where: { company_code: requestUser.company_code },
            offset: skip,
            limit: limit,
          })) as unknown[] as ICostmaster[];
        }
        break;*/
      case "ddcostmaster":
        console.log("Inside ddcostmaster");

        const query1 = `
            SELECT COST_CODE as cost_code, COST_NAME as cost_name 
            FROM MS_COST 
            WHERE COMPANY_CODE = :companyCode 
            LIMIT :limit OFFSET :offset
          `;

        try {
          // Execute the query with 'replacements' to securely pass parameters
          const fetchedData = await sequelize.query(query1, {
            replacements: {
              companyCode: requestUser.company_code,
              limit: limit,
              offset: skip,
            },
            type: QueryTypes.SELECT,
            raw: true, // Forces raw data return
          });

          console.log("Fetched data:", fetchedData); // Inspect the fetched data

          // Check if the data is an array and send it in the response
          if (Array.isArray(fetchedData) && fetchedData.length > 0) {
            res.json({
              success: true,
              data: fetchedData, // Send data as an array
            });
          } else {
            res.json({
              success: false,
              message: "No cost data found for the given company code.",
            });
          }
        } catch (err) {
          console.error("Error executing query:", err);
          res.status(500).json({
            success: false,
            error: "Internal Server Error",
            // You can add message: err.message if needed for more detail
          });
        }
        break;

      case "ddtaxcategory":
        console.log("Inside ddtaxcategory");

        const querytax = `
            SELECT TX_CAT_CODE as tx_cat_code, TX_CAT_NAME as tax_cat_name 
            FROM MS_TAX_CATEGORY_AL 
            WHERE COMPANY_CODE = :companyCode 
            LIMIT :limit OFFSET :offset
          `;

        try {
          // Execute the query with 'replacements' to securely pass parameters
          const fetchedData = await sequelize.query(querytax, {
            replacements: {
              companyCode: requestUser.company_code,
              limit: limit,
              offset: skip,
            },
            type: QueryTypes.SELECT,
            raw: true, // Forces raw data return
          });

          console.log("Fetched data:", fetchedData); // Inspect the fetched data

          // Check if the data is an array and send it in the response
          if (Array.isArray(fetchedData) && fetchedData.length > 0) {
            res.json({
              success: true,
              data: fetchedData, // Send data as an array
            });
          } else {
            res.json({
              success: false,
              message: "No tax category data found for the given company code.",
            });
          }
        } catch (err) {
          console.error("Error executing query:", err);
          res.status(500).json({
            success: false,
            error: "Internal Server Error",
            // You can add message: err.message if needed for more detail
          });
        }
        break;

      case "dduommaster":
        console.log("Inside dduommaster");
        {
          (fetchedData = await Uommaster.findAll({
            where: { company_code: requestUser.company_code },
            offset: skip,
            limit: limit,
          })) as unknown[] as IUommaster[];
        }
        break;
      case "ddprodmaster":
        console.log("Inside prodmmaster");
        {
          (fetchedData = await IProdmaster.findAll({
            where: { company_code: requestUser.company_code },
            offset: skip,
            limit: limit,
          })) as unknown[] as IProdmaster[];
        }
        break;
      case "ddsupplier":
        console.log("Inside suppliermastercc");
        {
          (fetchedData = await Suppliermaster.findAll({
            where: { company_code: requestUser.company_code },
            offset: skip,
            limit: limit,
          })) as unknown[] as ISuppliermaster[];
        }
        console.log("Inside suppliermaster1");
        console.log(requestUser.company_code);

        console.log(fetchedData);
        console.log("Inside suppliermaster2");
        break;
      // Same logic for pocancel and pomodify
      case "pocancel":
        {
          (fetchedData = await POHeader.findAll({
            where: { company_code: requestUser.company_code },
            offset: skip,
            limit: limit,
          })) as unknown[] as IPOHeader[];
        }
        break;
      case "pomodify":
        {
          (fetchedData = await POHeader.findAll({
            where: { company_code: requestUser.company_code },
            offset: skip,
            limit: limit,
          })) as unknown[] as IPOHeader[];
        }
        break;
      case "sentbackrollselection":
        const query = `
            SELECT B.ROLE_NAME as role_name, A.FLOW_LEVEL as flow_level
            FROM MS_PS_FLOW_ROLE_MAPPING A
            JOIN MS_PS_ROLE B ON A.FLOW_ROLE = B.ROLE_CODE
            WHERE A.FLOW_CODE = '001'
            ORDER BY A.FLOW_LEVEL DESC;
          `;

        try {
          // Execute the query with the 'raw' option set to true
          const sentbackrolls = await sequelize.query(query, {
            type: QueryTypes.SELECT, // Select query type
            raw: true, // Forces raw data return
          });

          // Log the result to inspect the raw data
          console.log("Sentbackrolls:", sentbackrolls); // This will now be an array of results

          // Ensure the data is an array and wrap it with success response
          if (Array.isArray(sentbackrolls) && sentbackrolls.length > 0) {
            res.json({
              success: true,
              data: sentbackrolls, // Send data as an array
            });
          } else {
            res.json({
              success: false,
              message: "No roles found for the given flow code.",
            });
          }
        } catch (err) {
          console.error("Error executing query:", err);
          res.status(500).json({
            success: false,
            error: "Internal Server Error",
            //       message: err.message || "An error occurred while executing the query.",
          });
        }
      // This is to get data for page. purchase request.
      case "purchase_request":
        const { loginid, company_code } = requestUser;
        console.log("before inside Almadina");
        
        // For creating GT_MY_TASK table
        const response = await getPurchaseRequestData(loginid, company_code);
        console.log("after");
        
        let insideQuery: any = [],
          outsideQuery = {
            [Op.and]: [{ company_code: requestUser.company_code }],
          };
        
        // Apply search filters
        outsideQuery = getSearchFilterQuery({
          insideQuery,
          filter: filter.search,
          outsideQuery,
        });
        
        totalCount = await PurchaseRequestHeader.count({
          where: outsideQuery,
        });
        
        fetchedData = await PurchaseRequestHeader.findAll({
          where: outsideQuery,
          ...(!!filter?.sort &&
            Object.keys(filter?.sort).length > 0 && {
              order: [
                [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
              ],
            }),
          ...paginationOptions,
          attributes: [
            // Format the request_date to DD/MM/YYYY HH:MI:SS
            [
              sequelize.fn('DATE_FORMAT', sequelize.col('request_date'), '%d/%m/%Y %H:%i:%s'),
              'formatted_request_date',
            ],
            // Add any other columns you need here
            ...Object.keys(PurchaseRequestHeader.rawAttributes).map((key) => key),
          ],
        });
        
        console.log(requestUser.company_code);
        console.log(fetchedData);
        
        break;
      case "itemmaster":
        {
          (fetchedData = await Itemmaster_pf.findAll({
            where: { company_code: requestUser.company_code },
            offset: skip,
            limit: limit,
          })) as unknown[] as IItemtmaster[];
        }
        break;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: { tableData: fetchedData, count: fetchedData?.length },
    });

    return;
  } catch (err) {}
};

export const deletepfMaster = async (req: RequestWithUser, res: Response) => {
  try {
    const { master } = req.params;
    const requestUser: IUser = req.user;
    const { cost_code } = req.body;
    const { ids } = req.body;
    const { project_code } = req.body;
    switch (master) {
      case "costmaster":
        if (!ids || ids.length === 0) {
          throw new Error("Cost Code is required");
        }
        console.log(ids);
        {
          await Costmaster.destroy({
            where: {
              company_code: requestUser.company_code,
              cost_code: ids,
            },
          });
        }
        break;

      case "projectmaster":
        if (!ids || ids.length === 0) {
          throw new Error("Project Code is required");
        }
        console.log(ids);
        {
          await Projectmaster.destroy({
            where: {
              company_code: requestUser.company_code,
              project_code: ids,
            },
          });
        }
        break;
      case "suppliermaster":
        if (!ids || ids.length === 0) {
          throw new Error("Project Code is required");
        }
        console.log(ids);
        {
          await Suppliermaster.destroy({
            where: {
              company_code: requestUser.company_code,
              supp_code: ids,
            },
          });
        }
        break;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `${master} is successfully deleted`,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
