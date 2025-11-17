// import { Like } from "typeorm";
// import { AppDataSource, getRepository } from "../../database/connection";
// import { CostMaster } from "../../entity/Purchaseflow/costmaster.entity";
// import constants from "../../helpers/constants";
// import { RequestWithUser } from "../../interfaces/common.interface";
// import { IUser } from "../../interfaces/user.interface";
// import { PurchaseFlowMasterService } from "../../services/Purchaseflow/PfMaster.service";
// import { Response } from "express";

// export const getPfglobalsearch = async (
//    req: RequestWithUser, 
//    res: Response
//  ): Promise<void> => {
//     try {
//      const { master } = req.params;
//      const requestUser: IUser = req.user;
//      const page = Number(req.query.page) ;
//      const limit = Number(req.query.limit) || 4000;
//      const { search = "" } = req.query;



//     let result: { fetchedData: any[]; totalCount: number } = {
//       fetchedData: [],
//       totalCount: 0,
//     };
//     switch(master) {
//       case "division":
//         result = await PurchaseFlowMasterService.getDivisionMaster(
//           requestUser.company_code,
//           page,
//           limit
//         );
//       break;

//        case "cost_master": {
//          const searchTerm = `%${searchVariable}%`;
//          const repo = AppDataSource.getRepository(CostMaster);

//          const [fetchedData, totalCount] = await repo.findAndCount({
//         where: [
//         {
//           company_code: requestUser.company_code,
//           cost_code: Like(searchTerm),
//         },
//         {
//          company_code: requestUser.company_code,
//          cost_name: Like(searchTerm),
//        },
//      ],
//        take: limit,
//      });

//     result = { fetchedData, totalCount };
//     break;
//     }

//      case "supplier_master":
//         result = await PurchaseFlowMasterService.getSupplierMaster (
//           requestUser.company_code,
//           page,
//           limit
//         );
//         break;






//     }
//     }
// }






