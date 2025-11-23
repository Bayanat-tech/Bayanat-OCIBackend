import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";

import { Response } from "express";
import { PurchaseFlowMasterService } from "../../services/purchaseFlow/PfMaster.service";
import { DdcostmasterService } from "../../services/purchaseFlow/ddcostmasterservice";
import { DropdownProjectMasterService } from "../../services/purchaseFlow/dropdwonprojectmaster.service";
import { ProjectMasterService } from "../../services/purchaseFlow/project_master.service";
import { DduommasterService } from "../../services/purchaseFlow/dduommaster.service";
import { DdcurrencyService } from "../../services/purchaseFlow/ddCurrency.service";
import { DdProdmasterService } from "../../services/purchaseFlow/ddprodmaster.service";
import { DdEmployeeMasterService } from "../../services/purchaseFlow/ddemployeemaster.service";
import { getPoModifyData } from "../../services/purchaseFlow/po_modify_close.service";
import { getPoNotGenerated } from "../../services/purchaseFlow/ponotgenerated.service";
import { getCancelledRequests } from "../../services/purchaseFlow/po_cancel.service";
import { WorkflowService } from "../../services/purchaseFlow/sentbackrollselection_mat.service";
import { FlowRoleService } from "../../services/purchaseFlow/sentbackrollselection.service";
import { getMyHistory } from "../../services/purchaseFlow/My_History.service";
import { getRequestRejectedData } from "../../services/purchaseFlow/my_rejected.service";
import { getMyClosedRequests } from "../../services/purchaseFlow/MyItem_CloseRequest.service";
import { getMyTaskData } from "../../services/purchaseFlow/my_task.service";
import { ItemMasterService } from "../../services/purchaseFlow/my_itemmaster.service";
// import { PurchaseFlowMasterService } from "../../services/purchaseFlow/PfMaster.service";
// import { DdcostmasterService } from "../../services/purchaseFlow/ddcostmasterservice";
// import { DropdownProjectMasterService } from "../../services/purchaseFlow/dropdwonprojectmaster.service";
// import { ProjectMasterService } from "../../services/purchaseFlow/project_master.service";
// import { DduommasterService } from "../../services/purchaseFlow/dduommaster.service";
// import { DdcurrencyService } from "../../services/purchaseFlow/ddCurrency.service";
// import { DdProdmasterService } from "../../services/purchaseFlow/ddprodmaster.service";
// import { DdEmployeeMasterService } from "../../services/purchaseFlow/ddemployeemaster.service";
// import { PoHeaderService } from "../../services/purchaseFlow/po_modify.service";
// import { PoNotGeneratedService } from "../../services/purchaseFlow/ponotgenerated.service";
// // import { POCancelService } from "../../services/purchaseFlow/po_cancel.service";
// import { WorkflowService } from "../../services/purchaseFlow/sentbackrollselection_mat.service";
// import { FlowRoleService } from "../../services/purchaseFlow/sentbackrollselection.service";
// import { PurchaseRequestHistoryService } from "../../services/purchaseFlow/My_History.service";
// // import { PRRejectedService } from "../../services/purchaseFlow/Request_Rejected.service";
// import { PurchaseCloseRequestService } from "../../services/purchaseFlow/MyItem_CloseRequest.service";
// import { MaterialRequestService } from "../../services/purchaseFlow/Pg_Material_flow_InProgress.service";
// import { getMyTaskData } from "../../services/purchaseFlow/my_task.service";
// import { ItemMasterService } from "../../services/purchaseFlow/my_itemmaster.service";
// import { getPOCancelData } from "../../services/purchaseFlow/po_cancel.service";
// import { PRRejectedService } from "../../services/purchaseFlow/Request_Cancel.service";
// import { getPRRejectedData } from "../../services/purchaseFlow/Request_Rejected.service";
// import { DdcostmasterService } from "../../services/Purchaseflow/ddcostmasterservice";
// import { PurchaseFlowMasterService } from "../../services/Purchaseflow/PfMaster.service";
// import { DropdownProjectMasterService } from "../../services/Purchaseflow/dropdwonprojectmaster.service";
// import { ProjectMasterService } from "../../services/Purchaseflow/project_master.service";
// import { DduommasterService } from "../../services/Purchaseflow/dduommaster.service";
// import { DdcurrencyService } from "../../services/Purchaseflow/ddCurrency.service";
// import { DdProdmasterService } from "../../services/Purchaseflow/ddprodmaster.service";
// import { DdEmployeeMasterService } from "../../services/Purchaseflow/ddemployeemaster.service";
// // import { PoHeaderService } from "../../services/Purchaseflow/po_modify.service";
// //import { PoNotGeneratedService } from "../../services/Purchaseflow/ponotgenerated.service";
// //import { POCancelService } from "../../services/Purchaseflow/po_cancel.service";
// import { WorkflowService } from "../../services/Purchaseflow/sentbackrollselection_mat.service";
// import { FlowRoleService } from "../../services/Purchaseflow/sentbackrollselection.service";
// import { PRRejectedService } from "../../services/Purchaseflow/Request_Rejected.service";
// //import { PurchaseCloseRequestService } from "../../services/Purchaseflow/MyItem_CloseRequest.service";
// import { MaterialRequestService } from "../../services/Purchaseflow/Pg_Material_flow_InProgress.service";
// import { getMyTaskData } from "../../services/Purchaseflow/my_task.service";
// import { ItemMasterService } from "../../services/Purchaseflow/my_itemmaster.service";
// import { getPoModifyData } from "../../services/Purchaseflow/po_modify_close.service";
// import { getMyClosedRequests } from "../../services/Purchaseflow/MyItem_CloseRequest.service";
// import { getRequestRejectedData } from "../../services/Purchaseflow/my_rejected.service";
// import { getCancelledRequests } from "../../services/Purchaseflow/po_cancel.service";
// import { getMyHistory } from "../../services/Purchaseflow/My_History.service";
// import { getPoNotGenerated } from "../../services/Purchaseflow/ponotgenerated.service";
//import { DddivisionmasterService } from "../../services/Purchaseflow/dddivisionMaster.service";
// import { DddivisionmasterService } from "../../services/Purchaseflow/dddivisionMaster.service";
//import { DddivisionmasterService} from "../../services/Purchaseflow/dddivisionMaster.service"




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

      case "po_modify":
        console.log("inside po_modify");

        try {
          const result1 = await getPoModifyData(
            requestUser.loginid,
            requestUser.company_code,
            undefined,
            page,
            limit
          );

          // Send response once
          res.json(result1);

          // Important: do not execute anything else after sending response
          return;

        } catch (err) {
          console.error("❌ Error in po_modify route:", err);

          // Only send response if headers not sent yet
          if (!res.headersSent) {
            res.status(500).json({ success: false, message: "Server error" });
          }
          return;
        }

        break;


      case "ponotgenerated":
        console.log("inside ponotgenerated");

        try {
          const result1 = await getPoNotGenerated(
            requestUser.loginid,      // loginid
            requestUser.company_code, // company_code
            undefined,                // filter
            page,
            limit
          );

          // Send response once
          res.json(result1);

          // Important: do not execute anything else after sending response
          return;

        } catch (err) {
          console.error("❌ Error in ponotgenerated route:", err);

          // Only send response if headers not sent yet
          if (!res.headersSent) {
            res.status(500).json({ success: false, message: "Server error" });
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
            requestUser.loginid,          // loginid
            requestUser.company_code,     // company_code
            undefined,                    // filter
            page,
            limit
          );

          // Send response once
          res.json(cancelledResult);

          // Stop execution after response
          return;

        } catch (err) {
          console.error("❌ Error in po_cancel route:", err);

          // Only send error if not already sent
          if (!res.headersSent) {
            res.status(500).json({ success: false, message: "Server error" });
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
            requestUser.loginid,       // pass loginid
            requestUser.company_code,  // pass company_code
            undefined,                 // optional filter
            page,
            limit
          );

          // Send response once
          res.json(historyResult);

          // Stop execution after response
          return;
        } catch (err) {
          console.error("❌ Error in My_History route:", err);

          // Only send error if headers not already sent
          if (!res.headersSent) {
            res.status(500).json({ success: false, message: "Server error" });
          }
          return;
        }

        break;

      // case "Request_Cancel":
      //   result = await PRRejectedService.getCancelledRequests(
      //     requestUser.company_code,
      //     page,
      //     limit
      //   );
      //   break;

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

          // Send response once
          res.json(rejectedResult);

          // Stop execution after response
          return;

        } catch (err) {
          console.error("❌ Error in Request_Rejected route:", err);

          // Only send error if not already sent
          if (!res.headersSent) {
            res.status(500).json({ success: false, message: "Server error" });
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


      // case "Pg_Material_flow_InProgress":
      //   result = await MaterialRequestService.getInProgressRequests(
      //     requestUser.company_code,
      //     page,
      //     limit
      //   );
      //   break;

      case "my_task":
        console.log("inside my_task");

        try {
          const result1 = await getMyTaskData(
            requestUser.loginid,
            requestUser.company_code,
            undefined,
            page,
            limit
          );

          // Send response once
          res.json(result1);

          // Important: do not execute anything else after sending response
          return;

        } catch (err) {
          console.error("❌ Error in my_task route:", err);

          // Only send response if headers not sent yet
          if (!res.headersSent) {
            res.status(500).json({ success: false, message: "Server error" });
          }
          return;
        }

        break;





      case "my_itemmaster":
        result = await ItemMasterService.getMyItemMaster(
          requestUser.company_code,
          page,
          limit
        );
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

