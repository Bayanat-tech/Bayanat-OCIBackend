import { getRepository } from "../../../../database/connection";
import { InboundJobWms } from "../../../../entity/WMS/transaction/inbound/InboundJobWms.entity";
import { IJobInboundWms } from "../../../../interfaces/wms/transaction/inbound/inboundJobWms.interface";
import { FindManyOptions } from "typeorm";

export class InboundJobWmsService {
  private static getInboundJobRepository() {
    return getRepository(InboundJobWms);
  }

  // Find a single inbound job by composite key
  static async findOne(params: {
    company_code: string;
    prin_code: string;
    job_no: string;
  }): Promise<InboundJobWms | null> {
    const repository = this.getInboundJobRepository();
    return await repository.findOne({
      where: {
        company_code: params.company_code,
        prin_code: params.prin_code,
        job_no: params.job_no,
      },
    });
  }

  // Find all inbound jobs with optional filters
  static async findAll(
    options?: FindManyOptions<InboundJobWms>
  ): Promise<InboundJobWms[]> {
    const repository = this.getInboundJobRepository();
    return await repository.find(options);
  }

  // Find inbound jobs by company code
  static async findByCompanyCode(
    company_code: string
  ): Promise<InboundJobWms[]> {
    const repository = this.getInboundJobRepository();
    return await repository.find({
      where: { company_code },
    });
  }

  // Find inbound jobs with search filters
  static async findWithFilters(
    whereConditions: any
  ): Promise<InboundJobWms[]> {
    const repository = this.getInboundJobRepository();
    return await repository.find({
      where: whereConditions,
    });
  }

  // Create a new inbound job
  static async create(
    inboundJobData: Partial<IJobInboundWms>
  ): Promise<InboundJobWms> {
    const repository = this.getInboundJobRepository();

    const inboundJob = repository.create({
      ...inboundJobData,
    });

    return await repository.save(inboundJob);
  }

  // Update an inbound job
  static async update(
    params: {
      company_code: string;
      prin_code: string;
      job_no: string;
    },
    updateData: Partial<IJobInboundWms>
  ): Promise<InboundJobWms | null> {
    const repository = this.getInboundJobRepository();

    await repository.update(
      {
        company_code: params.company_code,
        prin_code: params.prin_code,
        job_no: params.job_no,
      },
      {
        ...updateData,
      }
    );

    // Return the updated record
    return await this.findOne(params);
  }

  // Delete an inbound job
  static async delete(params: {
    company_code: string;
    prin_code: string;
    job_no: string;
  }): Promise<boolean> {
    const repository = this.getInboundJobRepository();

    const result = await repository.delete({
      company_code: params.company_code,
      prin_code: params.prin_code,
      job_no: params.job_no,
    });

    return (result.affected ?? 0) > 0;
  }

  // Count inbound jobs with optional filters
  static async count(whereConditions?: any): Promise<number> {
    const repository = this.getInboundJobRepository();
    return await repository.count({
      where: whereConditions,
    });
  }
}
