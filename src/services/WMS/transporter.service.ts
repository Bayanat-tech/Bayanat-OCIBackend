import {
  executeQuery,
  executeSingleQuery,
  executeMutation,
  executeCount
} from "./tenant-service.helper";

export class TransporterService {
  static async getTransporters(
    filters: any,
    page: number = 1,
    limit: number = 100
  ): Promise<{ data: any[]; total: number }> {
    const bindParams: Record<string, any> = {};
    let sql = `SELECT * FROM MS_TRANSPORTER WHERE 1=1`;

    if (filters.company_code) {
      sql += ` AND company_code = :company_code`;
      bindParams.company_code = filters.company_code;
    }

    if (filters.transporter_name) {
      sql += ` AND UPPER(transporter_name) LIKE :transporter_name`;
      bindParams.transporter_name = `%${String(filters.transporter_name).toUpperCase()}%`;
    }

    if (filters.transporter_code) {
      sql += ` AND transporter_code = :transporter_code`;
      bindParams.transporter_code = filters.transporter_code;
    }

    const countSql = sql.replace(/SELECT \*/, `SELECT COUNT(*) as cnt`);
    const total = await executeCount(countSql, bindParams);

    const offset = (page - 1) * limit;
    sql += ` ORDER BY transporter_code ASC OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`;
    bindParams.offset = offset;
    bindParams.limit = limit;

    const data = await executeQuery<any>(sql, bindParams);
    return { data, total };
  }

  static async findDuplicate(params: {
    transporter_code?: string;
    transporter_name?: string;
    company_code: string;
  }): Promise<any | null> {
    if (params.transporter_code) {
      const sql = `SELECT * FROM MS_TRANSPORTER WHERE transporter_code = :transporter_code AND company_code = :company_code`;
      const found = await executeSingleQuery<any>(sql, {
        transporter_code: params.transporter_code,
        company_code: params.company_code
      });
      if (found) return found;
    }

    if (params.transporter_name) {
      const sql = `SELECT * FROM MS_TRANSPORTER WHERE UPPER(transporter_name) = UPPER(:transporter_name) AND company_code = :company_code`;
      return await executeSingleQuery<any>(sql, {
        transporter_name: params.transporter_name,
        company_code: params.company_code
      });
    }

    return null;
  }

  static async findByCode(transporter_code: string, company_code: string): Promise<any | null> {
    const sql = `SELECT * FROM MS_TRANSPORTER WHERE transporter_code = :transporter_code AND company_code = :company_code`;
    return await executeSingleQuery<any>(sql, { transporter_code, company_code });
  }

  static async createTransporter(data: any): Promise<any> {
    const VALID_COLS = new Set([
      "company_code", "transporter_code", "transporter_name", "country_code",
      "trns_addr1", "trns_addr2", "trns_addr3", "trns_addr4", "trns_city",
      "trns_contact1", "trns_telno1", "trns_faxno1", "trns_email1",
      "user_id", "user_dt", "ac_code", "tax_country_code", "tax_registrd",
      "prin_infze", "trn_no", "territory_code"
    ]);

    const sanitized: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      const lower = k.toLowerCase();
      if (VALID_COLS.has(lower)) {
        sanitized[lower] = v === "" ? null : v;
      }
    }

    // Default flags
    if (!sanitized.tax_registrd) sanitized.tax_registrd = "N";
    if (!sanitized.prin_infze) sanitized.prin_infze = "N";
    sanitized.user_id = data.created_by || data.user_id || "USER_PM";
    sanitized.user_dt = new Date();

    const cols = Object.keys(sanitized);
    const values = cols.map((_, i) => `:val${i}`).join(", ");
    const sql = `INSERT INTO MS_TRANSPORTER (${cols.join(", ")}) VALUES (${values})`;

    const bindObj: Record<string, any> = {};
    cols.forEach((col, i) => {
      bindObj[`val${i}`] = sanitized[col];
    });

    await executeMutation(sql, bindObj);

    // Fetch created row
    if (sanitized.transporter_code) {
      return await this.findByCode(sanitized.transporter_code, sanitized.company_code);
    }
    const findSql = `SELECT * FROM MS_TRANSPORTER WHERE UPPER(transporter_name) = UPPER(:tname) AND company_code = :cc ORDER BY user_dt DESC`;
    return await executeSingleQuery<any>(findSql, { tname: sanitized.transporter_name, cc: sanitized.company_code });
  }

  static async updateTransporter(code: string, data: any): Promise<any> {
    const VALID_COLS = new Set([
      "transporter_name", "country_code",
      "trns_addr1", "trns_addr2", "trns_addr3", "trns_addr4", "trns_city",
      "trns_contact1", "trns_telno1", "trns_faxno1", "trns_email1",
      "ac_code", "tax_country_code", "tax_registrd",
      "prin_infze", "trn_no", "territory_code"
    ]);

    const setClauses: string[] = [];
    const bindParams: Record<string, any> = {
      transporter_code: code,
      company_code: data.company_code
    };

    let i = 0;
    for (const [k, v] of Object.entries(data)) {
      const lower = k.toLowerCase();
      if (VALID_COLS.has(lower)) {
        setClauses.push(`${lower} = :val${i}`);
        bindParams[`val${i}`] = v === "" ? null : v;
        i++;
      }
    }

    if (setClauses.length === 0) return true;

    setClauses.push("user_id = :updater", "user_dt = :updatedt");
    bindParams.updater = data.updated_by || "USER_PM";
    bindParams.updatedt = new Date();

    const sql = `UPDATE MS_TRANSPORTER SET ${setClauses.join(", ")} WHERE transporter_code = :transporter_code AND company_code = :company_code`;
    await executeMutation(sql, bindParams);
    return await this.findByCode(code, data.company_code);
  }

  static async deleteTransporters(codes: string[], company_code: string): Promise<boolean> {
    if (!codes || codes.length === 0) return false;
    const bindParams: Record<string, any> = { company_code };
    const placeholders = codes.map((c, i) => {
      bindParams[`code${i}`] = c;
      return `:code${i}`;
    }).join(", ");

    const sql = `DELETE FROM MS_TRANSPORTER WHERE transporter_code IN (${placeholders}) AND company_code = :company_code`;
    await executeMutation(sql, bindParams);
    return true;
  }
}

