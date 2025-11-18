import { AppDataSource, getRepository } from "../../database/connection";
import { Divisionmaster } from "../../entity/Purchaseflow/Pf_divisionmaster.entity";
import { CostMaster } from "../../entity/Purchaseflow/costmaster.entity";
import { CustomerMaster } from "../../entity/Purchaseflow/customermaster.entity";
import { DdCurrency } from "../../entity/Purchaseflow/ddcurrency_pf_models.entity";
import { ItemmasterPf } from "../../entity/Purchaseflow/itemmaster.entity";
import { MaterialCategoryMaster } from "../../entity/Purchaseflow/materialcategary.entity";
import { VProjectMaster } from "../../entity/Purchaseflow/projectmaster_pf_view.entity";
import { SupplierMaster } from "../../entity/Purchaseflow/suppliermaster_pf.entity";

export interface Master<T> {
  fetchedData: T[];
  totalCount: number;
}

export class PurchaseFlowMasterService {
  static async getDivisionMaster(
    company_code: string,
    page = 1,
    limit = 4000
  ): Promise<Master<Divisionmaster>> {
    const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(Divisionmaster).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });

    return { fetchedData, totalCount };
  }
// Get Cost Master
  static async getCostMaster(
    company_code: string,
    page = 1,
    limit = 4000
  ): Promise<Master<CostMaster>> {
    const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(CostMaster).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });

    return { fetchedData, totalCount };
  }

  static async getMaterialCategoryMaster(
    company_code: string,
    page = 1,
    limit = 4000
  ): Promise<Master<MaterialCategoryMaster>> {
    const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(MaterialCategoryMaster).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });

    return { fetchedData, totalCount };
  }

  static async getSupplierMaster(
    company_code: string, 
    page = 1, 
    limit = 4000
  ): Promise<Master<SupplierMaster>> {
    const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(SupplierMaster).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });
    return { fetchedData, totalCount };
  }

  static async getCustomerMaster(
    company_code: string, 
    page = 1, 
    limit = 4000
  ): Promise<Master<CustomerMaster>> {
    const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(CustomerMaster).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });
    return { fetchedData, totalCount };
  }
 
   static async getddcurrency(
    company_code: string, 
    page = 1, 
    limit = 4000
  ): Promise<Master<DdCurrency>> {
    const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(DdCurrency).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });
    return { fetchedData, totalCount };
  }

   static async ddMaterialCateotry(
    company_code: string, 
    page = 1, 
    limit = 4000
  ): Promise<Master<DdCurrency>> {
    const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(DdCurrency).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });
    return { fetchedData, totalCount };
  }

  static async getItemmaster(
    company_code: string, 
    page = 1, 
    limit = 4000
  ): Promise<Master<ItemmasterPf>> {
    const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(ItemmasterPf).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });
    return { fetchedData, totalCount };
  }

  static async getProjectMaster(
    loginid: string,
    page = 1,
    limit = 4000
  ): Promise<Master<VProjectMaster>> {
    const skip = (page - 1) * limit;
    const repository = getRepository(VProjectMaster);

    let fetchedData: VProjectMaster[] = [];
    let totalCount = 0;

   
    if (loginid !== "PRAKASH") {
      [fetchedData, totalCount] = await repository
        .createQueryBuilder("proj")
        .where(
          `proj.project_code IN (
            SELECT project_code 
            FROM MS_PROJECT_USER_ASSIGN 
            WHERE user_id = :loginid
          )`,
          { loginid }
        )
        .skip(skip)
        .take(limit)
        .getManyAndCount();
    } else {
      [fetchedData, totalCount] = await repository
        .createQueryBuilder("proj")
        .skip(skip)
        .take(limit)
        .getManyAndCount();
    }

    return { fetchedData, totalCount };
  }
}

// export class DeletePfService {
//   static async deleteRecords(
//     master: string,
//     company_code: string,
//     ids: (string | number)[]
//   ): Promise<boolean> {

//     const queryRunner = AppDataSource.createQueryRunner();
//     await queryRunner.connect();
//     await queryRunner.startTransaction();

//     try {
//       let result;

//       switch (master) {
        
//         // -------------------- PROJECT MASTER --------------------
//         case "project_master":
//           result = await queryRunner.manager.delete(ProjectMaster, {
//             company_code,
//             project_code: In(ids as string[]),
//           });
//           break;

//         // -------------------- COST MASTER --------------------
//         case "cost_master":
//           result = await queryRunner.manager.delete(Costmaster, {
//             company_code,
//             cost_code: In(ids as string[]),
//           });
//           break;

//         // -------------------- FLOW MASTER --------------------
//         case "flow_master":
//           result = await queryRunner.manager.delete(FlowMaster, {
//             company_code,
//             flow_code: In(ids as string[]),
//           });
//           break;

//         // -------------------- ROLE MASTER --------------------
//         case "role_master":
//           result = await queryRunner.manager.delete(RoleMaster, {
//             company_code,
//             role_id: In(ids as number[]),
//           });
//           break;

//         // -------------------- USER LOGIN --------------------
//         case "sec_login":
//           result = await queryRunner.manager.delete(User, {
//             company_code,
//             id: In(ids as number[]),
//           });
//           break;

//         // -------------------- MODULE --------------------
//         case "sec_module_data":
//           result = await queryRunner.manager.delete(SecModule, {
//             company_code,
//             serial_no: In(ids as number[]),
//           });
//           break;

//         // -------------------- COMPANY --------------------
//         case "sec_company":
//           result = await queryRunner.manager.delete(Company, {
//             company_code: In(ids as string[]),
//           });
//           break;

//         // -------------------- REPORT MASTER --------------------
//         case "report_master":
//           result = await queryRunner.manager.delete(ReportMaster, {
//             report_no: In(ids as number[]),
//           });
//           break;

//         // -------------------- QUERY MASTER --------------------
//         case "query_master":
//           result = await queryRunner.manager.delete(QueryMaster, {
//             sr_no: In(ids as number[]),
//           });
//           break;

//         default:
//           throw new Error(`Unknown master type: ${master}`);
//       }

//       await queryRunner.commitTransaction();
//       return result?.affected > 0;

//     } catch (err) {
//       await queryRunner.rollbackTransaction();
//       throw err;
//     } finally {
//       await queryRunner.release();
//     }
//   }
// }
