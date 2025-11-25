import { getRepository } from "../../database/connection";
import { TaAdjDetail } from "../../entity/WMS/taAdjDetail.entity";

export class TaAdjDetailService {
  private static getRepository() {
    return getRepository(TaAdjDetail);
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
    JOB_NO: string;
    PROD_CODE?: string;
    QTY_PUOM?: number;
    QTY_LUOM?: number;
    ADJ_TYPE?: string;
    COMPANY_CODE: string;
    CREATED_BY?: string;
    UPDATED_BY?: string;
  }): Promise<TaAdjDetail> {
    const repository = this.getRepository();

    const adjustment = repository.create({
      ...adjustmentData,
      CREATED_AT: new Date(),
      UPDATED_AT: new Date(),
    });

    return await repository.save(adjustment);
  }

  static async updateAdjustment(
    JOB_NO: string,
    COMPANY_CODE: string,
    updateData: Partial<TaAdjDetail>
  ): Promise<boolean> {
    const repository = this.getRepository();

    const result = await repository.update(
      { JOB_NO, COMPANY_CODE },
      {
        ...updateData,
        UPDATED_AT: new Date(),
      }
    );

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
}
