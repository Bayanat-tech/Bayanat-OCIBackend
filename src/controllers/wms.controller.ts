// Importing necessary modules and interfaces
import { Response } from "express";
import constants from "../helpers/constants";
import { QueryTypes } from "sequelize"; 
import { WhereOptions } from "sequelize";
import { ISearch, RequestWithUser } from "../interfaces/common.interface";
import { ICostmaster } from "../interfaces/Purchaseflow/Purucahseflow.interface";
import {
  IFlowmaster,
  IRolemaster,
} from "../interfaces/Security/Security.interfae";
import { IUser } from "../interfaces/user.interface";
import { IActivityUoc } from "../interfaces/wms/activity_uoc_wms.interface";
import { IActivity } from "../interfaces/wms/activity_wms.interface";
import { IActivityGroup } from "../interfaces/wms/activitygroup_wms.interface";
import { IDepartment } from "../interfaces/wms/department_wms.interface";
import {
  IAccountsetup,
  IManufacture,
  IMoc,
  IUoc,
  IUom,
} from "../interfaces/wms/gm_wms.interface";
import { IHarmonize } from "../interfaces/wms/harmonize.interface";
import { ILine } from "../interfaces/wms/line_wms.interface";
import { ILocation } from "../interfaces/wms/location_wms.interface";
import { IPartner } from "../interfaces/wms/partner_wms.interface";
import { IPort } from "../interfaces/wms/port_wms.interface";
import { ISupplier } from "../interfaces/wms/supplier_wms.interface";
import { ITerritory } from "../interfaces/wms/territory_wms.interface";
import { IVessel } from "../interfaces/wms/vessel_wms.interface";

// Importing models for WMS master data
import Accountsetup from "../models/wms/accountsetup_wms.model";
import ActivityBillingTable from "../models/wms/activity_billing_table_wms";
import Activitysubgroup from "../models/wms/activity_subgroup.model";
import ActivityUoc from "../models/wms/activity_uoc.model";
import Activity from "../models/wms/activity_wms.model";
import AirLine from "../models/wms/airline_wms.model";
import Brand from "../models/wms/brand_wms.model";
import Currency from "../models/wms/currency_wms.model";
import Department from "../models/wms/department_wms.model";
import Harmonize from "../models/wms/harmonize_code.model";
import line from "../models/wms/line_wms.model";
import Location from "../models/wms/location_wms.model";
import Manufacture from "../models/wms/manufacture_wms.model";
import partner from "../models/wms/partner_wms.model";
import Port from "../models/wms/port_wms.model";
import Product from "../models/wms/product_wms.model";
import Group from "../models/wms/productgroup_wms.model";
import Salesman from "../models/wms/salesman_wms.model";
import Site from "../models/wms/site_wms.model";
import Storage from "../models/wms/storage_wms.model";
import Supplier from "../models/wms/supplier_wms.model";
import Territory from "../models/wms/territory_wms.model";
import Uom from "../models/wms/uom_wms.model";
import vessel from "../models/wms/vessel_wms.model";

// --- Database sequelize import ---
import activitygroup from "../models/wms/activitygroup_wms.model";
import Principal from "../models/wms/principal_wms.model";
import PrincipalWmsView from "../views/wms/principal_wms.view";

import { Op } from "sequelize";
import { sequelize } from "../database/connection";
import { getSearchFilterQuery } from "../helpers/functions";
import { IActivitysubgroup } from "../interfaces/wms/activity_subgroup_wms.interface";
import { IIndustrysector } from "../interfaces/wms/industrysector_wms.interface";
import Country, { FindOptionsWithTimeZone } from "../models/country_wms.model";
import ActivityKPI from "../models/wms/activitykpi_wms_models";
import Alert from "../models/wms/alert_wms_model";
import Assetgroup from "../models/wms/assetgroup_wms.model";
import Division from "../models/wms/division_wms.model";
import industrysector from "../models/wms/industrysector_wms.model";
import LocationType from "../models/wms/locationtype_wms.model";
import Moc from "../models/wms/moc_wms.model";
import Producttype from "../models/wms/producttype_wms.model";
import ShipmentDetailsInboundWms from "../models/wms/transaction/inbound/shipmantDetails_wms.model";
import Uoc from "../models/wms/uoc_wms.model";
import Warehouse from "../models/wms/warehouse_wms.model";
import PackingDetailsInboundWmsView from "../views/wms/transportation/inbound/packingDetails_wms.view";
import JobOubListingView from "../views/wms/transportation/outbound/outboundJobWms.view";
import PickingDetailsOutboundWmsView from "../views/wms/transportation/outbound/pickingDetailsWms.view";
import OrderDetail from "../../src/models/wms/transaction/outbound/toOrderDetail_wms.model"
import ConfirmInboundInboundWms from "../models/wms/transaction/inbound/confirmInboundjob_wms.model";

// Importing additional interfaces and models
import {
  IDepartmentjob,
  IDivisionjob,
  IPrincipaljob,
} from "../interfaces/wms/principal_wms.interface";
import JobInboundWms from "../models/wms/transaction/inbound/inboundJobWms.model";
//import JobInboundWmsview from "../models/wms/transaction/inbound/inbounJobWms.model.view";

import DDdepartmentjob from "../views/wms/transportation/inbound/dddepartmentobWms";
import DDdivisionjob from "../views/wms/transportation/inbound/dddivisionobWms";
import DDPrincipaljob from "../views/wms/transportation/inbound/ddprincipalJobWms";
import TallyDetailsInboundWms from "../models/wms/transaction/inbound/tallyDetails_wms.model";
import JobOutboundWms from "../models/wms/transaction/outbound/outboundJobWms.model"; 
import {Categorymaster} from "../models/Hr/hr_category";
import { ICategorymaster } from "../interfaces/Hr/hr_category_interface";
import { Request } from 'express';

let fetchedData: any[] = [];
let totalCount = 0;

export const executeRawSql = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawSql: string = req.body?.raw_sql || req.query?.sql;

    if (!rawSql || typeof rawSql !== 'string') {
      res.status(400).json({ error: 'Missing or invalid raw SQL string' });
      return;
    }

    const results = await sequelize.query(rawSql, {
      type: QueryTypes.SELECT,
      raw: true,
    });

    res.json({ success: true, data: results, totalCount: results.length });
  } catch (error: any) {
    console.error('SQL Execution Error:', error);
    res.status(500).json({ error: 'Failed to execute SQL', details: error.message });
  }
};



export const executeRawSqlbody = async (req: Request, res: Response): Promise<void> => {
  try {
    const { query_parameter, query_where, query_updatevalues } = req.body;

    if (!query_parameter || !query_where) {
      res.status(400).json({
        error: "Missing query_parameter or query_where",
      });
      return;
    }

    // 🚀 Clean inputs
    const cleanWhere = query_where.replace(/`/g, "").trim();
    const cleanUpdate = (query_updatevalues || "").replace(/`/g, "").trim();

    console.log("Final WHERE string:", cleanWhere);
    console.log("Final UPDATE values string:", cleanUpdate);

    // 1️⃣ Call procedure (sets @out_sql)
    await sequelize.query(
      `CALL SP_CREATE_SQL_change(:query_parameter, :query_where, :query_updatevalues, @out_sql)`,
      {
        replacements: {
          query_parameter,
          query_where: cleanWhere,
          query_updatevalues: cleanUpdate,
        },
        type: QueryTypes.RAW,
      }
    );

    // 2️⃣ Fetch generated SQL
    const [outSqlRow]: any = await sequelize.query(
      `SELECT @out_sql AS vs_return_string`,
      { type: QueryTypes.SELECT }
    );

    let rawSql: string = outSqlRow?.vs_return_string;
    if (!rawSql) {
      res.status(500).json({ error: "Procedure did not return SQL" });
      return;
    }

    // 🧹 Strip trailing semicolon
    rawSql = rawSql.trim().replace(/;$/, "");
    console.log("Generated rawSql:", rawSql);

    // 3️⃣ Execute the SELECT statement returned by procedure
    const results = await sequelize.query(rawSql, {
      type: QueryTypes.SELECT,
      raw: true,
    });

    // 4️⃣ Send rows to frontend
    res.json({
      success: true,
      data: results,
      totalCount: results.length,
    });
  } catch (error: any) {
    console.error("SQL Execution Error:", error);
    res.status(500).json({
      error: "Failed to execute SQL",
      details: error.message,
    });
  }
};






// Retrieves master data (country,Port , department, territory, etc.) with optional pagination based on the `master` type.
export const getWmsMaster = async (req: RequestWithUser, res: Response) => {
  try {
   // Extracting master type from request parameters
const { master } = req.params;
console.log("master", master);

// Extracting user information from request
const requestUser: IUser = req.user;

// Extracting unique codes from query parameters
const uniqueCode = req.query.code;
const uniqueCode2 = req.query.code2;

// Extracting pagination parameters from query
const page = Number(req.query.page) || 1;
const limit = Number(req.query.limit) || 100;
const skip = Number(page * limit - limit);

// Initializing variables to store fetched data and total count
let fetchedData: unknown[] = [],
  totalCount = 0;

// Creating pagination options based on limit
const paginationOptions = limit ? { offset: skip, limit: limit } : {};
function removeAllocatedFilters(condition: any): any {
  if (Array.isArray(condition)) {
    return condition
      .map(removeAllocatedFilters)
      .filter(
        (cond) =>
          !(
            typeof cond === "object" &&
            cond !== null &&
            cond.allocated === "N"
          )
      );
  } else if (typeof condition === "object" && condition !== null) {
    const newCond: Record<string, any> = {};
    for (const key in condition) {
      if (key === "allocated" && condition[key] === "N") continue;

      if (key === Op.and.toString() || key === Op.or.toString()) {
        newCond[key] = removeAllocatedFilters(condition[key]);
      } else {
        newCond[key] = condition[key];
      }
    }
    return newCond;
  }
  return condition;
}
// Extracting filter from query and parsing it to JSON
const filter: ISearch = req.query.filter
  ? JSON.parse(req.query.filter)
  : {};
    switch (master) {
      //----------------------wms----------------
      //---------------gm----------
     // Fetching country data from the Country model
    case "country":
  {
    // Initialize inside and outside query variables
    let insideQuery: any = [],
      outsideQuery = {
        [Op.and]: [{ company_code: requestUser.company_code }],
      };

    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });

    // Count the total number of records
    totalCount = await Country.count({ where: outsideQuery });

    // Fetch country data with optional pagination and sorting
    fetchedData = await Country.findAll({
      where: outsideQuery,
      ...(!!filter?.sort &&
        Object.keys(filter?.sort).length > 0 && {
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
          ],
        }),
      ...paginationOptions,
    } as FindOptionsWithTimeZone);
  }
  break;
case "producttype":
  {
    // Initialize inside and outside query variables
    let insideQuery: any = [],
      outsideQuery = {
        [Op.and]: [{ company_code: requestUser.company_code }],
      };

    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });

    // Count the total number of records
    totalCount = await Producttype.count({ where: outsideQuery });

    // Fetch product type data with optional pagination and sorting
    fetchedData = await Producttype.findAll({
      where: outsideQuery,
      ...(!!filter?.sort &&
        Object.keys(filter?.sort).length > 0 && {
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
          ],
        }),
      ...paginationOptions,
    });
  }

  break;
case "alert":
  {
    // Initialize inside and outside query variables
    let insideQuery: any = [],
      outsideQuery = {
        [Op.and]: [{ company_code: requestUser.company_code }],
      };

    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });

    // Count the total number of records
    totalCount = await Alert.count({ where: outsideQuery });

    // Fetch alert data with optional pagination and sorting
    fetchedData = await Alert.findAll({
      where: outsideQuery,
      ...(!!filter?.sort &&
        Object.keys(filter?.sort).length > 0 && {
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
          ],
        }),
      ...paginationOptions,
    });
  }
  break;
case "port":
  {
    // Fetch port data with optional pagination
    fetchedData = await Port.findAll({
      where: { company_code: requestUser.company_code },
      ...paginationOptions,
    }) as unknown[] as IPort[];
  }
  break;

case "product":
  {
    // Initialize inside and outside query variables
    let insideQuery: any = [],
      outsideQuery = {
        [Op.and]: [{ company_code: requestUser.company_code }],
      };

    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });

    // Count the total number of records
    totalCount = await Product.count({ where: outsideQuery });

    // Fetch product data with optional pagination and sorting
    fetchedData = await Product.findAll({
      where: outsideQuery,
      ...(!!filter?.sort &&
        Object.keys(filter?.sort).length > 0 && {
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
          ],
        }),
      ...paginationOptions,
    });
  }
  break;

case "accountsetup":
  {
    // Fetch account setup data with optional pagination
    fetchedData = await Accountsetup.findAll({
      where: { company_code: requestUser.company_code },
      ...paginationOptions,
    }) as unknown[] as IAccountsetup[];
  }
  break;

      // Fetching manufacturer data from the Manufacture model
case "manufacturer":
  {
    // Initialize query to fetch manufacturer data with company code
    (fetchedData = await Manufacture.findAll({
      where: { company_code: requestUser.company_code },
      ...paginationOptions,
    })) as unknown[] as IManufacture[];
  }
  break;


// Fetching category data from the Manufacture model for dropdown
case "ddcategory": {
  (fetchedData = await Categorymaster.findAll({
    where: { company_code: requestUser.company_code },
    ...paginationOptions,
  })) as unknown[] as ICategorymaster[];
}
break;
  
// Fetching group data from the Group model
case "group":
  {
    // Initialize inside and outside query variables
    let insideQuery: any = [],
      outsideQuery = {
        [Op.and]: [{ company_code: requestUser.company_code }],
      };
    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });
    // Count the total number of records
    totalCount = await Group.count({ where: outsideQuery });

    // Fetch group data with optional pagination and sorting
    fetchedData = await Group.findAll({
      where: outsideQuery,
      ...(!!filter?.sort &&
        Object.keys(filter?.sort).length > 0 && {
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
          ],
        }),
      ...paginationOptions,
    });
  }
  break;

// Fetching asset group data from the Assetgroup model
case "assetgroup":
  {
    // Initialize inside and outside query variables
    let insideQuery: any = [],
      outsideQuery = {
        [Op.and]: [{ company_code: requestUser.company_code }],
      };
    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });
    // Count the total number of records
    totalCount = await Assetgroup.count({ where: outsideQuery });

          (fetchedData = await DDPrincipaljob.findAll({
            where: { company_code: requestUser.company_code },
          })) as unknown[] as IPrincipaljob[];
          console.log(fetchedData);
        }
        break;
      case "ddepartment":
        {
          (fetchedData = await DDdepartmentjob.findAll({
            where: { company_code: requestUser.company_code },
            ...paginationOptions,
          })) as unknown[] as IDepartmentjob[];
          console.log(fetchedData);
        }
        break;
      case "dddivision":
        {
          (fetchedData = await DDdivisionjob.findAll({
            where: { company_code: requestUser.company_code },
            ...paginationOptions,
          })) as unknown[] as IDivisionjob[];
          console.log(fetchedData);
        }
        break;
      case "assePrincipal":
        {
          let insideQuery: any = [],
            outsideQuery = {
              [Op.and]: [
                { company_code: requestUser.company_code },
                // { user_id: requestUser.loginid },

              ],
            };
          outsideQuery = getSearchFilterQuery({
            insideQuery,
            filter: filter.search,
            outsideQuery,
          });
          totalCount = await PrincipalWmsView.count({ where: outsideQuery });
    // Fetch asset group data with optional pagination and sorting
    fetchedData = await Assetgroup.findAll({
      where: outsideQuery,
      ...(!!filter?.sort &&
        Object.keys(filter?.sort).length > 0 && {
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
          ],
        }),
      ...paginationOptions,
    });
  }
  break;

// Fetching brand data from the Brand model
case "brand":
  {
    // Initialize inside and outside query variables
    let insideQuery: any = [],
      outsideQuery = {
        [Op.and]: [{ company_code: requestUser.company_code }],
      };
    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });
    // Count the total number of records
    totalCount = await Brand.count({ where: outsideQuery });

    // Fetch brand data with optional pagination and sorting
    fetchedData = await Brand.findAll({
      where: outsideQuery,
      ...(!!filter?.sort &&
        Object.keys(filter?.sort).length > 0 && {
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
          ],
        }),
      ...paginationOptions,
    });
  }
  break;

// Fetching department data from the Department model
case "department":
  {
    // Fetch department data with company code and optional pagination
    (fetchedData = await Department.findAll({
      where: { company_code: requestUser.company_code },
      ...paginationOptions,
    })) as unknown[] as IDepartment[];
  }
  break;

      // Fetching supplier data from the Supplier model
case "supplier":
  {
    // Fetch supplier data with company code and optional pagination
    (fetchedData = await Supplier.findAll({
      where: { company_code: requestUser.company_code },
      ...paginationOptions,
    })) as unknown[] as ISupplier[];
    // Log fetched data for debugging purposes
    console.log(fetchedData);
  }
  break;
// Fetching ddprincipal data from the DDPrincipaljob model
case "ddprincipal":
  {
    // Fetch ddprincipal data with company code
    (fetchedData = await DDPrincipaljob.findAll({
      where: { company_code: requestUser.company_code },
    })) as unknown[] as IPrincipaljob[];
    // Log fetched data for debugging purposes
    console.log(fetchedData);
  }
  break;
// Fetching ddepartment data from the DDdepartmentjob model
case "ddepartment":
  {
    // Fetch ddepartment data with company code and optional pagination
    (fetchedData = await DDdepartmentjob.findAll({
      where: { company_code: requestUser.company_code },
      ...paginationOptions,
    })) as unknown[] as IDepartmentjob[];
    // Log fetched data for debugging purposes
    console.log(fetchedData);
  }
  break;
// Fetching dddivision data from the DDdivisionjob model
case "dddivision":
  {
    // Fetch dddivision data with company code and optional pagination
    (fetchedData = await DDdivisionjob.findAll({
      where: { company_code: requestUser.company_code },
      ...paginationOptions,
    })) as unknown[] as IDivisionjob[];
    // Log fetched data for debugging purposes
    console.log(fetchedData);
  }
  break;
// Fetching principal data from the PrincipalWmsView model
case "principal":
  {
    console.log("principal checking");
    // Initialize inside and outside query variables
    let insideQuery: any = [],
      outsideQuery = {
        [Op.and]: [
          { company_code: requestUser.company_code }
          // { user_id: requestUser.loginid },
        ],
      };
    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });
    // Count the total number of records
    totalCount = await PrincipalWmsView.count({ where: outsideQuery });

    // Fetch principal data with optional pagination and sorting
    fetchedData = await PrincipalWmsView.findAll({
      where: outsideQuery,
      ...(!!filter?.sort &&
        Object.keys(filter?.sort).length > 0 && {
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
          ],
        }),
      ...paginationOptions,
    });
    // Log fetched data for debugging purposes
    console.log("fetched data: ", JSON.stringify(fetchedData));
  }
  break;
// Fetching territory data from the Territory model
case "territory":
  {
    // Fetch territory data with company code and optional pagination
    (fetchedData = await Territory.findAll({
      where: { company_code: requestUser.company_code },
      ...paginationOptions,
    })) as unknown[] as ITerritory[];
  }
  break;
// Fetching currency data from the Currency model
case "currency":
  {
    // Initialize inside and outside query variables
    let insideQuery: any = [],
      outsideQuery = {
        [Op.and]: [
          { company_code: requestUser.company_code },
          // { user_id: requestUser.loginid },
        ],
      };
    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });
    // Log outside query for debugging purposes
    console.log(outsideQuery, { depth: null });

    // Count the total number of records
    totalCount = await Currency.count({ where: outsideQuery });

    // Fetch currency data with optional pagination and sorting
    fetchedData = await Currency.findAll({
      where: outsideQuery,
      ...(!!filter?.sort &&
        Object.keys(filter?.sort).length > 0 && {
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
          ],
        }),
      ...paginationOptions,
    });
  }
  break;
      // Fetching salesman data from the Salesman model
case "salesman":
  {
    // Initialize inside and outside query variables
    let insideQuery: any = [], // Initialize inside query as an empty array
      outsideQuery = {
        [Op.and]: [{ company_code: requestUser.company_code }], // Initialize outside query with company code
      };

    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });

    // Count the total number of records
    totalCount = await Salesman.count({ where: outsideQuery });

    // Fetch salesman data with optional pagination and sorting
    fetchedData = await Salesman.findAll({
      where: outsideQuery,
      ...(!!filter?.sort && // Check if filter.sort is not null or undefined
        Object.keys(filter?.sort).length > 0 && { // Check if filter.sort has at least one key
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"], // Sort by field name in descending or ascending order
          ],
        }),
      ...paginationOptions, // Apply pagination options
    });
  }

  break;
case "site":
  {
    // Initialize inside and outside query variables
    let insideQuery: any = [], // Initialize inside query as an empty array
      outsideQuery = {
        [Op.and]: [{ company_code: requestUser.company_code }], // Initialize outside query with company code
      };

    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });

    // Count the total number of records
    totalCount = await Site.count({ where: outsideQuery });

    // Fetch site data with optional pagination and sorting
    fetchedData = await Site.findAll({
      where: outsideQuery,
      ...(!!filter?.sort && // Check if filter.sort is not null or undefined
        Object.keys(filter?.sort).length > 0 && { // Check if filter.sort has at least one key
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"], // Sort by field name in descending or ascending order
          ],
        }),
      ...paginationOptions, // Apply pagination options
    });
  }

  break;
case "industrysector":
  {
    // Fetch industry sector data with company code and optional pagination
    (fetchedData = await industrysector.findAll({
      where: { company_code: requestUser.company_code },
      offset: skip,
      limit: limit,
    })) as unknown[] as IIndustrysector[];
  }
  break;

case "costmaster":
  {
    // Fetch cost master data with company code and optional pagination
    (fetchedData = await Country.findAll({
      where: { company_code: requestUser.company_code },
      offset: skip,
      limit: limit,
    })) as unknown[] as ICostmaster[];
  }
  break;
case "rolemaster":
  {
    // Fetch role master data with company code and optional pagination
    (fetchedData = await Country.findAll({
      where: { company_code: requestUser.company_code },
      offset: skip,
      limit: limit,
    })) as unknown[] as IRolemaster[];
  }
  break;
case "flowmaster":
  {
    // Fetch flow master data with company code and optional pagination
    (fetchedData = await Country.findAll({
      where: { company_code: requestUser.company_code },
      offset: skip,
      limit: limit,
    })) as unknown[] as IFlowmaster[];
  }
  break;

case "storage":
  {
    // Fetch storage data with company code and optional pagination
    fetchedData = await Storage.findAll({
      where: { company_code: requestUser.company_code },
      ...paginationOptions,
    });
  }
  break;
      // Fetching activity group data from the activitygroup model
case "activitygroup":
  {
    // Fetch activity group data with company code and optional pagination
    (fetchedData = await activitygroup.findAll({
      where: { company_code: requestUser.company_code },
      ...paginationOptions,
    })) as unknown[] as IActivityGroup[];
  }
  break;

// Fetching line data from the line model
case "line":
  {
    // Fetch line data with company code and optional pagination
    (fetchedData = await line.findAll({
      where: { company_code: requestUser.company_code },
      ...paginationOptions,
    })) as unknown[] as ILine[];
  }
  break;

// Fetching vessel data from the vessel model
case "vessel":
  {
    // Fetch vessel data with company code and optional pagination
    (fetchedData = await vessel.findAll({
      where: { company_code: requestUser.company_code },
      ...paginationOptions,
    })) as unknown[] as IVessel[];
  }
  break;

// Fetching airline data from the AirLine model
case "airline":
  {
    // Fetch airline data with company code and optional pagination
    (fetchedData = await AirLine.findAll({
      where: { company_code: requestUser.company_code },
      ...paginationOptions,
    })) as unknown[] as IVessel[];
  }
  break;

// Fetching partner data from the partner model
case "partner":
  {
    // Fetch partner data with company code and optional pagination
    (fetchedData = await partner.findAll({
      where: { company_code: requestUser.company_code },
      ...paginationOptions,
    })) as unknown[] as IPartner[];
  }
  break;

// Fetching activity subgroup data from the Activitysubgroup model
case "activitysubgroup":
  {
    // Fetch activity subgroup data with company code and optional pagination
    (fetchedData = await Activitysubgroup.findAll({
      where: { company_code: requestUser.company_code },
      ...paginationOptions,
    })) as unknown[] as IActivitysubgroup[];
  }
  break;

// Fetching billing activity data from the ActivityBillingTable model
case "billing_activity":
  {
    // Initialize inside and outside query variables
    let insideQuery: any = [],
      outsideQuery = {
        [Op.and]: [
          { company_code: requestUser.company_code },
          {
            ...(!!uniqueCode && {
              prin_code: uniqueCode,
            }),
          },
          {
            user_id: requestUser.loginid,
          },
        ],
      };

    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });

    // Count the total number of records
    totalCount = await ActivityBillingTable.count({
      where: outsideQuery,
    });

    // Fetch billing activity data with optional pagination and sorting
    fetchedData = await ActivityBillingTable.findAll({
      where: outsideQuery,
      ...(!!filter?.sort &&
        Object.keys(filter?.sort).length > 0 && {
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
          ],
        }),
      ...paginationOptions,
    });
  }
  break;
// Fetching activity data from the Activity model
case "activity": {
  // Fetching data using the Activity model
  fetchedData = (await Activity.findAll({
    attributes: ["activity_code", "activity", "activity_group_code"],
    where: {
      company_code: requestUser.company_code,
    },
    ...paginationOptions,
  })) as unknown[] as IActivity[];

  break;
}

// Fetching activity KPI data from the ActivityKPI model
case "activitykpi": {
  // Initialize inside and outside query variables
  let insideQuery: any = [],
    outsideQuery = {
      [Op.and]: [{ company_code: requestUser.company_code }],
    };

  // Apply search filter to the outside query
  outsideQuery = getSearchFilterQuery({
    insideQuery,
    filter: filter.search,
    outsideQuery,
  });

  // Count the total number of records
  totalCount = await ActivityKPI.count({ where: outsideQuery });

  // Fetch activity KPI data with optional pagination and sorting
  fetchedData = await ActivityKPI.findAll({
    where: outsideQuery,
    ...(!!filter?.sort &&
      Object.keys(filter?.sort).length > 0 && {
        order: [
          [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
        ],
      }),
    ...paginationOptions,
  });

  break;
}

// Fetching location data from the Location model
case "location": {
  // Initialize inside and outside query variables
  let insideQuery: any = [],
    outsideQuery = {
      [Op.and]: [{ company_code: requestUser.company_code }],
    };

  // Apply search filter to the outside query
  outsideQuery = getSearchFilterQuery({
    insideQuery,
    filter: filter.search,
    outsideQuery,
  });

  // Fetch location data with optional pagination and sorting
  fetchedData = (await Location.findAll({
    where: outsideQuery,
    ...(!!filter?.sort &&
      Object.keys(filter?.sort).length > 0 && {
        order: [
          [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
        ],
      }),
    ...paginationOptions,
  })) as unknown[] as ILocation[];
}

// Fetching UOM data from the Uom model
case "uom":
   {
  // Fetch UOM data with company code and optional pagination
  (fetchedData = await Uom.findAll({
    where: { company_code: requestUser.company_code },
    ...paginationOptions,
  })) as unknown[] as IUom[];
  console.log("Fetched UOM data:", fetchedData); // Log the fetched data
}
break;
case "harmonize":
   {
   (fetchedData = await Harmonize.findAll({
    where: { company_code: requestUser.company_code },
    ...paginationOptions,
  })) as unknown[] as IHarmonize[];
  console.log("harmonize", fetchedData);

}
break;
case "uoc":
        {
          (fetchedData = await Uoc.findAll({
            where: { company_code: requestUser.company_code },
            ...paginationOptions,
          })) as unknown[] as IUoc[];
        }
        break;
      
     // Fetching division data from the Division model
case "division":
  {
    // Initialize inside and outside query variables
    let insideQuery: any = [], // Initialize inside query as an empty array
      outsideQuery = {
        [Op.and]: [
          { company_code: requestUser.company_code }, // Filter by company code
          { user_id: requestUser.loginid }, // Filter by user ID
        ],
      };

    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });

    // Count the total number of records
    totalCount = await Division.count({ where: outsideQuery });

    // Fetch division data with optional pagination and sorting
    fetchedData = await Division.findAll({
      where: outsideQuery,
      ...(!!filter?.sort && // Check if filter.sort is not null or undefined
        Object.keys(filter?.sort).length > 0 && { // Check if filter.sort has at least one key
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"], // Sort by field name in descending or ascending order
          ],
        }),
      ...paginationOptions, // Apply pagination options
    });
  }
  break;

// Fetching MOC data from the Moc model
case "moc1":
  {
    // Fetch MOC data with company code and optional pagination
    (fetchedData = await Moc.findAll({
      where: { company_code: requestUser.company_code },
      ...paginationOptions,
    })) as unknown[] as IMoc[];
  }
  break;

// Fetching MOC data from the ActivityUoc model
case "moc2":
  {
    // Fetch MOC data with company code, charge type, and optional pagination
    fetchedData = (await ActivityUoc.findAll({
      attributes: [
        "company_code",
        "charge_type",
        "charge_code",
        "description",
        "activity_group_code",
      ],
      where: {
        company_code: requestUser.company_code,
        charge_type: master ? master : " ", // Filter by charge type
      },
      ...paginationOptions,
    })) as IActivityUoc[];
  }
  break;

// Fetching job data from the JobInboundWms model
case "jobs":
  console.log ('inside jobs')
  {
    // Initialize inside and outside query variables
    let insideQuery: any = [], // Initialize inside query as an empty array
      outsideQuery = {
        [Op.and]: [{ company_code: requestUser.company_code,
          job_type :"IMP"
         }], // Filter by company code
      };

    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });


    // Count the total number of records
    totalCount = await JobInboundWms.count({ where: outsideQuery });

    // Fetch job data with optional pagination and sorting
    fetchedData = await JobInboundWms.findAll({
      where: outsideQuery,
      ...(!!filter?.sort && // Check if filter.sort is not null or undefined
        Object.keys(filter?.sort).length > 0 && { // Check if filter.sort has at least one key
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"], // Sort by field name in descending or ascending order
          ],
        }),
      ...paginationOptions, // Apply pagination options
    });
  }
  break;

// Fetching job data from the JobOubListingView model
case "jobs_oub":
  {
    // Initialize inside and outside query variables
    let insideQuery: any = [], // Initialize inside query as an empty array
      outsideQuery = {
        [Op.and]: [{ company_code: requestUser.company_code,
          job_type :"EXP"
         }], // Filter by company code
      };

    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });

    // Count the total number of records
   // totalCount = await JobOubListingView.count({ where: outsideQuery });
    totalCount = await JobOutboundWms.count({ where: outsideQuery });


    // Fetch job data with optional pagination and sorting
    fetchedData = await JobOutboundWms.findAll({
      where: outsideQuery,
      ...(!!filter?.sort && // Check if filter.sort is not null or undefined
        Object.keys(filter?.sort).length > 0 && { // Check if filter.sort has at least one key
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"], // Sort by field name in descending or ascending order
          ],
        }),
      ...paginationOptions, // Apply pagination options
    });
  }
  break;
     // Fetching shipment details data from the ShipmentDetailsInboundWms model
case "shipment_details_container":
  {
    // Initialize inside and outside query variables
    let insideQuery: any = [], // Initialize inside query as an empty array
      outsideQuery = {
        [Op.and]: [
          { company_code: requestUser.company_code }, // Filter by company code
          { job_no: uniqueCode }, // Filter by job number
        ],
      };

    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });

    // Count the total number of records
    totalCount = await ShipmentDetailsInboundWms.count({
      where: outsideQuery,
    });

    // Fetch shipment details data with optional pagination and sorting
    fetchedData = await ShipmentDetailsInboundWms.findAll({
      where: outsideQuery,
      ...(!!filter?.sort && // Check if filter.sort is not null or undefined
        Object.keys(filter?.sort).length > 0 && { // Check if filter.sort has at least one key
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"], // Sort by field name in descending or ascending order
          ],
        }),
      ...paginationOptions, // Apply pagination options
    });
  }
  break;


  

// Fetching packing details data from the PackingDetailsInboundWmsView model
case "packing_details":
  {
    // Initialize inside and outside query variables
    let insideQuery: any = [], // Initialize inside query as an empty array
      outsideQuery = {
        [Op.and]: [
          { company_code: requestUser.company_code }, // Filter by company code
          { job_no: uniqueCode }, // Filter by job number
        ],
      };

    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });

    // Count the total number of records
    totalCount = await PackingDetailsInboundWmsView.count({
      where: outsideQuery,
    });

    // Fetch packing details data with optional pagination and sorting
    fetchedData = await PackingDetailsInboundWmsView.findAll({
      where: outsideQuery,
      ...(!!filter?.sort && // Check if filter.sort is not null or undefined
        Object.keys(filter?.sort).length > 0 && { // Check if filter.sort has at least one key
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"], // Sort by field name in descending or ascending order
          ],
        }),
      ...paginationOptions, // Apply pagination options
    });
  
  }
  break;

// Fetching tally details data from the TallyDetailsInboundWms model
case "tally_details":
  {
    // Initialize inside and outside query variables
    let insideQuery: any = [], // Initialize inside query as an empty array
      outsideQuery = {
        [Op.and]: [
          { company_code: requestUser.company_code }, // Filter by company code
          { job_no: uniqueCode }, // Filter by job number
        ],
      };

    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });

    // Count the total number of records
    totalCount = await TallyDetailsInboundWms.count({
      where: outsideQuery,
    });

    // Fetch tally details data with optional pagination and sorting
    fetchedData = await TallyDetailsInboundWms.findAll({
      where: outsideQuery,
      ...(!!filter?.sort && // Check if filter.sort is not null or undefined
        Object.keys(filter?.sort).length > 0 && { // Check if filter.sort has at least one key
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"], // Sort by field name in descending or ascending order
          ],
        }),
      ...paginationOptions, // Apply pagination options
    });
  }
  break;
      // Fetching putway details data from the PackingDetailsInboundWmsView model
// case "putway_details":
//   {
//     // Initialize inside and outside query variables
//     let insideQuery: any = [], // Initialize inside query as an empty array
//       outsideQuery = {
//         [Op.and]: [
//           { company_code: requestUser.company_code }, // Filter by company code
//           { job_no: uniqueCode }, // Filter by job number
//         ],
//       };

//     // Apply search filter to the outside query
//     outsideQuery = getSearchFilterQuery({
//       insideQuery,
//       filter: filter.search,
//       outsideQuery,
//     });

//     // Count the total number of records
//     totalCount = await PackingDetailsInboundWmsView.count({
//       where: outsideQuery,
//     });

//     // Fetch putway details data with optional pagination and sorting
//     fetchedData = await PackingDetailsInboundWmsView.findAll({
//       where: outsideQuery,
//       ...(!!filter?.sort && // Check if filter.sort is not null or undefined
//         Object.keys(filter?.sort).length > 0 && { // Check if filter.sort has at least one key
//           order: [
//             [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"], // Sort by field name in descending or ascending order
//           ],
//         }),
//       ...paginationOptions, // Apply pagination options
//     });
//   }
//   break;



// Fetching picking details data from the PickingDetailsOutboundWmsView model
case "order_entry":
  {
   const job_no = req.query.code;
  const prin_code = req.query.code2;
   console.log('job_no',job_no);
    console.log('prin_code',prin_code);

    // Initialize inside and outside query variables
    let insideQuery: any = []; // Initialize inside query as an empty array
    let outsideQuery = {
      [Op.and]: [
        { company_code: requestUser.company_code }, // Filter by company code
        { job_no: job_no }      ,                    // Filter by job_no
          { prin_code: prin_code }                          // Filter by job_no
      ],
    };

    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });

    // Count the total number of records
    totalCount = await OrderDetail.count({
      where: outsideQuery,
    });

    // Fetch picking details data with optional pagination
    fetchedData = await OrderDetail.findAll({
      where: outsideQuery,
      ...paginationOptions, // Apply pagination options
    });
  }
  break;


// Fetching picking details data from the PickingDetailsOutboundWmsView model
case "picking_details": {
  console.log('inside picking details');

  const job_no = req.query.code;
  const prin_code = req.query.code2;

  console.log('job_no', job_no);
  console.log('prin_code', prin_code);

  // Initialize inside and outside query variables
  let insideQuery: any = [];

  // Build dynamic conditions
  let conditions: any[] = [
    { company_code: requestUser.company_code }
  ];

  if (job_no && job_no !== 'undefined') {
    conditions.push({ job_no });
  }

  if (prin_code && prin_code !== 'undefined') {
    conditions.push({ prin_code });
  }

  // Combine with Sequelize AND operator
  let outsideQuery = {
    [Op.and]: conditions
  };

  // Apply search filter to the outside query
  outsideQuery = getSearchFilterQuery({
    insideQuery,
    filter: filter.search,
    outsideQuery,
  });

  // Count the total number of records
  totalCount = await PickingDetailsOutboundWmsView.count({
    where: outsideQuery,
  });

  // Fetch picking details data with optional pagination
  fetchedData = await PickingDetailsOutboundWmsView.findAll({
    where: outsideQuery,
    ...paginationOptions, // Apply pagination options
  });

  break;
}

case "job_confirmation1":
  {
    let insideQuery: any = [],
      outsideQuery = {
        [Op.and]: [
          { company_code: requestUser.company_code },
          { job_no: uniqueCode },
          { prin_code: uniqueCode2 },
        ],
      };

    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });

    totalCount = await ConfirmInboundInboundWms.count({
      where: outsideQuery,
    });

    fetchedData = await ConfirmInboundInboundWms.findAll({
      where: outsideQuery,
      ...(!!filter?.sort &&
        Object.keys(filter?.sort).length > 0 && {
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
          ],
        }),
      ...paginationOptions,
    });
  }
  break;

// Fetching warehouse data from the Warehouse model
case "warehouse":
  {
    // Initialize inside and outside query variables
    let insideQuery: any = [], // Initialize inside query as an empty array
      outsideQuery = {
        [Op.and]: [{ company_code: requestUser.company_code }], // Filter by company code
      };

    // Apply search filter to the outside query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });

    // Count the total number of records
    totalCount = await Warehouse.count({ where: outsideQuery });

    // Fetch warehouse data with optional pagination and sorting
    fetchedData = await Warehouse.findAll({
      where: outsideQuery,
      ...(!!filter?.sort && // Check if filter.sort is not null or undefined
        Object.keys(filter?.sort).length > 0 && { // Check if filter.sort has at least one key
          order: [
            [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"], // Sort by field name in descending or ascending order
          ],
        }),
      ...paginationOptions, // Apply pagination options
    });
  }
  break;

  //  case "container":
  //       {
  //         // Initialize inside and outside query variables
  //         let insideQuery: any = [],
  //           outsideQuery = {
  //             [Op.and]: [{ company_code: requestUser.company_code }],
  //           };
  //         // Apply search filter to the outside query
  //         outsideQuery = getSearchFilterQuery({
  //           insideQuery,
  //           filter: filter.search,
  //           outsideQuery,
  //         });
  //         totalCount = await JobInboundWms.count({ where: outsideQuery });

  //         fetchedData = await JobInboundWms.findAll({
  //           where: outsideQuery,
  //           ...(!!filter?.sort &&
  //             Object.keys(filter?.sort).length > 0 && {
  //               order: [
  //                 [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
  //               ],
  //             }),
  //           ...paginationOptions,
  //         });
  //       }
  //       break;
  case "container":
        {
          let insideQuery: any = [],
            outsideQuery = {
              [Op.and]: [{ company_code: requestUser.company_code }],
            };
          outsideQuery = getSearchFilterQuery({
            insideQuery,
            filter: filter.search,
            outsideQuery,
          });
          totalCount = await ShipmentDetailsInboundWms.count({
            where: outsideQuery,
          });

          fetchedData = await ShipmentDetailsInboundWms.findAll({
            where: outsideQuery,
            ...(!!filter?.sort &&
              Object.keys(filter?.sort).length > 0 && {
                order: [
                  [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
                ],
              }),
            ...paginationOptions,
          });
        }
        break;
      // case "jobs_oub":
      //   {
      //     let insideQuery: any = [],
      //       outsideQuery = {
      //         [Op.and]: [{ company_code: requestUser.company_code }],
      //       };
      //     outsideQuery = getSearchFilterQuery({
      //       insideQuery,
      //       filter: filter.search,
      //       outsideQuery,
      //     });
      //     totalCount = await JobOubListingView.count({ where: outsideQuery });

      //     fetchedData = await JobOubListingView.findAll({
      //       where: outsideQuery,
      //       ...(!!filter?.sort &&
      //         Object.keys(filter?.sort).length > 0 && {
      //           order: [
      //             [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
      //           ],
      //         }),
      //       ...paginationOptions,
      //     });
      //   }
      //   break;
      case "shipment_details":
        {
          let insideQuery: any = [],
            outsideQuery = {
              [Op.and]: [
                { company_code: requestUser.company_code },
                { job_no: uniqueCode },
              ],
            };
          outsideQuery = getSearchFilterQuery({
            insideQuery,
            filter: filter.search,
            outsideQuery,
          });
          totalCount = await ShipmentDetailsInboundWms.count({
            where: outsideQuery,
          });

          fetchedData = await ShipmentDetailsInboundWms.findAll({
            where: outsideQuery,
            ...(!!filter?.sort &&
              Object.keys(filter?.sort).length > 0 && {
                order: [
                  [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
                ],
              }),
            ...paginationOptions,
          });
        }
        break;
      // case "packing_details":
      //   {
      //     let insideQuery: any = [],
      //       outsideQuery = {
      //         [Op.and]: [
      //           { company_code: requestUser.company_code },
      //           { job_no: uniqueCode },
      //         ],
      //       };
      //     outsideQuery = getSearchFilterQuery({
      //       insideQuery,
      //       filter: filter.search,
      //       outsideQuery,
      //     });
      //     totalCount = await PackingDetailsInboundWmsView.count({
      //       where: outsideQuery,
      //     });

      //     fetchedData = await PackingDetailsInboundWmsView.findAll({
      //       where: outsideQuery,
      //       ...(!!filter?.sort &&
      //         Object.keys(filter?.sort).length > 0 && {
      //           order: [
      //             [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
      //           ],
      //         }),
      //       ...paginationOptions,
      //     });
      //   }
      //   break;

      // case "tally_details":
      //   {
      //     let insideQuery: any = [],
      //       outsideQuery = {
      //         [Op.and]: [
      //           { company_code: requestUser.company_code },
      //           { job_no: uniqueCode },
      //         ],
      //       };
      //     outsideQuery = getSearchFilterQuery({
      //       insideQuery,
      //       filter: filter.search,
      //       outsideQuery,
      //     });
      //     totalCount = await TallyDetailsInboundWms.count({
      //       where: outsideQuery,
      //     });

      //     fetchedData = await TallyDetailsInboundWms.findAll({
      //       where: outsideQuery,
      //       ...(!!filter?.sort &&
      //         Object.keys(filter?.sort).length > 0 && {
      //           order: [
      //             [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
      //           ],
      //         }),
      //       ...paginationOptions,
      //     });
      //   }
      //   break;
      case "putway_details":
        {
          let insideQuery: any = [],
            outsideQuery = {
              [Op.and]: [
                {
                  company_code: requestUser.company_code,
                  job_no: uniqueCode,
                  clearance: "Y",
                  allocated: "N",
                },
                { company_code: requestUser.company_code },
                { job_no: uniqueCode },
              ],
            };
          outsideQuery = getSearchFilterQuery({
            insideQuery,
            filter: filter.search,
            outsideQuery,
          });
          totalCount = await PackingDetailsInboundWmsView.count({
            where: outsideQuery,
          });

          fetchedData = await PackingDetailsInboundWmsView.findAll({
            where: outsideQuery,
            ...(!!filter?.sort &&
              Object.keys(filter?.sort).length > 0 && {
                order: [
                  [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
                ],
              }),
            ...paginationOptions,
          });
        }
        break;
      // case "picking_details":
      //   {
      //     let insideQuery: any = [],
      //       outsideQuery = {
      //         [Op.and]: [{ company_code: requestUser.company_code }],
      //       };
      //     outsideQuery = getSearchFilterQuery({
      //       insideQuery,
      //       filter: filter.search,
      //       outsideQuery,
      //     });
      //     totalCount = await PickingDetailsOutboundWmsView.count({
      //       where: outsideQuery,
      //     });

      //     fetchedData = await PickingDetailsOutboundWmsView.findAll({
      //       where: outsideQuery,
      //       // ...(!!filter?.sort &&
      //       //   Object.keys(filter?.sort).length > 0 && {
      //       //     order: [
      //       //       [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
      //       //     ],
      //       //   }),
      //       ...paginationOptions,
      //     });
      //   }
      //   break;

case "job_confirmation": {
    const prin_code = req.query.code2;
  let insideQuery: any[] = [];

  let baseQuery: WhereOptions = {
    [Op.and]: [
      {
        company_code: requestUser.company_code,
        job_no: uniqueCode,
        prin_code: prin_code,
        selected: "N",
        confirmed: "N",
        allocated: "Y", // ✅ Always required
      },
    ],
  };

  // Apply user search filters, if any
  let outsideQuery = getSearchFilterQuery({
    insideQuery,
    filter: filter.search,
    outsideQuery: baseQuery,
  });

  // 🚫 Clean any conflicting allocated: 'N' from deep/nested filters
  outsideQuery = removeAllocatedFilters(outsideQuery);

  // ✅ Re-enforce required conditions (in case overwritten)
  const mandatoryFilters = [
    { company_code: requestUser.company_code },
    { job_no: uniqueCode },
    { prin_code: prin_code },
    { selected: "N" },
    { confirmed: "N" },
    { allocated: "Y" },
  ];

  if (!outsideQuery[Op.and]) outsideQuery[Op.and] = [];
  // Remove duplicates or re-push mandatory fields (to be safe)
  outsideQuery[Op.and] = [
    ...mandatoryFilters,
    ...outsideQuery[Op.and].filter(
      (cond: Record<string, any>) =>
        !(
          "company_code" in cond ||
          "job_no" in cond ||
          "prin_code" in cond ||
          "selected" in cond ||
          "confirmed" in cond ||
          "allocated" in cond
        )
    ),
  ];

  console.log("Final WHERE clause:", JSON.stringify(outsideQuery, null, 2));

  // Fetch count
  totalCount = await ConfirmInboundInboundWms.count({
    where: outsideQuery,
  });

  // Fetch paginated and sorted results
  fetchedData = await ConfirmInboundInboundWms.findAll({
    where: outsideQuery,
    ...(!!filter?.sort &&
      Object.keys(filter?.sort).length > 0 && {
        order: [[filter.sort.field_name, filter.sort.desc ? "DESC" : "ASC"]],
      }),
    ...paginationOptions,
  });

  break;
}



      case "warehouse":
        {
          let insideQuery: any = [],
            outsideQuery = {
              [Op.and]: [{ company_code: requestUser.company_code }],
            };
          outsideQuery = getSearchFilterQuery({
            insideQuery,
            filter: filter.search,
            outsideQuery,
          });
          totalCount = await Warehouse.count({ where: outsideQuery });

          fetchedData = await Warehouse.findAll({
            where: outsideQuery,
            ...(!!filter?.sort &&
              Object.keys(filter?.sort).length > 0 && {
                order: [
                  [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
                ],
              }),
            ...paginationOptions,
          });
        }

        break;
      case "locationtype":
        {
          // Initialize inside and outside query variables
          let insideQuery: any = [],
            outsideQuery = {
              [Op.and]: [{ company_code: requestUser.company_code }],
            };
          // Apply search filter to the outside query
          outsideQuery = getSearchFilterQuery({
            insideQuery,
            filter: filter.search,
            outsideQuery,
          });
          // Count the total number of records
          totalCount = await LocationType.count({ where: outsideQuery });
          // Fetch location type data with optional pagination and sorting
          fetchedData = await LocationType.findAll({
            where: outsideQuery,
            ...(!!filter?.sort &&
              Object.keys(filter?.sort).length > 0 && {
                order: [
                  [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
                ],
              }),
            ...paginationOptions,
          });
        }
        break;
    }

   // Return a successful response with the fetched data and total count
res.status(constants.STATUS_CODES.OK).json({
  // Indicate that the operation was successful
  success: true,
  // Return the fetched data and total count
  data: { tableData: fetchedData, count: totalCount },
});
// Exit the function
return;
  }catch (err) {
  // Log the error for debugging purposes
  console.error(err);
  
  // Return a response with a 500 status code (Internal Server Error) and a JSON object
  res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
    // Indicate that the operation was not successful
    success: false,
    // Provide a generic error message
    message: "Error occurred while fetching data",
  });
}
};

// Delete master data (country,Port , department, territory, etc.) with optional pagination based on the `master` type.
// Deletes master data (country, Port, department, territory, etc.) with optional pagination based on the `master` type.
export const deleteWmsMaster = async (req: RequestWithUser, res: Response) => {
  try {
    // Extract master type from request parameters
    const { master } = req.params;
    
    // Extract user information from request
    const requestUser: IUser = req.user;
    
    // Extract port code and ids from request body
    const { port_code } = req.body;
    const { ids } = req.body;
    
    // Check if ids are provided
    if (!ids || ids.length === 0) {
      throw new Error("countryCode is required");
    }
    
    // Switch statement to handle different master types
    switch (master) {
      // Delete country data
      case "country":
        {
          // Destroy country data with company code and country code
          await Country.destroy({
            where: {
              company_code: requestUser.company_code,
              country_code: ids,
            },
          });
        }
        break;

      // Delete alert data
      case "alert":
        {
          // Destroy alert data with company code and op code
          await Alert.destroy({
            where: {
              company_code: requestUser.company_code,
              op_code: ids,
            },
          });
        }
        break;

      // Delete department data
      case "department":
        {
          // Destroy department data with company code and dept code
          await Department.destroy({
            where: {
              company_code: requestUser.company_code,
              dept_code: ids,
            },
          });
        }
        break;

      // Delete location data
      case "location":
        {
          // Destroy location data with company code and loc desc
          await Location.destroy({
            where: {
              company_code: requestUser.company_code,
              loc_desc: ids,
            },
          });
        }
        break;

      // Delete supplier data
      case "supplier":
        {
          // Destroy supplier data with company code and supp code
          await Supplier.destroy({
            where: {
              company_code: requestUser.company_code,
              supp_code: ids,
            },
          });
        }
        break;

      // Delete currency data
      case "currecy":
        {
          // Destroy currency data with company code and curr code
          await Currency.destroy({
            where: {
              company_code: requestUser.company_code,
              curr_code: ids,
            },
          });
        }
        break;
      // Delete brand data
      case "brand":
        {
          // Destroy brand data with company code and brand code
          await Brand.destroy({
            where: {
              company_code: requestUser.company_code,
              brand_code: ids,
            },
          });
        }
        break;
      // Delete group data
      case "group":
        {
          // Destroy group data with company code and group code
          await Group.destroy({
            where: {
              company_code: requestUser.company_code,
              group_code: ids,
            },
          });
        }
        break;
      // Delete manufacture data
      case "manufacture":
        {
          // Destroy manufacture data with company code and manu code
          await Manufacture.destroy({
            where: {
              company_code: requestUser.company_code,
              manu_code: ids,
            },
          });
        }
        break;

      // Delete account setup data
      case "accountsetup":
        {
          // Destroy account setup data with company code and ac code
          await Accountsetup.destroy({
            where: {
              company_code: requestUser.company_code,
              ac_code: ids,
            },
          });
        }
        break;

      // Delete product data
      case "product":
        
        {
          // Destroy product data with company code and prod code
          await Product.destroy({
            where: {
              company_code: requestUser.company_code,
              prod_code: ids,
            },
          });
        }
        break;

      // Delete port data
      case "port":
        {
          // Check if port code is provided
          if (!port_code || port_code.length === 0) {
            throw new Error("PortCode is required");
          }
          // Destroy port data with company code and port code
          await Port.destroy({
            where: {
              company_code: requestUser.company_code,
              port_code: port_code,
            },
          });
        }
        break;
      // Delete principal data
      case "principal":
        {
          // Start a transaction
          await sequelize.transaction(async (t) => {
            // Update principal data with company code and prin code
            await Principal.update(
              {
                updated_by: requestUser.loginid,
              },
              {
                where: {
                  company_code: requestUser.company_code,
                  prin_code: ids,
                },
                transaction: t,
              }
            );
            // Destroy principal data with company code and prin code
            await Principal.destroy({
              where: {
                company_code: requestUser.company_code,
                prin_code: ids,
              },
              transaction: t,
            });
          });
        }
        break;

      // Delete product data
      case "product":
        {
          // Destroy product data with company code and prod code
          await Product.destroy({
            where: {
              company_code: requestUser.company_code,
              prod_code: ids,
            },
          });
        }
        break;

      // Delete activity group data
      case "activitygroup":
        {
          // Destroy activity group data with company code and activity group code
          await activitygroup.destroy({
            where: {
              company_code: requestUser.company_code,
              activity_group_code: ids,
            },
          });
        }
        break;

      // Delete line data
      case "line":
        {
          // Destroy line data with company code and line code
          await line.destroy({
            where: {
              company_code: requestUser.company_code,
              line_code: ids,
            },
          });
        }

        break;

      // Delete vessel data
      case "vessel":
        {
          // Destroy vessel data with company code and vessel code
          await vessel.destroy({
            where: {
              company_code: requestUser.company_code,
              vessel_code: ids,
            },
          });
        }
        break;

      // Delete airline data
      case "airline":
        {
          // Destroy airline data with company code and airline code
          await AirLine.destroy({
            where: {
              company_code: requestUser.company_code,
              airline_code: ids,
            },
          });
        }
        break;

      // Delete partner data
      case "partner":
        {
          // Destroy partner data with company code and broker code
          await partner.destroy({
            where: {
              company_code: requestUser.company_code,
              broker_code: ids,
            },
          });
        }
        break;

      // Delete department data
      case "department":
        {
          // Destroy department data with company code and dept code
          await Department.destroy({
            where: {
              company_code: requestUser.company_code,
              dept_code: ids,
            },
          });
        }
        break;

      // Delete territory data
      case "territory":
        {
          // Destroy territory data with company code and territory code
          await Territory.destroy({
            where: {
              company_code: requestUser.company_code,
              territory_code: ids,
            },
          });
        }
        break;
      // Delete currency data
      case "currency":
        {
          // Destroy currency data with company code and curr code
          await Currency.destroy({
            where: {
              company_code: requestUser.company_code,
              curr_code: ids,
            },
          });
        }
        break;

      // Delete salesman data
      case "salesman":
        {
          // Destroy salesman data with company code and salesman code
          await Salesman.destroy({
            where: {
              company_code: requestUser.company_code,
              salesman_code: ids,
            },
          });
        }
        break;

      // Delete warehouse data
      case "warehouse":
        {
          // Destroy warehouse data with company code and wh code
          await Warehouse.destroy({
            where: {
              company_code: requestUser.company_code,
              wh_code: ids,
            },
          });
        }
        break;
      // Delete location type data
      case "locationtype":
        {
          // Destroy location type data with company code and loc cbm
          await LocationType.destroy({
            where: {
              company_code: requestUser.company_code,
              loc_cbm: ids,
            },
          });
        }
        break;
    }
    // Return a successful response
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `${master} is successfully deleted`,
    });
    return;
  } catch (error: any) {
    // Return a response with a 400 status code (Bad Request) and a JSON object
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
