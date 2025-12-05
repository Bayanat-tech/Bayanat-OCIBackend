import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";

import { Response } from "express";
import { PurchaseFlowMasterService } from "../../services/Purchaseflow/PfMaster.service";
import { DdcostmasterService } from "../../services/Purchaseflow/ddcostmasterservice";
import { DropdownProjectMasterService } from "../../services/Purchaseflow/dropdwonprojectmaster.service";
import { ProjectMasterService } from "../../services/Purchaseflow/project_master.service";
import { DdcurrencyService } from "../../services/Purchaseflow/ddCurrency.service";
import { DdProdmasterService } from "../../services/Purchaseflow/ddprodmaster.service";
import { DduommasterService } from "../../services/Purchaseflow/dduommaster.service";
import { DdEmployeeMasterService } from "../../services/Purchaseflow/ddemployeemaster.service";
import { getPoModifyData } from "../../services/Purchaseflow/po_modify_close.service";
import { getPoNotGenerated } from "../../services/Purchaseflow/ponotgenerated.service";
import { getCancelledRequests } from "../../services/Purchaseflow/po_cancel.service";
import { WorkflowService } from "../../services/Purchaseflow/sentbackrollselection_mat.service";
import { FlowRoleService } from "../../services/Purchaseflow/sentbackrollselection.service";
import { getMyHistory } from "../../services/Purchaseflow/My_History.service";
import { getRequestRejectedData } from "../../services/Purchaseflow/my_rejected.service";
import { getMyClosedRequests } from "../../services/Purchaseflow/MyItem_CloseRequest.service";
import { getMyTaskData } from "../../services/Purchaseflow/my_task.service";
import { getPoModifyRatechangeData } from "./getPoModifyRatechangeData ";




export const getPurchasefMaster = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { master } = req.params;
    const requestUser: IUser = req.user;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 4000;

    let result: {
      fetchedData: any[];
      totalCount: number;
    } = {
      fetchedData: [],
      totalCount: 0,
    };

    switch (master) {

      case "division":
        result = await PurchaseFlowMasterService.getDivisionMaster(
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "cost_master":
        result = await DdcostmasterService.getDdCostMaster(
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "matcat_master":
        result = await PurchaseFlowMasterService.getMaterialCategoryMaster(
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "supplier_master":
        result = await PurchaseFlowMasterService.getSupplierMaster(
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "customer_master":
        result = await PurchaseFlowMasterService.getCustomerMaster(
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "ddCurrency":
        result = await PurchaseFlowMasterService.getddcurrency(
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "ddMaterialCateotry":
        result = await PurchaseFlowMasterService.ddMaterialCateotry(
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "item_master":
        result = await PurchaseFlowMasterService.getItemmaster(
          requestUser.company_code,
          page,
          limit
        );
        break;


      case "dropdwonprojectmaster":
        result = await DropdownProjectMasterService.getDropdownProjectMaster(
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "project_master":
        result = await ProjectMasterService.getProjectMaster(
          requestUser.loginid,
          page,
          limit
        ); break;

      case "projectmaster":
        result = await ProjectMasterService.getRepository(
          requestUser.company_code,
          page,
          limit
        )

        break;
      case "ddcostmaster":
        result = await DdcostmasterService.getDdCostMaster(
          requestUser.company_code,
          page,
          limit
        );
        break;
      case "dduommaster":
        result = await DduommasterService.getDdUomMaster(
          requestUser.company_code,
          page,
          limit
        );
        break;
      case "ddCurrency":
        result = await DdcurrencyService.getDdCurrency(
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "ddprodmaster":
        result = await DdProdmasterService.getDdProdmaster(
          String(requestUser.company_code),
          undefined,
          page,
          limit
        );
        break;

      case "ddemployeemaster":
        result = await DdEmployeeMasterService.getDdEmployeeMaster(
          requestUser.company_code,
          page,
          limit
        );
        break;
case "po_modify_rate_change":
  try {
    const result1 = await getPoModifyRatechangeData(
      requestUser.loginid,
      requestUser.company_code,
      undefined,
      page,
      limit
    );

    res.json({
      success: result1.success,
      data: {
        tableData: result1.data || [],   // ✅ wrapped for frontend
        count: result1.count || 0        // ✅ inside data object
      },
      message: result1.message || ""
    });

    return;

  } catch (err) {
    console.error("❌ Error in po_modify_rate_change route:", err);

    res.status(500).json({
      success: false,
      data: {
        tableData: [],
        count: 0
      },
      message: "Server error"
    });

    return;
  }


case "po_modify":


  try {
    const result1 = await getPoModifyData(
      requestUser.loginid,
      requestUser.company_code,
      undefined,
      page,
      limit
    );

    // Send response and exit function
    res.json({
      success: result1.success,
      data: result1.data || [],
      count: result1.count || 0,
      message: result1.message || "",
    });
    return; // exit after sending response

  } catch (err) {
    console.error("❌ Error in po_modify route:", err);

    // Send error response if something fails
    res.status(500).json({
      success: false,
      data: [],
      count: 0,
      message: "Server error",
    });
    return; // exit after sending response
  }




 case "ponotgenerated":
  console.log("inside ponotgenerated");

  try {
    const result1 = await getPoNotGenerated(
      requestUser.loginid,       
      requestUser.company_code,  
      undefined,                 
      page,
      limit
    );

    const responsePayload = {
      success: result1.success,
      data: result1.data || [],       // renamed from tableData
      count: result1.count || 0,     // renamed from totalCount
      message: result1.message || "",
    };

    if (!res.headersSent) {
      res.json(responsePayload);
      return
    }

    return; // safe exit

  } catch (err) {
    console.error("❌ Error in ponotgenerated route:", err);

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        data: [],
        count: 0,
        message: "Server error",
      });
    }

    return;
  }

  break;






      /* case "dddivision":
         result = await DddivisionmasterService.getDdDivision(
           requestUser.company_code,
           page,
           limit
         );
         break;*/

      // case "po_modify_rate_change":
      //   result = await PoHeaderService.getPoModify(
      //     requestUser.company_code,
      //     page,
      //     limit
      //   );
      //   break;

 case "po_cancel":
  console.log("inside po_cancel");

  try {
    const cancelledResult = await getCancelledRequests(
      requestUser.loginid,       // loginid
      requestUser.company_code,  // company_code
      undefined,                 // optional filter
      page,
      limit
    );

    const responsePayload = {
      success: cancelledResult.success,
      data: cancelledResult.data || [],    // renamed from tableData
      count: cancelledResult.count || 0,   // renamed from totalCount
      message: cancelledResult.message || "",
    };

    if (!res.headersSent) {
      res.json(responsePayload);
      return;
    }

    return; // safe exit

  } catch (err) {
    console.error("❌ Error in po_cancel route:", err);

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        data: [],
        count: 0,
        message: "Server error",
      });
    }

    return;
  }

  break;



      case "sentbackrollselection_mat":
        result = {
          fetchedData: await WorkflowService.getSentBackRoles(),
          totalCount: 0
        };
        break;

      case "sentbackrollselection":
        result = await FlowRoleService.getSentBackRoles(
          requestUser.company_code,
          page,
          limit
        );
        break;


 case "My_History":
  console.log("inside My_History");

  try {
    const historyResult = await getMyHistory(
      requestUser.loginid,
      requestUser.company_code,
      undefined,
      page,
      limit
    );

    const responsePayload = {
      success: historyResult.success,
      data: historyResult.data || [],   // <-- use data
      count: historyResult.count || 0,  // <-- use count
      message: historyResult.message || "",
    };

    if (!res.headersSent) {
      res.json(responsePayload);
      return;
    }

    return; // stop further execution

  } catch (err) {
    console.error("❌ Error in My_History route:", err);

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        data: [],
        count: 0,
        message: "Server error",
      });
    }

    return;
  }

  break;



case "Request_Rejected":
  console.log("inside Request_Rejected");

  try {
    const rejectedResult = await getRequestRejectedData(
      requestUser.loginid,        // loginid
      requestUser.company_code,   // company_code
      undefined,                  // filter
      page,
      limit
    );

    const responsePayload = {
      success: rejectedResult.success,
      data: rejectedResult.data || [],
      count: rejectedResult.count || 0,
      message: rejectedResult.message || "",
    };

    // Send response only if headers not sent
    if (!res.headersSent) {
      res.json(responsePayload);
      return;
    }

    return; // safe exit

  } catch (err) {
    console.error("❌ Error in Request_Rejected route:", err);

    // Send error only if headers not sent
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        data: [],
        count: 0,
        message: "Server error",
      });
    }

    return;
  }

  break;


      case "MyItem_ClosedRequest":
    console.log("inside MyItem_ClosedRequest");

    try {
      const resultClosed = await getMyClosedRequests(
        requestUser.loginid,          // loginid (first parameter)
        requestUser.company_code,     // company_code (second parameter)
        undefined,                    // filter
        page,
        limit
      );

      // Send response once
      res.json(resultClosed);

      // Important: stop execution after response
      return;

    } catch (err) {
      console.error("❌ Error in MyItem_ClosedRequest route:", err);

      // Only send response if headers not already sent
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: "Server error" });
      }
      return;
    }

    break;


     
 case "my_task":
  console.log("inside my_task");

  try {
    const result = await getMyTaskData(
      requestUser.loginid,
      requestUser.company_code,
      undefined,
      page,
      limit
    );

    const responsePayload = {
      success: result.success,
      data: result.data || [],
      count: result.count || 0,
      message: result.message || "",
    };

    if (!res.headersSent) {
      res.json(responsePayload); 
      return
    }

    return; // safe exit

  } catch (err) {
    console.error("❌ Error in my_task route:", err);

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        data: [],
        count: 0,
        message: "Server error",
      });
    }
    
    return;
  }
  break;
      case "my_itemmaster":
        // result = await ItemMasterService.getMyItemMaster(
        //   requestUser.company_code,
        //   page,
        //   limit
        // );
        break;


      default:
        res.status(constants.STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: `Invalid master type: ${master}`,
        });
    }



    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: result.fetchedData,
      total: result.totalCount,
      message: "Data fetched successfully.",
    });
  } catch (error) {
    console.error("Error in getPurchasefMaster:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Error fetching master data.",
    });
  }
};
// function getRequestRejectedData(company_code: string, page: number, limit: number): { fetchedData: any[]; totalCount: number; } | PromiseLike<{ fetchedData: any[]; totalCount: number; }> {
//   throw new Error("Function not implemented.");
// }

