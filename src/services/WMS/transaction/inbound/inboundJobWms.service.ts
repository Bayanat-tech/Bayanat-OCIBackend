import { Repository, DataSource, FindOptionsWhere } from 'typeorm';
import { InboundJobWms } from '../../../../entities/wms/transaction/inbound/InboundJobWms.entity';
import { GrnReport } from '../../../../entities/wms/transaction/inbound/GrnReport.entity';
import { PackingDetailsInboundWms } from '../../../../entities/wms/transportation/inbound/PackingDetailsInboundWms.entity';
import { Product } from '../../../../entities/wms/Product.entity';
import { ISearch } from '../../../../interfaces/common.interface';
import { formatData, groupByContainerNo, getTiPackdetSeriesData } from '../../../../helpers/functions';

export class InboundJobWmsService {
  private inboundJobRepository: Repository<InboundJobWms>; 
  private grnReportRepository: Repository<GrnReport>;
  private packingDetailsRepository: Repository<PackingDetailsInboundWms>;

  constructor(private dataSource: DataSource) {
    this.inboundJobRepository = this.dataSource.getRepository(InboundJobWms);
    this.grnReportRepository = this.dataSource.getRepository(GrnReport);
    this.packingDetailsRepository = this.dataSource.getRepository(PackingDetailsInboundWms);
  }

  async getInboundJobByJobNo(job_no: string): Promise<InboundJobWms | null> {
    return await this.inboundJobRepository.findOne({
      where: { job_no }
    });
  }

  async getGrnReports(
    company_code: string,
    prin_code: string,
    job_no: string,
    page: number,
    limit: number,
    filter: ISearch
  ) {
    const skip = page * limit - limit;

    // Build where conditions
    const whereConditions: FindOptionsWhere<GrnReport> = {
      company_code,
      prin_code,
      job_no,
    };

    // Apply search filter if exists
    // Note: You'll need to adapt getSearchFilterQuery for TypeORM
    // For now, this is a simplified version

    // Get total count
    const totalCount = await this.grnReportRepository.count({
      where: whereConditions
    });

    // Build query with sorting
    const queryBuilder = this.grnReportRepository
      .createQueryBuilder('grn')
      .where(whereConditions);

    // Apply sorting
    if (filter?.sort && Object.keys(filter.sort).length > 0) {
      queryBuilder.orderBy(
        `grn.${filter.sort.field_name}`,
        filter.sort.desc ? 'DESC' : 'ASC'
      );
    }

    // Apply pagination
    queryBuilder
      .skip(skip)
      .take(limit || totalCount);

    const grnReportData = await queryBuilder.getMany();

    // Process and format data
    const groupedData = groupByContainerNo(grnReportData);
    const fetchedData = await Promise.all(
      groupedData.map((data) => formatData(data, getTiPackdetSeriesData))
    );

    return {
      totalCount,
      data: fetchedData
    };
  }

  async getTallyProductData(
    prin_code: string,
    job_no: string,
    container_no: string
  ) {
    return await this.packingDetailsRepository
      .createQueryBuilder('packing')
      .leftJoinAndSelect('packing.product', 'product')
      .where('packing.prin_code = :prin_code', { prin_code })
      .andWhere('packing.job_no = :job_no', { job_no })
      .andWhere('packing.container_no = :container_no', { container_no })
      .andWhere('product.prin_code = :prin_code', { prin_code })
      .select([
        'packing',
        'product.uom_count'
      ])
      .getMany();
  }
}
