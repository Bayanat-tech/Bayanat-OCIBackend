import { getRepository } from "../../database/connection";
import { ItemmasterPf } from "../../entity/PurchaseFlow/itemmaster.entity";

export class ItemMasterService {
  private static getRepository() {
    return getRepository(ItemmasterPf);
  }

  // Duplicate Check
  static async findDuplicate(
    item_code: string,
    item_desp: string,
    company_code: string
  ): Promise<ItemmasterPf | null> {
    const repo = this.getRepository();

    return await repo.findOne({
      where: { item_code, item_desp, company_code }
    });
  }

  // static async findOne(item_code: string, company_code: string): Promise<ItemmasterPf | null> {
  //   const repo = this.getRepository();

  //   return await repo.findOne({
  //     where: { item_code, company_code }
  //   });
  // }

   // Create
  static async createItem(data: any) {
    const repo = this.getRepository();

    const exists = await repo.findOne({
      where: {
        company_code: data.company_code,
        item_code: data.item_code,
      },
    });

    if (exists) {
      return {
        success: false,
        message: "Item Master Already Exists",
      };
    }

    const items = repo.create({
      ...data,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const saved = await repo.save(items);

    return {
      success: true,
      message: "Item created successfully",
      data: saved,
    };
  }

  // Update
  static async updateItem(
    item_code: string,
    company_code: string,
    updateData: any
  ) {
    const repo = this.getRepository();

    const existing = await repo.findOne({
      where: {
        company_code,
        item_code,
      },
    });

    if (!existing) {
      throw new Error("Item Master Already Exists")
    }

    await repo.update(
      { item_code, company_code },
      {
        ...updateData,
        updated_at: new Date(),
      }
    );

    return {
      success: true,
      message: "Item Master Updated Successfully",
    };
  }

  // Delete 
  static async deleteItems(
    itemCodes: string[]
  ): Promise<number> {
    const repo = this.getRepository();

    const result = await repo.delete(itemCodes);

    return result.affected ?? 0;
  }
}
