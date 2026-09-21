import { getRepository, AppDataSource } from "../../database/connection";
import { TsStn } from "../../entity/WMS/TsStn.entity";
import { In } from "typeorm";

export class 
TsStnService {
  private static getTsStnRepository() {
    return getRepository(TsStn);
  }
// Find all STN records with principal name
static async findAllWithPrincipalName(company_code: string): Promise<(TsStn & { prin_name: string })[]> {
  const result = await AppDataSource.query(
    `
    SELECT s.*, p.prin_name
    FROM ts_stn s
    LEFT JOIN ms_principal p 
      ON s.prin_code = p.prin_code 
      AND s.company_code = p.company_code
    WHERE s.company_code = :1
    ORDER BY s.stn_no DESC
    `,
    [company_code]
  );
  return result;
}
  // Get all STN records
  static async findAll(): Promise<TsStn[]> {
    const repository = this.getTsStnRepository();
    return await repository.find({
      order: {
        stn_no: "DESC",
      },
    });
  }

  // Find STN by stn_no and company_code
  static async findById(params: {
    stn_no: number;
    company_code: string;
  }): Promise<TsStn | null> {
    const repository = this.getTsStnRepository();
    return await repository.findOne({
      where: {
        stn_no: params.stn_no,
        company_code: params.company_code,
      },
    });
  }

  // Find STN records by company_code
  static async findByCompanyCode(company_code: string): Promise<TsStn[]> {
    const repository = this.getTsStnRepository();
    return await repository.find({
      where: { company_code },
    });
  }

  // Find STN records by company_code and prin_code
  static async findByCompanyAndPrinCode(params: {
    company_code: string;
    prin_code: string;
  }): Promise<TsStn[]> {
    const repository = this.getTsStnRepository();
    return await repository.find({
      where: {
        company_code: params.company_code,
        prin_code: params.prin_code,
      },
    });
  }

  // Find STN records by multiple prin_codes
  static async findByCompanyAndMultiplePrinCodes(params: {
    company_code: string;
    prin_codes: string[];
  }): Promise<TsStn[]> {
    const repository = this.getTsStnRepository();
    return await repository.find({
      where: {
        company_code: params.company_code,
        prin_code: In(params.prin_codes),
      },
      order: {
        prin_code: "ASC",
        stn_no: "ASC",
      },
    });
  }

  // Create new STN record
  static async createStn(stnData: Partial<TsStn>): Promise<TsStn> {
  const repository = AppDataSource.getRepository(TsStn);
    const stn = repository.create(stnData);
    return await repository.save(stn);
  }

  // Update existing STN record
  static async updateStn(
    params: { stn_no: number; company_code: string },
    updateData: Partial<TsStn>
  ): Promise<boolean> {
    const repository = this.getTsStnRepository();

    const result = await repository.update(
      {
        stn_no: params.stn_no,
        company_code: params.company_code,
      },
      updateData
    );

    return result.affected ? result.affected > 0 : false;
  }

  // Delete STN record
  static async deleteStn(params: {
    stn_no: number;
    company_code: string;
  }): Promise<boolean> {
    const repository = this.getTsStnRepository();
    const result = await repository.delete({
      stn_no: params.stn_no,
      company_code: params.company_code,
    });
    return result.affected ? result.affected > 0 : false;
  }

  // Check if STN exists
  static async checkStnExists(params: {
    stn_no: number;
    company_code: string;
  }): Promise<boolean> {
    const repository = this.getTsStnRepository();
    const count = await repository.count({
      where: {
        stn_no: params.stn_no,
        company_code: params.company_code,
      },
    });
    return count > 0;
  }

  // Find allocated STN records
  static async findAllocated(company_code: string): Promise<TsStn[]> {
    const repository = this.getTsStnRepository();
    return await repository.find({
      where: {
        company_code,
        allocated: "Y",
      },
    });
  }

  // Find confirmed STN records
  static async findConfirmed(company_code: string): Promise<TsStn[]> {
    const repository = this.getTsStnRepository();
    return await repository.find({
      where: {
        company_code,
        confirmed: "Y",
      },
    });
  }

  // Update allocation status
  static async updateAllocationStatus(
    params: { stn_no: number; company_code: string },
    allocated: string
  ): Promise<boolean> {
    const repository = this.getTsStnRepository();
    const result = await repository.update(
      {
        stn_no: params.stn_no,
        company_code: params.company_code,
      },
      {
        allocated,
        allocated_date: new Date(),
      }
    );
    return result.affected ? result.affected > 0 : false;
  }

  // Update confirmation status
  static async updateConfirmationStatus(
    params: { stn_no: number; company_code: string },
    confirmed: string
  ): Promise<boolean> {
    const repository = this.getTsStnRepository();
    const result = await repository.update(
      {
        stn_no: params.stn_no,
        company_code: params.company_code,
      },
      {
        confirmed,
        confirmed_date: new Date(),
      }
    );
    return result.affected ? result.affected > 0 : false;
  }

  // Process stock transfer by calling SP_WM_TRANSFER_PROCESS
  static async processStockTransfer(params: {
    company_code: string;
    prin_code: string;
    stn_no: number;
    user_id: string;
  }): Promise<void> {
    await AppDataSource.query(
      `BEGIN SP_WM_TRANSFER_PROCESS(:1, :2, :3, :4); END;`,
      [params.company_code, params.prin_code, params.stn_no, params.user_id]
    );
  }

  // Confirm stock transfer by calling SP_STOCK_TRANSFER_CONFIRM stored procedure
  static async confirmStockTransfer(params: {
    company_code: string;
    principal_code: string;
    stn_no: number;
  }): Promise<void> {
    await AppDataSource.query(
      `BEGIN SP_STOCK_TRANSFER_CONFIRM(:1, :2, :3); END;`,
      [params.company_code, params.principal_code, params.stn_no]
    );
  }
}
