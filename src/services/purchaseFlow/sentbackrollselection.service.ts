
import { getRepository } from "../../database/connection";
import { MSPSFlowRoleMapping } from "../../entity/PurchaseFlow/MSPSFlowRoleMapping .entity";
import { MSPSRole } from "../../entity/PurchaseFlow/MSPSRole.entity";


export class FlowRoleService {
  static async getSentBackRoles(flowCode: string) {
    const sentbackrolls = await getRepository(MSPSFlowRoleMapping)
      .createQueryBuilder("A")
      .innerJoin(MSPSRole, "B", "A.FLOW_ROLE = B.ROLE_CODE")
      .select(["B.ROLE_NAME as role_name", "A.FLOW_LEVEL as flow_level"])
      .where("A.FLOW_CODE = :flowCode", { flowCode })
      .orderBy("A.FLOW_LEVEL", "DESC")
      .getRawMany(); // Returns raw array like your previous Sequelize query

    return sentbackrolls;
  }
}
