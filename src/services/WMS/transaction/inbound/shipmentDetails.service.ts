import { Repository, DataSource, Like } from "typeorm";
import { TiContainer } from "../../../../entities/wms/transaction/inbound/TiContainer.entity";
import { IShipmentDetails } from "../../../../interfaces/wms/transaction/inbound/shipmentDetails_wms.interface";

export class ShipmentDetailsService {
  private repository: Repository<TiContainer>;

  constructor(dataSource: DataSource) {
    this.repository = dataSource.getRepository(TiContainer);
  }

  async findOne(
    prin_code: string,
    job_no: string,
    company_code: string
  ): Promise<TiContainer | null> {
    return await this.repository.findOne({
      where: {
        prin_code,
        job_no,
        company_code,
      },
    });
  }

  async create(data: Partial<TiContainer>): Promise<TiContainer> {
    const shipment = this.repository.create(data);
    return await this.repository.save(shipment);
  }

  async update(
    prin_code: string,
    job_no: string,
    container_no: string,
    company_code: string,
    data: Partial<TiContainer>
  ): Promise<boolean> {
    const result = await this.repository.update(
      {
        prin_code,
        job_no,
        container_no,
        company_code,
      },
      data
    );
    return result.affected! > 0;
  }

  async delete(
    prin_code: string,
    job_no: string,
    container_no: string,
    company_code: string
  ): Promise<boolean> {
    const result = await this.repository.delete({
      prin_code,
      job_no,
      container_no,
      company_code,
    });
    return result.affected! > 0;
  }

  async bulkCreate(data: Partial<TiContainer>[]): Promise<TiContainer[]> {
    const shipments = this.repository.create(data);
    return await this.repository.save(shipments, { chunk: 100 });
  }

  async findAll(
    company_code: string,
    searchFilter?: any
  ): Promise<TiContainer[]> {
    const where: any = { company_code };

    if (searchFilter && searchFilter.length > 0) {
      const orConditions = searchFilter.map((filter: any) => {
        const condition: any = { company_code };
        Object.keys(filter).forEach((key) => {
          if (filter[key]) {
            condition[key] = Like(`%${filter[key]}%`);
          }
        });
        return condition;
      });
      return await this.repository.find({ where: orConditions });
    }

    return await this.repository.find({ where });
  }
}
