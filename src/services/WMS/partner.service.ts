import { BrokerMaster } from "../../entity/WMS/partner.entity";
import { 
  getCurrentTenantId, 
  normalizeOracleResult, 
  executeQuery, 
  executeSingleQuery,
  executeMutation,
  executeCount
} from "./tenant-service.helper";

export class PartnerService {
  // Get partners with pagination
  static async getPartners(
    filters: any,
    page: number = 1,
    limit: number = 100
  ): Promise<{ data: BrokerMaster[]; total: number }> {
    const bindParams: Record<string, any> = {};
    let sql = `SELECT * FROM MS_BROKER WHERE 1=1`;

    if (filters.company_code) {
      sql += ` AND company_code = :company_code`;
      bindParams.company_code = filters.company_code;
    }

    if (filters.broker_name) {
      sql += ` AND broker_name LIKE :broker_name`;
      bindParams.broker_name = `%${filters.broker_name}%`;
    }

    if (filters.broker_code) {
      sql += ` AND broker_code LIKE :broker_code`;
      bindParams.broker_code = `%${filters.broker_code}%`;
    }

    // Get total count
    const countSql = sql.replace(/SELECT \*/, `SELECT COUNT(*) as cnt`);
    const total = await executeCount(countSql, bindParams);

    // Apply pagination
    const offset = (page - 1) * limit;
    sql += ` ORDER BY broker_code ASC OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`;
    bindParams.offset = offset;
    bindParams.limit = limit;

    const data = await executeQuery<BrokerMaster>(sql, bindParams);
    return { data, total };
  }

  // Check for duplicate broker by code or name
  static async findDuplicate(params: {
    broker_code: string;
    broker_name?: string;
  }): Promise<BrokerMaster | null> {
    let sql = `SELECT * FROM MS_BROKER WHERE broker_code = :broker_code`;
    const bindParams: Record<string, any> = { broker_code: params.broker_code };

    if (params.broker_name) {
      sql += ` AND broker_name = :broker_name`;
      bindParams.broker_name = params.broker_name;
    }

    return await executeSingleQuery<BrokerMaster>(sql, bindParams);
  }

  // Get all brokers
  static async findAll(): Promise<BrokerMaster[]> {
    const sql = `SELECT * FROM MS_BROKER`;
    return await executeQuery<BrokerMaster>(sql);
  }

  // Find broker by code
  static async findByCode(broker_code: string): Promise<BrokerMaster | null> {
    const sql = `SELECT * FROM MS_BROKER WHERE broker_code = :broker_code`;
    return await executeSingleQuery<BrokerMaster>(sql, { broker_code });
  }

  // Find brokers by company
  static async findByCompany(company_code: string): Promise<BrokerMaster[]> {
    const sql = `SELECT * FROM MS_BROKER WHERE company_code = :company_code`;
    return await executeQuery<BrokerMaster>(sql, { company_code });
  }

  // Create new broker
  static async createBroker(brokerData: Partial<BrokerMaster>): Promise<BrokerMaster> {
    const cols = Object.keys(brokerData);
    const values = cols.map((_, i) => `:val${i}`).join(", ");
    const sql = `INSERT INTO MS_BROKER (${cols.join(", ")}) VALUES (${values})`;
    
    const bindObj: Record<string, any> = {};
    cols.forEach((col, i) => {
      bindObj[`val${i}`] = (brokerData as any)[col];
    });
    
    await executeMutation(sql, bindObj);
    return brokerData as BrokerMaster;
  }

  // Update existing broker
  static async updateBroker(
    broker_code: string,
    updateData: Partial<BrokerMaster>
  ): Promise<boolean> {
    const cols = Object.keys(updateData);
    const setClause = cols.map((col, i) => `${col} = :val${i}`).join(", ");
    const sql = `UPDATE MS_BROKER SET ${setClause} WHERE broker_code = :broker_code`;
    
    const bindObj: Record<string, any> = { broker_code };
    cols.forEach((col, i) => {
      bindObj[`val${i}`] = (updateData as any)[col];
    });
    
    await executeMutation(sql, bindObj);
    return true;
  }

  // Delete broker
  static async deleteBroker(broker_code: string): Promise<boolean> {
    const sql = `DELETE FROM MS_BROKER WHERE broker_code = :broker_code`;
    await executeMutation(sql, { broker_code });
    return true;
  }

  // Delete multiple partners
  static async deletePartners(partnerCodes: string[]): Promise<boolean> {
    const placeholders = partnerCodes.map((_, i) => `:code${i}`).join(", ");
    const sql = `DELETE FROM MS_BROKER WHERE broker_code IN (${placeholders})`;
    
    const bindObj: Record<string, any> = {};
    partnerCodes.forEach((code, i) => {
      bindObj[`code${i}`] = code;
    });
    
    await executeMutation(sql, bindObj);
    return true;
  }

  // Check if broker exists
  static async checkBrokerExists(broker_code: string): Promise<boolean> {
    const sql = `SELECT COUNT(*) as cnt FROM MS_BROKER WHERE broker_code = :broker_code`;
    const count = await executeCount(sql, { broker_code });
    return count > 0;
  }
}
