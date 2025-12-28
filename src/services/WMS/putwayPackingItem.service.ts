import { TiPackdet } from "../../entity/WMS/TiPackdet";
import { AppDataSource, oracleDb, getRepository } from "../../database/connection";
import { PackingDetailsInboundWms } from "../../entities/wms/transportation/inbound/PackingDetailsInboundWms.entity";
import { In } from "typeorm";

export class PutwayPackingItemService {
  /**
   * Update TI_PACKDET records to set SELECTED='Y' and ALLOCATED='N'
   * @param companyCode Company code
   * @param prinCode Principal code
   * @param jobNo Job number
   */
  async updateTiPackdetSelection(
    companyCode: string,
    prinCode: string,
    jobNo: string
  ): Promise<void> {
    const tiPackdetRepository = AppDataSource.getRepository(TiPackdet);

    await tiPackdetRepository
      .createQueryBuilder()
      .update(TiPackdet)
      .set({
        selected: "Y",
        allocated: "N",
      })
      .where("COMPANY_CODE = :companyCode", { companyCode })
      .andWhere("PRIN_CODE = :prinCode", { prinCode })
      .andWhere("JOB_NO = :jobNo", { jobNo })
      .execute();
  }

  /**
   * Mark selected packets in PackingDetailsInboundWms
   * @param companyCode Company code
   * @param prinCode Principal code
   * @param jobNo Job number
   * @param packdetNo Packing detail numbers
   * @param siteFrom Source site
   * @param siteTo Destination site
   * @param locationFrom Source location
   * @param locationTo Destination location
   */
  async markPacketsAsSelected(
    companyCode: string,
    prinCode: string,
    jobNo: string,
    packdetNo: string[],
    siteFrom: string,
    siteTo: string,
    locationFrom: string,
    locationTo: string,
    queryRunner?: any
  ): Promise<void> {
    const repository = queryRunner 
      ? queryRunner.manager.getRepository(PackingDetailsInboundWms)
      : getRepository(PackingDetailsInboundWms);

    await repository.update(
      {
        company_code: companyCode,
        prin_code: prinCode,
        job_no: jobNo,
        packdet_no: In(packdetNo),
      },
      {
        selected: "Y",
        from_site: siteFrom,
        to_site: siteTo,
        location_from: locationFrom,
        location_to: locationTo,
      }
    );
  }

  /**
   * Call SP_PUTAWAY stored procedure
   * @param companyCode Company code
   * @param principalCode Principal code
   * @param jobNo Job number
   */
  async callPutawayStoredProcedure(
    companyCode: string,
    principalCode: string,
    jobNo: string
  ): Promise<any> {
    const sql = `BEGIN SP_PUTAWAY(:vs_company_code, :vs_principal_code, :vs_job_no); END;`;
    
    const result = await AppDataSource.query(sql, [
      companyCode,
      principalCode,
      jobNo
    ]);

    return result;
  }

  /**
   * Reset packet selection status
   * @param companyCode Company code
   * @param prinCode Principal code
   * @param jobNo Job number
   * @param packdetNo Packing detail numbers
   * @param queryRunner QueryRunner object
   */
  async resetPacketSelection(
    companyCode: string,
    prinCode: string,
    jobNo: string,
    packdetNo: string[],
    queryRunner?: any
  ): Promise<void> {
    const repository = queryRunner 
      ? queryRunner.manager.getRepository(PackingDetailsInboundWms)
      : getRepository(PackingDetailsInboundWms);

    await repository.update(
      {
        company_code: companyCode,
        prin_code: prinCode,
        job_no: jobNo,
        packdet_no: In(packdetNo),
      },
      { selected: "N" }
    );
  }

  /**
   * Process complete putway operation
   * @param params Operation parameters
   */
  async processPutway(params: {
    companyCode: string;
    prinCode: string;
    jobNo: string;
    packdetNo: string[];
    siteFrom: string;
    siteTo: string;
    locationFrom: string;
    locationTo: string;
  }): Promise<void> {
    const {
      companyCode,
      prinCode,
      jobNo,
      packdetNo,
      siteFrom,
      siteTo,
      locationFrom,
      locationTo,
    } = params;

    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1️⃣ Mark selected packets in PackingDetailsInboundWms
      await this.markPacketsAsSelected(
        companyCode,
        prinCode,
        jobNo,
        packdetNo,
        siteFrom,
        siteTo,
        locationFrom,
        locationTo,
        queryRunner
      );
      console.log("Packets marked as selected");

      // 2️⃣ Update TI_PACKDET - set SELECTED='Y' and ALLOCATED='N'
      await this.updateTiPackdetSelection(companyCode, prinCode, jobNo);
      console.log("TI_PACKDET updated");

      // 3️⃣ Call SP_PUTAWAY stored procedure
      const result = await this.callPutawayStoredProcedure(
        companyCode,
        prinCode,
        jobNo
      );
      console.log("SP_PUTAWAY stored procedure executed");

      // 4️⃣ Reset selection after successful processing
      if (result) {
        await this.resetPacketSelection(companyCode, prinCode, jobNo, packdetNo, queryRunner);
        console.log("Packets reset to selected = N");
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
