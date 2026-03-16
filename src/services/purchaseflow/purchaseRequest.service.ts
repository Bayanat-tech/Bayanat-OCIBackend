import { oracleDb } from "../../database/connection";
import { QueryExecutor } from "../../database/QueryExecutor";

export class MessageBoxService {
  static async fetchMessageBox(
    userId: string, 
    companyCode: string
) {
    const result = await QueryExecutor.executeRawQuery(
      `
      SELECT 
        MESSAGE_BOX,
        MESSAGE_TYPE
      FROM GT_SESSION_MESSAGEBOX
      WHERE USER_ID = :userId
      AND COMPANY_CODE = :companyCode
      `,
      {
        replacements: { userId, companyCode }
      }
    );
    return result;
  }
}
