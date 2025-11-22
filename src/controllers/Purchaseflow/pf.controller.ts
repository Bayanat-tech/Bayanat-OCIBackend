import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import { PurchaseFlowMasterService } from "../../services/Purchaseflow/PfMaster.service";
import { Response } from "express";

export const getPfMaster = async (
  req: RequestWithUser, 
  res: Response
): Promise<void> => {
  try {
    const { master } = req.params;
    const requestUser: IUser = req.user;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 4000;

    let result: { fetchedData: any[]; totalCount: number } = {
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
        result = await PurchaseFlowMasterService.getCostMaster (
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "matcat_master":
        result = await PurchaseFlowMasterService.getMaterialCategoryMaster (
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "supplier_master":
        result = await PurchaseFlowMasterService.getSupplierMaster (
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "customer_master":
        result = await PurchaseFlowMasterService.getCustomerMaster (
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "ddCurrency":
        result = await PurchaseFlowMasterService.getddcurrency (
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "ddMaterialCateotry":
         result = await PurchaseFlowMasterService.ddMaterialCateotry (
          requestUser.company_code,
          page,
          limit
        );
        break;
      
      case "item_master":
        result = await PurchaseFlowMasterService.getItemmaster (
          requestUser.company_code,
          page,
          limit
        );
        break;

      // case "dropdwonprojectmaster":
      //   result=await DropdownProjectMasterService.getDropdownProjectMaster(
      //      requestUser.company_code,
      //     page,
      //     limit
      //   );
      //   break;

      case "project_master":
          result=await PurchaseFlowMasterService.getProjectMaster(
            requestUser.loginid,
            page,
          limit
          );
          break;

        // case "projectmaster":
        //   result =await PurchaseFlowMasterService.getProjectMasterService(
        //   requestUser.company_code,
        //   page,
        //   limit
        //   );
        // break;

      // case "ddcostmaster":
      //   result = await DdcostmasterService.getDdCostMaster(
      //     requestUser.company_code,
      //     page,
      //     limit
      //   );
      //   break;
      // case "dduommaster":
      //   result = await DduommasterService.getDdUomMaster(
      //     requestUser.company_code,
      //     page,
      //     limit
      //   );
      //   break;
      // case "ddCurrency":
      //   result = await DdcurrencyService.getDdCurrency(
      //     requestUser.company_code,
      //     page,
      //     limit
      //   );
      //   break;

      // case "ddprodmaster":
      //   result = await DdProdmasterService.getDdProdmaster(
      //     String(requestUser.company_code),
      //     undefined,
      //     page,
      //     limit
      //   );
      //   break;

      // case "ddemployeemaster":
      //   result = await DdEmployeeMasterService.getDdEmployeeMaster(
      //     requestUser.company_code,
      //     page,
      //     limit
      //   );
      //   break;

      // case "po_modify":
      //   result = await PoHeaderService.getPoModify(
      //     requestUser.company_code,
      //     page,
      //     limit
      //   );
      //   break;

      // case "ponotgenerated":
      //   result = await PoNotGeneratedService.getPoNotGenerated(
      //     requestUser.company_code,
      //     page,
      //     limit
      //   );
      //   break;

      // case "dddivision":
      //   result = await DddivisionmasterService.getDdDivision(
      //     requestUser.company_code,
      //     page,
      //     limit
      //   );
      //   break;

      // case "po_modify_rate_change":
      //   result = await PoHeaderService.getPoModify(
      //     requestUser.company_code,
      //     page,
      //     limit
      //   );
      //   break;

      // case "po_cancel":
      //   result = await POCancelService.getPOCancelData(
      //     String(requestUser.company_code),
      //     undefined,
      //     page,
      //     limit
      //   );
      //   break;


      // case "sentbackrollselection_mat":
      //   result = {
      //     fetchedData: await WorkflowService.getSentBackRoles(),
      //     totalCount: 0
      //   };
      //   break;

      // case "sentbackrollselection":
      //   result = await FlowRoleService.getSentBackRoles(
      //     requestUser.company_code,
      //     page,
      //     limit
      //   );
      //   break;


      // case "My_History":
      //   result = await PurchaseRequestHistoryService.getMyHistory(
      //     requestUser.company_code,
      //     undefined,
      //     page,
      //     limit
      //   );
      //   break;

      // case "Request_Cancel":
      //   result = await PRRejectedService.getCancelledRequests(
      //     requestUser.company_code,
      //     page,
      //     limit
      //   );
      //   break;

      // case "Request_Rejected":
      //   result = await PRRejectedService.getRequestRejectedData(
      //     requestUser.company_code,
      //     page,
      //     limit
      //   );
      //   break;

      // case "MyItem_ClosedRequest":
      //   result = await PurchaseCloseRequestService.getMyClosedRequests(
      //     requestUser.company_code,
      //     requestUser.loginid,
      //     undefined, // optional filter
      //     page,
      //     limit
      //   );
      //   break;

      // case "Pg_Material_flow_InProgress":
      //   result = await MaterialRequestService.getInProgressRequests(
      //     requestUser.company_code,
      //     page,
      //     limit
      //   );
      //   break;

      // case "my_task":
      //   result = await myTask.getMyTaskData(
      //     requestUser.company_code,
      //     page,
      //     limit
      //   );
      //   break;

      // case "my_itemmaster":
      //   result = await ItemMasterService.getMyItemMaster(
      //     requestUser.company_code,
      //     page,
      //     limit
      //   );
      // break;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: result.fetchedData,
      total: result.totalCount,
      message: "data fetched successfully.",
    });
  } catch (error) {
    console.error("Error in getPfMaster:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Error fetching master data.",
    });
  }
};
 //------------------- delete Master -------------------------------
export const deletePfMaster = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { master } = req.params;
    const requestUser = req.user;
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "IDs (codes) are required for deletion",
      });
      return;
    }

    const isDeleted = await PurchaseFlowMasterService.deleteMasterRecords(
      master,
      requestUser.company_code,
      ids
    );

    if (!isDeleted) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "No records were deleted",
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `${master} records deleted successfully`,
    });
  } catch (error: any) {
    console.error("Error in deletePfMaster:", error);

    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error",
    });
  }
};
