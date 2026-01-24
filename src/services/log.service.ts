import TenantManager from "../database/TenantManager";
import { Log } from "../entity/Log";

export class LogService {
  // Count logs for a specific user in their tenant database
  static async countUserLogs(
    company_code: string,
    loginid: string
  ): Promise<number> {
    console.log(`[LogService.countUserLogs] STEP 1: Counting logs for ${loginid} in company ${company_code}...`);
    try {
      const result = await TenantManager.executeForUser(
        loginid,
        `SELECT COUNT(*) AS cnt FROM M_NOTIFICATION_LOGS 
         WHERE COMPANY_CODE = :company_code AND LOGINID = :loginid`,
        { company_code, loginid }
      );
      
      const count = result[0]?.CNT || 0;
      console.log(`[LogService.countUserLogs] ✅ Count: ${count}`);
      return count;
    } catch (error) {
      console.error(`[LogService.countUserLogs] ❌ Error:`, error instanceof Error ? error.message : String(error));
      return 0;
    }
  }

  // Count unread logs for a specific user in their tenant database
  static async countUnreadLogs(
    company_code: string,
    loginid: string
  ): Promise<number> {
    console.log(`[LogService.countUnreadLogs] STEP 1: Counting unread logs for ${loginid}...`);
    try {
      const result = await TenantManager.executeForUser(
        loginid,
        `SELECT COUNT(*) AS cnt FROM M_NOTIFICATION_LOGS 
         WHERE COMPANY_CODE = :company_code AND LOGINID = :loginid AND READ_FLAG = 'N'`,
        { company_code, loginid }
      );
      
      const count = result[0]?.CNT || 0;
      console.log(`[LogService.countUnreadLogs] ✅ Unread count: ${count}`);
      return count;
    } catch (error) {
      console.error(`[LogService.countUnreadLogs] ❌ Error:`, error instanceof Error ? error.message : String(error));
      return 0;
    }
  }

  // Get all logs for a specific user from their tenant database
  static async getUserLogs(
    company_code: string,
    loginid: string
  ): Promise<any[]> {
    console.log(`[LogService.getUserLogs] STEP 1: Fetching logs for ${loginid}...`);
    try {
      const result = await TenantManager.executeForUser(
        loginid,
        `SELECT * FROM M_NOTIFICATION_LOGS 
         WHERE COMPANY_CODE = :company_code AND LOGINID = :loginid 
         ORDER BY UPDATED_AT DESC`,
        { company_code, loginid }
      );
      
      console.log(`[LogService.getUserLogs] ✅ Fetched ${result.length} logs`);
      return result;
    } catch (error) {
      console.error(`[LogService.getUserLogs] ❌ Error:`, error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  // Mark logs as read in the tenant database
  static async markLogsAsRead(
    company_code: string,
    loginid: string,
    updated_by: string
  ): Promise<boolean> {
    console.log(`[LogService.markLogsAsRead] STEP 1: Marking logs as read for ${loginid}...`);
    try {
      const result = await TenantManager.executeForUser(
        loginid,
        `UPDATE M_NOTIFICATION_LOGS 
         SET READ_FLAG = 'Y', UPDATED_BY = :updated_by, UPDATED_AT = SYSDATE
         WHERE COMPANY_CODE = :company_code AND LOGINID = :loginid AND READ_FLAG = 'N'`,
        { company_code, loginid, updated_by }
      );
      
      console.log(`[LogService.markLogsAsRead] ✅ Marked as read`);
      return true;
    } catch (error) {
      console.error(`[LogService.markLogsAsRead] ❌ Error:`, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  // Create a new log entry in the tenant database
  static async createLog(logData: {
    company_code: string;
    loginid: string;
    module: string;
    description: string;
    read: string;
    created_by: string;
    updated_by: string;
  }): Promise<any> {
    console.log(`[LogService.createLog] STEP 1: Creating log entry for ${logData.loginid}...`);
    try {
      const result = await TenantManager.executeForUser(
        logData.loginid,
        `INSERT INTO M_NOTIFICATION_LOGS 
         (COMPANY_CODE, LOGINID, MODULE, DESCRIPTION, READ_FLAG, CREATED_BY, UPDATED_BY, CREATED_AT, UPDATED_AT)
         VALUES (:company_code, :loginid, :module, :description, :read, :created_by, :updated_by, SYSDATE, SYSDATE)`,
        { 
          company_code: logData.company_code,
          loginid: logData.loginid,
          module: logData.module,
          description: logData.description,
          read: logData.read,
          created_by: logData.created_by,
          updated_by: logData.updated_by
        }
      );
      
      console.log(`[LogService.createLog] ✅ Log entry created`);
      return { ...logData, created_at: new Date() };
    } catch (error) {
      console.error(`[LogService.createLog] ❌ Error:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}
