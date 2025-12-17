import { getRepository, oracleDb } from "../../database/connection";
import { SupplierMaster } from "../../entity/PurchaseFlow/suppliermaster_pf.entity";
import constants from "../../helpers/constants";

export class SupplierMasterService {
  private static getRepository() {
    return getRepository(SupplierMaster);
  }

  // --- CALL MESSAGE BOX ---
  static async callMessageBox(params: {
    screen: string;
    type: string;
    document_number?: string;
    userId: string;
    message: string;
  }) {
    await oracleDb.query(
      `CALL PROC_LOADMESSAGEBOX(:screen, :type, :document_number, :userId, :message)`,
      [
        params.screen,
        params.type,
        params.document_number ?? "",
        params.userId,
        params.message,
      ]
    );
  }

  // --- CHECK DUPLICATE ---
  static async findDuplicate(company_code: string, supp_code: string) {
    const repo = this.getRepository();
    return await repo.findOne({
      where: { company_code, supp_code },
    });
  }

  // --- CREATE ---
  static async createSupplier(data: any) {
    const repo = this.getRepository();

    const duplicate = await this.findDuplicate(data.company_code, data.supp_code);

    if (duplicate) {
      await this.callMessageBox({
        screen: "TRNFAIL",
        type: "error",
        document_number: "",
        userId: data.created_by,
        message: constants.MESSAGES.SUPPLIER_PF.SUPPLIER_ALREADY_EXISTS,
      });

      return {
        success: false,
        message: constants.MESSAGES.SUPPLIER_PF.SUPPLIER_ALREADY_EXISTS,
        status: constants.STATUS_CODES.BAD_REQUEST,
      };
    }

    const supplier = repo.create({
      ...data,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const saved = await repo.save(supplier);

    await this.callMessageBox({
      screen: "SUPPLIERADDED",
      type: "success",
      document_number: "",
      userId: data.created_by,
      message: constants.MESSAGES.SUPPLIER_PF.SUPPLIER_CREATED_SUCCESSFULLY,
    });

    return {
      success: true,
      message: constants.MESSAGES.SUPPLIER_PF.SUPPLIER_CREATED_SUCCESSFULLY,
      data: saved,
      status: constants.STATUS_CODES.OK,
    };
  }

  // --- UPDATE ---
  static async updateSupplier(
    company_code: string, 
    supp_code: string, updateData: any) {
    const repo = this.getRepository();

    const existing = await repo.findOne({
      where: { company_code, supp_code },
    });

    if (!existing) {
      await this.callMessageBox({
        screen: "TRNFAIL",
        type: "error",
        document_number: "",
        userId: updateData.updated_by,
        message: constants.MESSAGES.SUPPLIER_PF.SUPPLIER_DOES_NOT_EXIST,
      });

      return {
        success: false,
        message: constants.MESSAGES.SUPPLIER_PF.SUPPLIER_DOES_NOT_EXIST,
        status: constants.STATUS_CODES.BAD_REQUEST,
      };
    }

    const result = await repo.update(
      { company_code, supp_code },
      {
        ...updateData,
        updated_at: new Date(),
      }
    );

    if (!result.affected || result.affected === 0) {
      return {
        success: false,
        message: "Error while updating supplier",
        status: constants.STATUS_CODES.INTERNAL_SERVER_ERROR,
      };
    }

    await this.callMessageBox({
      screen: "SUPPLIERUPDATED",
      type: "success",
      document_number: "",
      userId: updateData.updated_by,
      message: constants.MESSAGES.SUPPLIER_PF.SUPPLIER_UPDATED_SUCCESSFULLY,
    });

    return {
      success: true,
      message: constants.MESSAGES.SUPPLIER_PF.SUPPLIER_UPDATED_SUCCESSFULLY,
      status: constants.STATUS_CODES.OK,
    };
  }
}
