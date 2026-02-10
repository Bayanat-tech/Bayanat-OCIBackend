import { getRepository } from "../../database/connection";
import { TsStndetail } from "../../entity/WMS/TsStndetail.entity";
import { In } from "typeorm";

export class TsStndetailService {
  private static getTsStndetailRepository() {
    return getRepository(TsStndetail);
  }

  // Get all STNDETAIL records
  static async findAll(): Promise<TsStndetail[]> {
    const repository = this.getTsStndetailRepository();
    return await repository.find();
  }

  // Find STNDETAIL by composite primary key
  static async findById(params: {
    company_code: string;
    prin_code: string;
    stn_no: number;
    serial_no: number;
  }): Promise<TsStndetail | null> {
    const repository = this.getTsStndetailRepository();
    return await repository.findOne({
      where: {
        company_code: params.company_code,
        prin_code: params.prin_code,
        stn_no: params.stn_no,
        serial_no: params.serial_no,
      },
    });
  }

  // Find all details for a specific STN
  static async findByStnNo(params: {
    stn_no: number;
    company_code: string;
  }): Promise<TsStndetail[]> {
    const repository = this.getTsStndetailRepository();
    console.log("🔍 findByStnNo called with:", params);
    const results = await repository.find({
      where: {
        stn_no: params.stn_no,
        company_code: params.company_code,
      },
      order: {
        serial_no: "ASC",
      },
    });
    console.log("📦 findByStnNo returned", results.length, "records");
    if (results.length > 0) {
      console.log("Sample record:", results[0]);
    }
    return results;
  }

  // Find details by STN and multiple prin_codes
  static async findByStnAndMultiplePrinCodes(params: {
    stn_no: number;
    company_code: string;
    prin_codes: string[];
  }): Promise<TsStndetail[]> {
    const repository = this.getTsStndetailRepository();
    console.log("🔍 findByStnAndMultiplePrinCodes called with:", params);
    const results = await repository.find({
      where: {
        stn_no: params.stn_no,
        company_code: params.company_code,
        prin_code: In(params.prin_codes),
      },
      order: {
        serial_no: "ASC",
      },
    });
    console.log("📦 findByStnAndMultiplePrinCodes returned", results.length, "records");
    if (results.length > 0) {
      console.log("Sample record:", results[0]);
    }
    return results;
  }

  // Find STNDETAIL records by company_code
  static async findByCompanyCode(company_code: string): Promise<TsStndetail[]> {
    const repository = this.getTsStndetailRepository();
    return await repository.find({
      where: { company_code },
    });
  }

  // Find STNDETAIL records by company_code and prin_code
  static async findByCompanyAndPrinCode(params: {
    company_code: string;
    prin_code: string;
  }): Promise<TsStndetail[]> {
    const repository = this.getTsStndetailRepository();
    return await repository.find({
      where: {
        company_code: params.company_code,
        prin_code: params.prin_code,
      },
    });
  }

  // Find by product code
  static async findByProductCode(params: {
    prod_code: string;
    company_code: string;
  }): Promise<TsStndetail[]> {
    const repository = this.getTsStndetailRepository();
    return await repository.find({
      where: {
        prod_code: params.prod_code,
        company_code: params.company_code,
      },
    });
  }

  // Find by job number
  static async findByJobNo(params: {
    job_no: string;
    company_code: string;
  }): Promise<TsStndetail[]> {
    const repository = this.getTsStndetailRepository();
    return await repository.find({
      where: {
        job_no: params.job_no,
        company_code: params.company_code,
      },
    });
  }

  // Create new STNDETAIL record
  static async createStndetail(stndetailData: Partial<TsStndetail>): Promise<TsStndetail> {
    const repository = this.getTsStndetailRepository();
    const stndetail = repository.create(stndetailData);
    return await repository.save(stndetail);
  }

  // Create multiple STNDETAIL records
  static async createMultipleStndetails(
    stndetailsData: Partial<TsStndetail>[]
  ): Promise<TsStndetail[]> {
    const repository = this.getTsStndetailRepository();
    const stndetails = repository.create(stndetailsData);
    return await repository.save(stndetails);
  }

  // Update existing STNDETAIL record
  static async updateStndetail(
    params: {
      company_code: string;
      prin_code: string;
      stn_no: number;
      serial_no: number;
    },
    updateData: Partial<TsStndetail>
  ): Promise<boolean> {
    const repository = this.getTsStndetailRepository();

    const result = await repository.update(
      {
        company_code: params.company_code,
        prin_code: params.prin_code,
        stn_no: params.stn_no,
        serial_no: params.serial_no,
      },
      updateData
    );

    return result.affected ? result.affected > 0 : false;
  }

  // Delete STNDETAIL record
  static async deleteStndetail(params: {
    company_code: string;
    prin_code: string;
    stn_no: number;
    serial_no: number;
  }): Promise<boolean> {
    const repository = this.getTsStndetailRepository();
    const result = await repository.delete({
      company_code: params.company_code,
      prin_code: params.prin_code,
      stn_no: params.stn_no,
      serial_no: params.serial_no,
    });
    return result.affected ? result.affected > 0 : false;
  }

  // Delete all details for a specific STN
  static async deleteAllByStnNo(params: {
    stn_no: number;
    company_code: string;
  }): Promise<boolean> {
    const repository = this.getTsStndetailRepository();
    const result = await repository.delete({
      stn_no: params.stn_no,
      company_code: params.company_code,
    });
    return result.affected ? result.affected > 0 : false;
  }

  // Check if STNDETAIL exists
  static async checkStndetailExists(params: {
    company_code: string;
    prin_code: string;
    stn_no: number;
    serial_no: number;
  }): Promise<boolean> {
    const repository = this.getTsStndetailRepository();
    const count = await repository.count({
      where: {
        company_code: params.company_code,
        prin_code: params.prin_code,
        stn_no: params.stn_no,
        serial_no: params.serial_no,
      },
    });
    return count > 0;
  }

  // Find allocated details
  static async findAllocated(params: {
    stn_no: number;
    company_code: string;
  }): Promise<TsStndetail[]> {
    const repository = this.getTsStndetailRepository();
    return await repository.find({
      where: {
        stn_no: params.stn_no,
        company_code: params.company_code,
        allocated: "Y",
      },
    });
  }

  // Find confirmed details
  static async findConfirmed(params: {
    stn_no: number;
    company_code: string;
  }): Promise<TsStndetail[]> {
    const repository = this.getTsStndetailRepository();
    return await repository.find({
      where: {
        stn_no: params.stn_no,
        company_code: params.company_code,
        confirmed: "Y",
      },
    });
  }

  // Update allocation status for detail
  static async updateAllocationStatus(
    params: {
      company_code: string;
      prin_code: string;
      stn_no: number;
      serial_no: number;
    },
    allocated: string
  ): Promise<boolean> {
    const repository = this.getTsStndetailRepository();
    const result = await repository.update(
      {
        company_code: params.company_code,
        prin_code: params.prin_code,
        stn_no: params.stn_no,
        serial_no: params.serial_no,
      },
      {
        allocated,
        allocated_date: new Date(),
      }
    );
    return result.affected ? result.affected > 0 : false;
  }

  // Update confirmation status for detail
  static async updateConfirmationStatus(
    params: {
      company_code: string;
      prin_code: string;
      stn_no: number;
      serial_no: number;
    },
    confirmed: string
  ): Promise<boolean> {
    const repository = this.getTsStndetailRepository();
    const result = await repository.update(
      {
        company_code: params.company_code,
        prin_code: params.prin_code,
        stn_no: params.stn_no,
        serial_no: params.serial_no,
      },
      {
        confirmed,
        confirmed_date: new Date(),
      }
    );
    return result.affected ? result.affected > 0 : false;
  }

  // Find by location range
  static async findByLocationRange(params: {
    company_code: string;
    from_loc_start?: string;
    from_loc_end?: string;
    to_loc_start?: string;
    to_loc_end?: string;
  }): Promise<TsStndetail[]> {
    const repository = this.getTsStndetailRepository();
    const where: any = {
      company_code: params.company_code,
    };

    if (params.from_loc_start) {
      where.from_loc_start = params.from_loc_start;
    }
    if (params.from_loc_end) {
      where.from_loc_end = params.from_loc_end;
    }
    if (params.to_loc_start) {
      where.to_loc_start = params.to_loc_start;
    }
    if (params.to_loc_end) {
      where.to_loc_end = params.to_loc_end;
    }

    return await repository.find({ where });
  }

  // Get next serial number for STN
  static async getNextSerialNo(params: {
    stn_no: number;
    company_code: string;
  }): Promise<number> {
    const repository = this.getTsStndetailRepository();
    const records = await repository.find({
      where: {
        stn_no: params.stn_no,
        company_code: params.company_code,
      },
    });

    if (records.length === 0) {
      return 1;
    }

    const maxSerialNo = Math.max(...records.map((r: any) => r.serial_no || 0));
    return maxSerialNo + 1;
  }
}
