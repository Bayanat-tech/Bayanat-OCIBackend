import { In } from "typeorm";
import { AppDataSource } from "../../database/connection";
import { TiPackdet } from "../../entity/WMS/TiPackdet";
import { PackingDetailsInboundWms } from "../../entity/WMS/transaction/inbound/PackingDetailsInboundWms.entity";
import { executeRaw } from "./tenant-service.helper";

export class PutwayPackingItemService {

  async markPacketsAsSelected(
    companyCode: string,
    prinCode: string,
    jobNo: string,
    packdetNo: string[],
    siteFrom: string,
    siteTo: string,
    locationFrom: string,
    locationTo: string
  ): Promise<void> {
    await AppDataSource.getRepository(PackingDetailsInboundWms).update(
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
    console.log("✅ PackingDetailsInboundWms updated");
  }

  async updateTiPackdet(
    companyCode: string,
    prinCode: string,
    jobNo: string
  ): Promise<void> {
    await AppDataSource.getRepository(TiPackdet).update(
      {
        company_code: companyCode,
        prin_code: prinCode,
        job_no: jobNo,
      },
      {
        selected: "Y",
        allocated: "N",
      }
    );
    console.log("✅ TI_PACKDET updated");
  }

  async resetPacketSelection(
    companyCode: string,
    prinCode: string,
    jobNo: string,
    packdetNo: string[]
  ): Promise<void> {
    await AppDataSource.getRepository(PackingDetailsInboundWms).update(
      {
        company_code: companyCode,
        prin_code: prinCode,
        job_no: jobNo,
        packdet_no: In(packdetNo),
      },
      { selected: "N" }
    );
    console.log("✅ Packet selection reset");
  }

  async callPutawayStoredProcedure(
    companyCode: string,
    prinCode: string,
    jobNo: string
  ): Promise<void> {
    await executeRaw(
      `BEGIN SP_PUTAWAY_NORMAL(:1, :2, :3); END;`,
      [companyCode, prinCode, jobNo]
    );
    console.log("✅ Stored procedure executed");
  }

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
    await this.markPacketsAsSelected(
      params.companyCode,
      params.prinCode,
      params.jobNo,
      params.packdetNo,
      params.siteFrom,
      params.siteTo,
      params.locationFrom,
      params.locationTo
    );

    await this.updateTiPackdet(
      params.companyCode,
      params.prinCode,
      params.jobNo
    );

    await this.callPutawayStoredProcedure(
      params.companyCode,
      params.prinCode,
      params.jobNo
    );

    await this.resetPacketSelection(
      params.companyCode,
      params.prinCode,
      params.jobNo,
      params.packdetNo
    );

    console.log("✅ Putaway process completed");
  }
}