import { PrincipalMaster } from "../../entity/WMS/principal.entity"
import {
  getCurrentTenantId,
  executeQuery,
  executeSingleQuery,
  executeMutation,
  executeCount
} from "./tenant-service.helper";

export class PrincipalService {
  static async findDuplicate(params: {
    prin_code: string;
    prin_name?: string;
  }): Promise<PrincipalMaster | null> {
    try {
      let sql = "SELECT * FROM MS_PRINCIPAL WHERE 1=1";
      const bindParams: Record<string, any> = {};
      
      if (params.prin_code && params.prin_code.trim() !== "") {
        sql += " AND PRIN_CODE = :prin_code";
        bindParams.prin_code = params.prin_code;
      }
      
      if (params.prin_name && params.prin_name.trim() !== "") {
        sql += " AND PRIN_NAME = :prin_name";
        bindParams.prin_name = params.prin_name;
      }
      
      if (Object.keys(bindParams).length === 0) {
        return null;
      }
      
      sql += " AND ROWNUM = 1";
      
      return await executeSingleQuery<PrincipalMaster>(sql, bindParams);
    } catch (error) {
      console.error("[PrincipalService.findDuplicate] Error:", error);
      throw error;
    }
  }

  // Get all principals
  static async findAll(): Promise<PrincipalMaster[]> {
    try {
      console.log(`[PrincipalService.findAll] Getting principals`);
      
      const sql = `SELECT * FROM MS_PRINCIPAL`;
      const result = await executeQuery<PrincipalMaster>(sql, {});
      console.log(`[PrincipalService.findAll] result count: ${result.length}`);
      
      return result;
    } catch (error) {
      console.error("[PrincipalService.findAll] Error:", error);
      throw error;
    }
  }

  // Find principal by code
  static async findByCode(prin_code: string): Promise<PrincipalMaster | null> {
    try {
      const sql = `SELECT * FROM MS_PRINCIPAL WHERE PRIN_CODE = :prin_code`;
      return await executeSingleQuery<PrincipalMaster>(sql, { prin_code });
    } catch (error) {
      console.error("[PrincipalService.findByCode] Error:", error);
      throw error;
    }
  }

  // Find principals by company
  static async findByCompany(company_code: string): Promise<PrincipalMaster[]> {
    try {
      const sql = `SELECT * FROM MS_PRINCIPAL WHERE COMPANY_CODE = :company_code`;
      return await executeQuery<PrincipalMaster>(sql, { company_code });
    } catch (error) {
      console.error("[PrincipalService.findByCompany] Error:", error);
      throw error;
    }
  }

  // Create new principal

static async createPrincipal(principalData: Partial<PrincipalMaster>): Promise<PrincipalMaster> {
  const DATE_COLUMNS = new Set([
  'trn_exp_date',
  'comm_reg_exp_date',
  'prin_invdate',
  'validate_expdate',
  'service_date',
  'created_at',
  'updated_at',
]);

  try {
    const cols = Object.keys(principalData);
    const colNames = cols.map(c => c.toUpperCase()).join(', ');

    const bindParams = cols.map((col, i) => {
      if (DATE_COLUMNS.has(col) && principalData[col as keyof PrincipalMaster] != null) {
        return `TO_DATE(:val${i}, 'YYYY-MM-DD')`;
      }
      return `:val${i}`;
    }).join(', ');

    const sql = `INSERT INTO MS_PRINCIPAL (${colNames}) VALUES (${bindParams})`;

    const bindObj: Record<string, any> = {};
    cols.forEach((col, i) => {
      bindObj[`val${i}`] = (principalData as any)[col];
    });

    await executeMutation(sql, bindObj);

    const selectSql = `SELECT * FROM MS_PRINCIPAL WHERE PRIN_NAME = :prin_name AND COMPANY_CODE = :company_code`;
    const createdPrincipal = await executeSingleQuery<PrincipalMaster>(selectSql, {
      prin_name: principalData.prin_name,
      company_code: principalData.company_code,
    });

    return createdPrincipal as PrincipalMaster;
  } catch (error) {
    console.error('[PrincipalService.createPrincipal] Error:', error);
    throw error;
  }
}

  // Update existing principal
static async updatePrincipal(prin_code: string, updateData: Partial<PrincipalMaster>): Promise<boolean> {
  const DATE_COLUMNS = new Set([
    'trn_exp_date',
    'comm_reg_exp_date',
    'prin_invdate',
    'validate_expdate',
    'service_date',
    'created_at',
    'updated_at',
  ]);

  try {
    const cols = Object.keys(updateData);

    const setClause = cols.map((col, i) => {
      if (DATE_COLUMNS.has(col) && updateData[col as keyof PrincipalMaster] != null) {
        return `${col.toUpperCase()} = TO_DATE(:val${i}, 'YYYY-MM-DD')`;
      }
      return `${col.toUpperCase()} = :val${i}`;
    }).join(', ');

    const sql = `UPDATE MS_PRINCIPAL SET ${setClause} WHERE PRIN_CODE = :prin_code`;

    const bindObj: Record<string, any> = { prin_code };
    cols.forEach((col, i) => {
      bindObj[`val${i}`] = (updateData as any)[col];
    });

    await executeMutation(sql, bindObj);
    return true;
  } catch (error) {
    console.error('[PrincipalService.updatePrincipal] Error:', error);
    throw error;
  }
}

  // Delete principal
  static async deletePrincipal(prin_code: string): Promise<boolean> {
    try {
      const sql = `DELETE FROM MS_PRINCIPAL WHERE PRIN_CODE = :prin_code`;
      await executeMutation(sql, { prin_code });
      return true;
    } catch (error) {
      console.error("[PrincipalService.deletePrincipal] Error:", error);
      throw error;
    }
  }

  // Check if principal exists
  static async checkPrincipalExists(prin_code: string): Promise<boolean> {
    try {
      const sql = `SELECT COUNT(*) as cnt FROM MS_PRINCIPAL WHERE PRIN_CODE = :prin_code`;
      const count = await executeCount(sql, { prin_code });
      return count > 0;
    } catch (error) {
      console.error("[PrincipalService.checkPrincipalExists] Error:", error);
      throw error;
    }
  }
}
