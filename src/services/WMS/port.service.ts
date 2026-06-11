import { PortMaster } from "../../entity/WMS/port.entity";
import {  
  executeQuery, 
  executeSingleQuery,
  executeMutation,
  executeCount
} from "./tenant-service.helper";
import { TenantManager } from "../../database/TenantManager";

export class PortService {

  static async findByDescriptionAndCompany(
    port_name: string,
    company_code: string
  ): Promise<PortMaster | null> {
    const sql = `SELECT * FROM MS_PORT WHERE port_name = :port_name AND company_code = :company_code`;
    return await executeSingleQuery<PortMaster>(sql, { port_name, company_code });
  }

  static async findByPortCodeAndCompany(
    port_code: string,
    company_code: string
  ): Promise<PortMaster | null> {
    const sql = `SELECT * FROM MS_PORT WHERE port_code = :port_code AND company_code = :company_code`;
    return await executeSingleQuery<PortMaster>(sql, { port_code, company_code });
  }

  // static async createPort(portData: {
  //   port_name: string;
  //   company_code: string;
  //   created_by: string;
  //   updated_by: string;
  //   trp_mode?: string;
  //   country_code: string;
  //   port_code?: string;
  // }): Promise<PortMaster> {
  //   let portCode = portData.port_code;
    
  //   if (!portCode) {
  //     // Generate port_code
  //     const maxSql = `SELECT MAX(port_code) as max_code FROM MS_PORT WHERE company_code = :company_code`;
  //     const maxResult = await executeQuery<any>(maxSql, { company_code: portData.company_code });
      
  //     portCode = "P0001";
  //     if (maxResult && maxResult.length > 0 && maxResult[0].max_code) {
  //       const currentMax = parseInt(maxResult[0].max_code.replace("P", ""));
  //       portCode = `P${(currentMax + 1).toString().padStart(4, "0")}`;
  //     }
  //   }

  //   const cols = Object.keys(portData);
  //   cols.push('port_code', 'created_at', 'updated_at');
    
  //   const values = cols.map((_, i) => `:val${i}`).join(", ");
  //   const sql = `INSERT INTO MS_PORT (${cols.join(", ")}) VALUES (${values})`;
    
  //   const bindObj: Record<string, any> = {};
  //   let idx = 0;
  //   for (const col of Object.keys(portData)) {
  //     bindObj[`val${idx++}`] = (portData as any)[col];
  //   }
  //   bindObj[`val${idx++}`] = portCode;
  //   bindObj[`val${idx++}`] = new Date();
  //   bindObj[`val${idx++}`] = new Date();
    
  //   await executeMutation(sql, bindObj);
  //   return { ...portData, port_code: portCode, created_at: new Date(), updated_at: new Date() } as PortMaster;
  // }
static async createPort(portData: {
  port_name: string;
  company_code: string;
  created_by: string;
  updated_by: string;
  trp_mode?: string;
  country_code: string;
  port_code?: string;
}): Promise<PortMaster> {
  
  // Step 1: Resolve port_code
  let portCode = portData.port_code;

  if (!portCode) {
    const maxSql = `SELECT MAX(port_code) as max_code FROM MS_PORT WHERE company_code = :company_code`;
    const maxResult = await executeQuery<any>(maxSql, { company_code: portData.company_code });

    portCode = "P0001";
    if (maxResult && maxResult.length > 0 && maxResult[0].max_code) {
      const currentMax = parseInt(maxResult[0].max_code.replace("P", ""));
      portCode = `P${(currentMax + 1).toString().padStart(4, "0")}`;
    }
  }

  // Step 2: Build data object explicitly (no spread of portData to avoid port_code duplication)
  const insertData: Record<string, any> = {
    port_name:    portData.port_name,
    company_code: portData.company_code,
    country_code: portData.country_code,
    trp_mode:     portData.trp_mode ?? null,
    created_by:   portData.created_by,
    updated_by:   portData.updated_by,
    port_code:    portCode,
    created_at:   new Date(),
    updated_at:   new Date(),
  };

  // Step 3: Build columns and bind params dynamically
  const cols = Object.keys(insertData);
  const values = cols.map((_, i) => `:val${i}`).join(", ");
  const sql = `INSERT INTO MS_PORT (${cols.join(", ")}) VALUES (${values})`;

  const bindObj: Record<string, any> = {};
  cols.forEach((col, i) => {
    bindObj[`val${i}`] = insertData[col];
  });

  // Step 4: Execute
  await executeMutation(sql, bindObj);

  return {
    ...portData,
    port_code:  portCode,
    created_at: insertData.created_at,
    updated_at: insertData.updated_at,
  } as PortMaster;
}

  static async updatePort(
    port_code: string,
    company_code: string,
    updateData: any
  ): Promise<boolean> {
    console.log("updatePort - Updating port:", { port_code, company_code, updateData });

    const cols = Object.keys(updateData);
    const setClause = cols.map((col, i) => `${col} = :val${i}`).join(", ");
    
    const sql = `UPDATE MS_PORT SET ${setClause}, updated_at = :updated_at WHERE port_code = :port_code AND company_code = :company_code`;
    
    const bindObj: Record<string, any> = { port_code, company_code, updated_at: new Date() };
    cols.forEach((col, i) => {
      bindObj[`val${i}`] = updateData[col];
    });
    
    await executeMutation(sql, bindObj);
    console.log("updatePort - Update completed");
    return true;
  }

  static async deletePorts(port_codes: string[]): Promise<boolean> {
    const placeholders = port_codes.map((_, i) => `:code${i}`).join(", ");
    const sql = `DELETE FROM MS_PORT WHERE port_code IN (${placeholders})`;
    
    const bindObj: Record<string, any> = {};
    port_codes.forEach((code, i) => {
      bindObj[`code${i}`] = code;
    });
    
    await executeMutation(sql, bindObj);
    return true;
  }

  static async checkPortExists(
    port_code: string,
    company_code: string
  ): Promise<boolean> {
    const sql = `SELECT COUNT(*) as cnt FROM MS_PORT WHERE port_code = :port_code AND company_code = :company_code`;
    const count = await executeCount(sql, { port_code, company_code });
    return count > 0;
  }

  static async getPorts(
    filters: any,
    page: number,
    limit: number
  ): Promise<{ data: PortMaster[]; total: number }> {
    console.log("PortService.getPorts filters:", filters);

    if (!filters.company_code) {
      return { data: [], total: 0 };
    }

    const whereParts = [`company_code = :company_code`];
    const bindParams: Record<string, any> = { company_code: filters.company_code };

    if (filters.port_code && typeof filters.port_code === 'string' && filters.port_code.trim() !== '') {
      whereParts.push(`UPPER(port_code) LIKE UPPER(:port_code)`);
      bindParams.port_code = `%${filters.port_code.trim()}%`;
    }

    if (filters.port_name && typeof filters.port_name === 'string' && filters.port_name.trim() !== '') {
      whereParts.push(`UPPER(port_name) LIKE UPPER(:port_name)`);
      bindParams.port_name = `%${filters.port_name.trim()}%`;
    }

    if (filters.country_code && typeof filters.country_code === 'string' && filters.country_code.trim() !== '') {
      whereParts.push(`UPPER(country_code) LIKE UPPER(:country_code)`);
      bindParams.country_code = `%${filters.country_code.trim()}%`;
    }

    if (filters.trp_mode && typeof filters.trp_mode === 'string' && filters.trp_mode.trim() !== '') {
      whereParts.push(`UPPER(trp_mode) LIKE UPPER(:trp_mode)`);
      bindParams.trp_mode = `%${filters.trp_mode.trim()}%`;
    }

    if (filters.global_search && typeof filters.global_search === 'string' && filters.global_search.trim() !== '') {
      whereParts.push(`(
        UPPER(port_code) LIKE UPPER(:global_search)
        OR UPPER(port_name) LIKE UPPER(:global_search)
        OR UPPER(country_code) LIKE UPPER(:global_search)
        OR UPPER(trp_mode) LIKE UPPER(:global_search)
      )`);
      bindParams.global_search = `%${filters.global_search.trim()}%`;
    }

    const whereSql = whereParts.join(" AND ");
    let sql = `SELECT * FROM MS_PORT WHERE ${whereSql}`;

    const countParams = { ...bindParams };
    const countSql = `SELECT COUNT(*) as cnt FROM MS_PORT WHERE ${whereSql}`;
    const total = await executeCount(countSql, countParams);
    console.log("PortService total count:", total);

    // Apply ordering and pagination
    sql += ` ORDER BY port_code ASC OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`;
    bindParams.offset = (page - 1) * limit;
    bindParams.limit = limit;

    const data = await executeQuery<PortMaster>(sql, bindParams);
    console.log("PortService data count:", data.length);

    return { data, total };
  }

  static async updatePortSmart(
    port_code: string,
    company_code: string,
    updateData: any
  ): Promise<boolean> {
    console.log("updatePortSmart - Attempting update:", { port_code, company_code, updateData });

    let existingPort = await this.findByPortCodeAndCompany(port_code, company_code);

    if (!existingPort && updateData.port_name) {
      const sql = `SELECT * FROM MS_PORT WHERE port_name = :port_name AND company_code = :company_code`;
      existingPort = await executeSingleQuery<PortMaster>(sql, { port_name: updateData.port_name, company_code });
      console.log("updatePortSmart - Found by port_name:", existingPort);
    }

    if (!existingPort) {
      console.log("updatePortSmart - Port not found");
      return false;
    }

    return await this.updatePort(existingPort.port_code!, company_code, updateData);
  }
}
