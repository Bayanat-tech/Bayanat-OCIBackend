import { getRepository } from "../../database/connection";
import { ProductGroup } from "../../entity/WMS/group.entity";
import { In } from "typeorm";

export class GroupService {
  private static getProductGroupRepository() {
    return getRepository(ProductGroup);
  }

  static async findByGroupCodeAndCompany(
    groupCode: string,
    prinCode: string,
    companyCode: string
  ): Promise<ProductGroup | null> {
    const repository = this.getProductGroupRepository();
    return await repository.findOne({
      where: { groupCode, prinCode, companyCode },
    });
  }

  static async findByGroupNameAndCompany(
    groupName: string,
    companyCode: string
  ): Promise<ProductGroup | null> {
    const repository = this.getProductGroupRepository();
    return await repository.findOne({
      where: { groupName, companyCode },
    });
  }

  static async createGroup(groupData: {
    companyCode: string;
    prinCode: string;
    groupName: string;
    prefSite?: string;
    prefLocFrom?: string;
    prefLocTo?: string;
    prefAisleFrom?: string;
    prefAisleTo?: string;
    prefColFrom?: number;
    prefColTo?: number;
    prefHtFrom?: number;
    prefHtTo?: number;
    expiryConsDays?: number;
    createdBy?: string;
    updatedBy?: string;
  }): Promise<ProductGroup> {
    const repository = this.getProductGroupRepository();

    const group = repository.create({
      ...groupData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return await repository.save(group);
  }

  static async updateGroup(
    groupCode: string,
    prinCode: string,
    companyCode: string,
    updateData: any
  ): Promise<boolean> {
    const repository = this.getProductGroupRepository();

    const result = await repository.update(
      { groupCode, prinCode, companyCode },
      {
        ...updateData,
        updatedAt: new Date(),
      }
    );

    return result.affected ? result.affected > 0 : false;
  }

 static async deleteGroups(
  groupCodes: string[],
  prinCode: string,
  companyCode: string
): Promise<boolean> {
  console.log('Starting delete process for', groupCodes.length, 'groups');
  
  const repository = this.getProductGroupRepository();
  let successCount = 0;
  
  for (const groupCode of groupCodes) {
    try {
      console.log(`Deleting group ${groupCode}...`);
      
      const result = await repository.delete({
        groupCode,
        prinCode,
        companyCode,
      });
      
      if (result.affected && result.affected > 0) {
        successCount++;
        console.log(`Successfully deleted group ${groupCode}`);
      } else {
        console.log(`Group ${groupCode} not found or already deleted`);
      }
    } catch (error: any) {
      console.error(`Failed to delete group ${groupCode}:`, error.message);
      // Continue with other groups
    }
  }
  
  console.log(`Deleted ${successCount} out of ${groupCodes.length} groups`);
  return successCount > 0;
}

  static async checkGroupExists(
    groupCode: string,
    prinCode: string,
    companyCode: string
  ): Promise<boolean> {
    const repository = this.getProductGroupRepository();
    const count = await repository.count({
      where: { groupCode, prinCode, companyCode },
    });
    return count > 0;
  }

  static async getGroups(
    filters: any,
    page: number,
    limit: number
  ): Promise<{ data: ProductGroup[]; total: number }> {
    const repository = this.getProductGroupRepository();

    const [data, total] = await repository.findAndCount({
      where: filters,
      skip: (page - 1) * limit,
      take: limit,
      order: { groupCode: "ASC" },
    });

    return { data, total };
  }
}
 