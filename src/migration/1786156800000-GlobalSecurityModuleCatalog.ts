import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase-one, non-destructive conversion of SEC_MODULE_DATA into a global
 * catalogue. COMPANY_CODE stays as a deprecated physical column temporarily
 * so older deployments can be rolled forward without rebuilding the table.
 */
export class GlobalSecurityModuleCatalog1786156800000 implements MigrationInterface {
  name = "GlobalSecurityModuleCatalog1786156800000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE SEC_COMPANY_MODULE_ACCESS (
        COMPANY_CODE VARCHAR2(20) NOT NULL,
        MODULE_ID NUMBER NOT NULL,
        ENABLED CHAR(1) DEFAULT 'Y' NOT NULL,
        CONSTRAINT PK_SEC_COMPANY_MODULE_ACCESS PRIMARY KEY (COMPANY_CODE, MODULE_ID),
        CONSTRAINT CK_SEC_COMPANY_MODULE_ENABLED CHECK (ENABLED IN ('Y', 'N'))
      )
    `);
    await queryRunner.query(`
      INSERT INTO SEC_COMPANY_MODULE_ACCESS (COMPANY_CODE, MODULE_ID, ENABLED)
      SELECT DISTINCT TRIM(COMPANY_CODE), SERIAL_NO, 'Y'
        FROM SEC_MODULE_DATA
       WHERE COMPANY_CODE IS NOT NULL
    `);
    // New application writes omit this deprecated field. The default keeps
    // old SQL and mixed-version application nodes operational during rollout.
    await queryRunner.query(`
      ALTER TABLE SEC_MODULE_DATA MODIFY (COMPANY_CODE DEFAULT 'GLOBAL' NULL)
    `);
    await queryRunner.query(`
      CREATE INDEX IX_SEC_COMPANY_MODULE_ID
          ON SEC_COMPANY_MODULE_ACCESS (MODULE_ID, COMPANY_CODE, ENABLED)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IX_SEC_COMPANY_MODULE_ID`);
    await queryRunner.query(`DROP TABLE SEC_COMPANY_MODULE_ACCESS`);
  }
}
