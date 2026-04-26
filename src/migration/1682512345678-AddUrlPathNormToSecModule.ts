import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUrlPathNormToSecModule1682512345678 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add normalized column for url_path and populate it from existing data
    await queryRunner.query(`ALTER TABLE sec_module_data ADD (url_path_norm VARCHAR2(4000))`);

    await queryRunner.query(
      `UPDATE sec_module_data SET url_path_norm = LOWER(TRIM(NVL(url_path, component_name))) WHERE url_path_norm IS NULL`);

    // Create index to speed up equality lookups on normalized path
    await queryRunner.query(`CREATE INDEX idx_sec_module_url_path_norm ON sec_module_data(url_path_norm)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    try {
      await queryRunner.query(`DROP INDEX idx_sec_module_url_path_norm`);
    } catch (e) {
      // ignore if index doesn't exist
    }
    await queryRunner.query(`ALTER TABLE sec_module_data DROP COLUMN url_path_norm`);
  }
}

export default AddUrlPathNormToSecModule1682512345678;
