import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import { DdcostmasterService } from "../../services/purchaseFlow/ddcostmasterservice";
import { Response } from "express";
import { DduommasterService } from "../../services/purchaseFlow/dduommaster.service";
import { DdcurrencyService } from "../../services/purchaseFlow/ddCurrency.service";
import { DdProdmasterService } from "../../services/purchaseFlow/ddprodmaster.service";
import { DdEmployeeMasterService } from "../../services/purchaseFlow/ddemployeemaster.service";
import { PoHeaderService } from "../../services/purchaseFlow/po_modify.service";
import { PoNotGeneratedService } from "../../services/purchaseFlow/ponotgenerated.service";
import { DddivisionmasterService } from "../../services/purchaseFlow/dddivisionMaster.service";
import { POCancelService } from "../../services/purchaseFlow/po_cancel.service";
import { WorkflowService } from "../../services/purchaseFlow/sentbackrollselection_mat.service";
import { FlowRoleService } from "../../services/purchaseFlow/sentbackrollselection.service";
import { PurchaseRequestHistoryService } from "../../services/purchaseFlow/My_History.service";
import { PRRejectedService } from "../../services/purchaseFlow/Request_Rejected.service";
import { PurchaseCloseRequestService } from "../../services/purchaseFlow/MyItem_CloseRequest.service";
import { MaterialRequestService } from "../../services/purchaseFlow/Pg_Material_flow_InProgress.service";
import { myTask } from "../../services/purchaseFlow/my_task.service";
import { ItemMasterService } from "../../services/purchaseFlow/my_itemmaster.service";
import { DropdownProjectMasterService } from "../../services/purchaseFlow/dropdwonprojectmaster.service";
import { ProjectMasterService } from "../../services/purchaseFlow/project_master.service";




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

       case "dropdwonprojectmaster":
        result=await DropdownProjectMasterService.getDropdownProjectMaster(
           requestUser.company_code,
          page,
          limit
        );
        break;

        case "project_master":
          result=await ProjectMasterService.getProjectMaster(
            requestUser.loginid,
            page,
          limit
          );break;

          case "projectmaster":
            result =await ProjectMasterService.getRepository(
              requestUser.company_code,
          page,
          limit
            )


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
        result = await PoHeaderService.getPoModify(
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "ponotgenerated":
        result = await PoNotGeneratedService.getPoNotGenerated(
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "dddivision":
        result = await DddivisionmasterService.getDdDivision(
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "po_modify_rate_change":
        result = await PoHeaderService.getPoModify(
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "po_cancel":
        result = await POCancelService.getPOCancelData(
          String(requestUser.company_code),
          undefined,
          page,
          limit
        );
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
        result = await PurchaseRequestHistoryService.getMyHistory(
          requestUser.company_code,
          undefined,
          page,
          limit
        );
        break;

      case "Request_Cancel":
        result = await PRRejectedService.getCancelledRequests(
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "Request_Rejected":
        result = await PRRejectedService.getRequestRejectedData(
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "MyItem_ClosedRequest":
        result = await PurchaseCloseRequestService.getMyClosedRequests(
          requestUser.company_code,
          requestUser.loginid,
          undefined, // optional filter
          page,
          limit
        );
        break;

      case "Pg_Material_flow_InProgress":
        result = await MaterialRequestService.getInProgressRequests(
          requestUser.company_code,
          page,
          limit
        );
        break;

      case "my_task":
        result = await myTask.getMyTaskData(
          requestUser.company_code,
          page,
          limit
        );
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
