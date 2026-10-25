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
  static async createBroker(brokerData: any): Promise<BrokerMaster> {
    const VALID_BROKER_COLUMNS = new Set([
      "company_code", "broker_code", "broker_name", "curr_code", "country_code",
      "broker_addr1", "broker_addr2", "broker_addr3", "broker_addr4", "broker_city",
      "broker_contact1", "broker_telno1", "broker_faxno1", "broker_email1",
      "broker_contact2", "broker_telno2", "broker_faxno2", "broker_email2",
      "broker_contact3", "broker_telno3", "broker_faxno3", "broker_email3",
      "broker_ref1", "broker_ref2", "broker_ref3", "service_date",
      "broker_acref", "broker_credit", "broker_stat", "broker_imp_code",
      "broker_lic_no", "broker_lic_type", "user_id", "date_time", "price_check",
      "payment_terms", "importer_code", "partner_type", "tax_country_code",
      "tax_registrd", "prin_infze", "trn_no", "territory_code"
    ]);

    const sanitized: Record<string, any> = {};
    for (const [k, v] of Object.entries(brokerData)) {
      const lower = k.toLowerCase();
      if (VALID_BROKER_COLUMNS.has(lower)) {
        sanitized[lower] = v === "" ? null : v;
      }
    }
    if (brokerData.created_by || brokerData.user_id) {
      sanitized.user_id = brokerData.created_by || brokerData.user_id;
    }
    sanitized.date_time = new Date();

    const cols = Object.keys(sanitized);
    const values = cols.map((_, i) => `:val${i}`).join(", ");
    const sql = `INSERT INTO MS_BROKER (${cols.join(", ")}) VALUES (${values})`;
    
    const bindObj: Record<string, any> = {};
    cols.forEach((col, i) => {
      bindObj[`val${i}`] = sanitized[col];
    });
    
    await executeMutation(sql, bindObj);
    return sanitized as BrokerMaster;
  }

  // Update existing broker
  static async updateBroker(
    broker_code: string,
    updateData: any
  ): Promise<boolean> {
    const VALID_BROKER_COLUMNS = new Set([
      "company_code", "broker_name", "curr_code", "country_code",
      "broker_addr1", "broker_addr2", "broker_addr3", "broker_addr4", "broker_city",
      "broker_contact1", "broker_telno1", "broker_faxno1", "broker_email1",
      "broker_contact2", "broker_telno2", "broker_faxno2", "broker_email2",
      "broker_contact3", "broker_telno3", "broker_faxno3", "broker_email3",
      "broker_ref1", "broker_ref2", "broker_ref3", "service_date",
      "broker_acref", "broker_credit", "broker_stat", "broker_imp_code",
      "broker_lic_no", "broker_lic_type", "user_id", "date_time", "price_check",
      "payment_terms", "importer_code", "partner_type", "tax_country_code",
      "tax_registrd", "prin_infze", "trn_no", "territory_code"
    ]);

    const sanitized: Record<string, any> = {};
    for (const [k, v] of Object.entries(updateData)) {
      const lower = k.toLowerCase();
      if (lower !== "broker_code" && VALID_BROKER_COLUMNS.has(lower)) {
        sanitized[lower] = v === "" ? null : v;
      }
    }
    if (updateData.updated_by || updateData.user_id) {
      sanitized.user_id = updateData.updated_by || updateData.user_id;
    }
    sanitized.date_time = new Date();

    const cols = Object.keys(sanitized);
    if (cols.length === 0) return true;

    const setClause = cols.map((col, i) => `${col} = :val${i}`).join(", ");
    const sql = `UPDATE MS_BROKER SET ${setClause} WHERE broker_code = :broker_code`;
    
    const bindObj: Record<string, any> = { broker_code };
    cols.forEach((col, i) => {
      bindObj[`val${i}`] = sanitized[col];
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
