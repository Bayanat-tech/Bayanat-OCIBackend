import { getRepository, AppDataSource } from "../../database/connection";
import { TaAdjDetail } from "../../entity/WMS/taAdjDetail.entity";
import oracledb from "oracledb";
import { executeRaw } from "./tenant-service.helper";

export class TaAdjDetailService {
  private static getRepository() {
    return AppDataSource.getRepository(TaAdjDetail);
  }

  static async findAll(): Promise<TaAdjDetail[]> {
    const repository = this.getRepository();
    return await repository.find();
  }

  static async findByJobNo(JOB_NO: string, COMPANY_CODE: string): Promise<TaAdjDetail | null> {
    const repository = this.getRepository();
    return await repository.findOne({
      where: { JOB_NO, COMPANY_CODE },
    });
  }

  static async findByCompany(COMPANY_CODE: string): Promise<TaAdjDetail[]> {
    const repository = this.getRepository();
    return await repository.find({
      where: { COMPANY_CODE },
    });
  }

  static async createAdjustment(adjustmentData: {
    ADJ_NO: number;
    ADJ_SERIALNO: number;
    JOB_NO: string;
    PROD_CODE?: string;
    ADJ_TYPE?: string;
    QTY_PUOM?: number;
    SITE_CODE?: string;
    LOCATION_CODE?: string;
    QTY_LUOM?: number;
    PRIN_CODE?: string;
    P_UOM?: string;
    L_UOM?: string;
    PALLET_ID?: string;
    KEY_NUMBER?: string;
    COMPANY_CODE: string;
    CREATED_BY?: string;
    UPDATED_BY?: string;
  }): Promise<TaAdjDetail> {
    const repository = this.getRepository();

    // Generate unique IDENTITY_NUMBER
    const IDENTITY_NUMBER = await this.getNextIdentityNumber();

    const adjustment = repository.create({
      ...adjustmentData,
      IDENTITY_NUMBER,
    });

    return await repository.save(adjustment);
  }

  static async createAdjustmentDetail(detailData: {
    ADJ_NO: number;
    ADJ_SERIALNO: number;
    PRIN_CODE: string;
    COMPANY_CODE: string;
    PROD_CODE?: string;
    SITE_CODE?: string;
    LOCATION_CODE?: string;
    P_UOM?: string;
    L_UOM?: string;
    JOB_NO?: string;
    LOT_NO?: string;
    MANU_CODE?: string;
    DOC_REF?: string;
    KEY_NUMBER?: string;
    PALLET_ID?: string;
    QTY_PUOM?: number;
    QTY_LUOM?: number;
    ADJ_TYPE?: string;
    USER_ID?: string;
    MFG_DATE? : any;
    EXP_DATE?: any;
    BATCH_NO?:string; 
  }): Promise<TaAdjDetail> {
    const repository = this.getRepository();

    // Generate unique IDENTITY_NUMBER
    const IDENTITY_NUMBER = await this.getNextIdentityNumber();

    const adjustment = repository.create({
      ...detailData,
      IDENTITY_NUMBER,
      POSTED_IND: 'N',
      SELECTED: 'N',
      CONFIRMED: 'N',
    });

    return await repository.save(adjustment);
  }

// Service
static async updateAdjustment(
  whereCondition: {
    ADJ_NO: number;
    ADJ_SERIALNO: number;
    PRIN_CODE: string;
    COMPANY_CODE: string;
  },
  updateData: Partial<TaAdjDetail>
): Promise<boolean> {
  const repository = this.getRepository();
  const result = await repository.update(whereCondition, updateData);
  return result.affected ? result.affected > 0 : false;
}

  static async deleteAdjustment(JOB_NO: string, COMPANY_CODE: string): Promise<boolean> {
    const repository = this.getRepository();
    const result = await repository.delete({ JOB_NO, COMPANY_CODE });
    return result.affected ? result.affected > 0 : false;
  }

  static async checkExists(JOB_NO: string, COMPANY_CODE: string): Promise<boolean> {
    const repository = this.getRepository();
    const count = await repository.count({
      where: { JOB_NO, COMPANY_CODE },
    });
    return count > 0;
  }

  static async getNextIdentityNumber(): Promise<number> {
    const repository = this.getRepository();

    // Get the maximum IDENTITY_NUMBER and increment by 1 (tenant-safe)
    const latest = await repository.find({
      select: ["IDENTITY_NUMBER"],
      order: { IDENTITY_NUMBER: "DESC" },
      take: 1,
    });

    const maxIdentityNumber = latest[0]?.IDENTITY_NUMBER || 0;
    const nextIdentityNumber = maxIdentityNumber + 1;

    // Ensure the value is an integer
    return Math.floor(nextIdentityNumber);
  }

static async processAdjustment(data: {
  COMPANY_CODE: string;
  PRIN_CODE: string;
  ADJ_NO: number;
  USERID: string;
  P_ADJ_SERIALNO: string;
}): Promise<void> {
  try {
    await executeRaw(
      // ✅ matches: ('BSG', '0001', 17, 'Admin', 1)
      `BEGIN SP_WM_ADJUSTMNT_PROCESS(:P_COMPANY_CODE, :P_PRIN_CODE, :P_ADJ_NO, :P_USERID, :P_ADJ_SERIALNO); END;`,
      {
        P_COMPANY_CODE: data.COMPANY_CODE,
        P_PRIN_CODE: data.PRIN_CODE,
        P_ADJ_NO: data.ADJ_NO,
        P_USERID: data.USERID,
        P_ADJ_SERIALNO: data.P_ADJ_SERIALNO,  // 👈 was missing entirely before
      }
    );
  } catch (error: any) {
    throw new Error(`Failed to process adjustment: ${error.message}`);
  }
}

static async confirmAdjDetail(data: {
  P_COMPANY_CODE: string;
  P_PRIN_CODE: string;
  P_ADJ_NO: number;
  P_USERID: string;       // 👈 add
  P_ADJ_SERIALNO: string;
}): Promise<void> {
  try {
    await executeRaw(
      `BEGIN SP_WM_ADJUSTMNT_CONFIRM(:P_COMPANY_CODE, :P_PRIN_CODE, :P_ADJ_NO, :P_USERID, :P_ADJ_SERIALNO); END;`,
      {
        P_COMPANY_CODE: data.P_COMPANY_CODE,
        P_PRIN_CODE: data.P_PRIN_CODE,
        P_ADJ_NO: data.P_ADJ_NO,
        P_USERID: data.P_USERID,            // 👈 add
        P_ADJ_SERIALNO: data.P_ADJ_SERIALNO,
      }
    );
  } catch (error: any) {
    throw new Error(`Failed to confirm adjustment: ${error.message}`);
  }
}

}
