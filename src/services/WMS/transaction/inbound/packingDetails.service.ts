import { getRepository } from "../../../../database/connection";
import { PackingDetailsInboundWms } from "../../../../entity/WMS/transaction/inbound/PackingDetailsInboundWms.entity";
import { IPackingDetails } from "../../../../interfaces/wms/transaction/inbound/packingDetails_wms.interface";
import { FindManyOptions, FindOneOptions } from "typeorm";

export class PackingDetailsService {
  private static getPackingDetailsRepository() {
    return getRepository(PackingDetailsInboundWms);
  }

  // Find a single packing detail by composite key
  static async findOne(params: {
    company_code: string;
    prin_code: string;
    job_no: string;
    packdet_no: number;
  }): Promise<PackingDetailsInboundWms | null> {
    const repository = this.getPackingDetailsRepository();
    return await repository.findOne({
      where: {
        company_code: params.company_code,
        prin_code: params.prin_code,
        job_no: params.job_no,
        packdet_no: params.packdet_no,
      },
    });
  }

  // Find all packing details with optional filters
  static async findAll(
    options?: FindManyOptions<PackingDetailsInboundWms>
  ): Promise<PackingDetailsInboundWms[]> {
    const repository = this.getPackingDetailsRepository();
    return await repository.find(options);
  }

  // Find packing details by company code
  static async findByCompanyCode(
    company_code: string
  ): Promise<PackingDetailsInboundWms[]> {
    const repository = this.getPackingDetailsRepository();
    return await repository.find({
      where: { company_code },
    });
  }

  // Find packing details with search filters
  static async findWithFilters(
    whereConditions: any
  ): Promise<PackingDetailsInboundWms[]> {
    const repository = this.getPackingDetailsRepository();
    return await repository.find({
      where: whereConditions,
    });
  }

  // Create a new packing detail
  static async create(
    packingDetailsData: Partial<IPackingDetails>
  ): Promise<PackingDetailsInboundWms> {
    const repository = this.getPackingDetailsRepository();

    const packingDetail = repository.create({
      ...packingDetailsData,
      created_at: new Date(),
      updated_at: new Date(),
    });

    return await repository.save(packingDetail);
  }

  // Bulk create packing details
  static async bulkCreate(
    packingDetailsArray: Partial<IPackingDetails>[],
    options?: { ignoreDuplicates?: boolean }
  ): Promise<PackingDetailsInboundWms[]> {
    const repository = this.getPackingDetailsRepository();

    const packingDetails = packingDetailsArray.map((data) =>
      repository.create({
        ...data,
        created_at: new Date(),
        updated_at: new Date(),
      })
    );

    if (options?.ignoreDuplicates) {
      // Save each individually to handle duplicates gracefully
      const results: PackingDetailsInboundWms[] = [];
      for (const detail of packingDetails) {
        try {
          const saved = await repository.save(detail);
          results.push(saved);
        } catch (error) {
          // Ignore duplicate errors silently
          console.log("Skipping duplicate entry");
        }
      }
      return results;
    }

    return await repository.save(packingDetails);
  }

  // Update a packing detail
  static async update(
    params: {
      company_code: string;
      prin_code: string;
      job_no: string;
      packdet_no: number;
    },
    updateData: Partial<IPackingDetails>
  ): Promise<boolean> {
    const repository = this.getPackingDetailsRepository();

    const result = await repository.update(
      {
        company_code: params.company_code,
        prin_code: params.prin_code,
        job_no: params.job_no,
        packdet_no: params.packdet_no,
      },
      {
        ...updateData,
        updated_at: new Date(),
      }
    );

    return result.affected ? result.affected > 0 : false;
  }

  // Delete a packing detail
  static async delete(params: {
    company_code: string;
    prin_code: string;
    job_no: string;
    packdet_no: number;
  }): Promise<boolean> {
    const repository = this.getPackingDetailsRepository();

    const result = await repository.delete({
      company_code: params.company_code,
      prin_code: params.prin_code,
      job_no: params.job_no,
      packdet_no: params.packdet_no,
    });

    return result.affected ? result.affected > 0 : false;
  }

  // Delete multiple packing details
  static async deleteMany(
    packingDetails: Array<{
      company_code: string;
      prin_code: string;
      job_no: string;
      packdet_no: number;
    }>
  ): Promise<number> {
    const repository = this.getPackingDetailsRepository();
    let deletedCount = 0;

    for (const detail of packingDetails) {
      const result = await repository.delete({
        company_code: detail.company_code,
        prin_code: detail.prin_code,
        job_no: detail.job_no,
        packdet_no: detail.packdet_no,
      });

      if (result.affected) {
        deletedCount += result.affected;
      }
    }

    return deletedCount;
  }

  // Check if packing detail exists
  static async exists(params: {
    company_code: string;
    prin_code: string;
    job_no: string;
    packdet_no: number;
  }): Promise<boolean> {
    const repository = this.getPackingDetailsRepository();
    const count = await repository.count({
      where: {
        company_code: params.company_code,
        prin_code: params.prin_code,
        job_no: params.job_no,
        packdet_no: params.packdet_no,
      },
    });
    return count > 0;
  }

  // Count packing details with optional filters
  static async count(where?: any): Promise<number> {
    const repository = this.getPackingDetailsRepository();
    return await repository.count(where ? { where } : {});
  }
}
