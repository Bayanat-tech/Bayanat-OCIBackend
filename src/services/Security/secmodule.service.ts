import { AppDataSource, getRepository } from "../../database/connection";
import { ensureCorrectSchemaOnQueryRunner } from "../../database/TypeORMTenantInterceptor";
import { SecCompanyModuleAccess } from "../../entity/Security/seccompanymoduleaccess.entity";
import { SecModule } from "../../entity/Security/secmodule.entity";
import constants from "../../helpers/constants";
import { In } from "typeorm";

type ModuleIdentity = {
  company_code?: string;
  app_code: string;
  level1: string;
  level2: string | null;
  level3: string | null;
  url_path: string;
  icon?: string | null;
};

type CreateModuleData = ModuleIdentity & {
  company_code: string;
  position: number;
  icon: string;
  created_by: string;
  updated_by: string;
};

export class SecModuleService {
  private static getSecModuleRepository() {
    return getRepository(SecModule);
  }

  static async findDuplicate(params: ModuleIdentity): Promise<SecModule | null> {
    const rows = await this.getSecModuleRepository().query(
      `SELECT * FROM SEC_MODULE_DATA
        WHERE TRIM(APP_CODE) = TRIM(:1)
          AND TRIM(LEVEL1) = TRIM(:2)
          AND NVL(TRIM(LEVEL2), '~') = NVL(TRIM(:3), '~')
          AND NVL(TRIM(LEVEL3), '~') = NVL(TRIM(:4), '~')
          AND NVL(TRIM(URL_PATH), '~') = NVL(TRIM(:5), '~')
          AND ROWNUM = 1`,
      [params.app_code, params.level1, params.level2, params.level3, params.url_path],
    );
    const values = Array.isArray(rows) ? rows : rows?.rows || [];
    return values[0] || null;
  }

  static async findBySerialAndCompany(serial_no: number, company_code: string): Promise<SecModule | null> {
    const rows = await this.getSecModuleRepository().query(
      `SELECT m.* FROM SEC_MODULE_DATA m
         JOIN SEC_COMPANY_MODULE_ACCESS c ON c.MODULE_ID = m.SERIAL_NO
        WHERE m.SERIAL_NO = :1 AND c.COMPANY_CODE = :2 AND c.ENABLED = 'Y'`,
      [serial_no, company_code],
    );
    const values = Array.isArray(rows) ? rows : rows?.rows || [];
    return values[0] || null;
  }

  static async enableForCompany(companyCode: string, moduleId: number): Promise<void> {
    await getRepository(SecCompanyModuleAccess).save({
      company_code: companyCode,
      module_id: moduleId,
      enabled: "Y",
    });
  }

  static async createModule(moduleData: CreateModuleData): Promise<SecModule> {
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await ensureCorrectSchemaOnQueryRunner(queryRunner);
    await queryRunner.startTransaction();
    try {
      const repository = queryRunner.manager.getRepository(SecModule);
      const { company_code, ...globalData } = moduleData;
      const rows = await this.lockScope(repository, moduleData.app_code);
      const desiredPosition = clampPosition(moduleData.position, rows.length + 1);
      await this.displaceScope(repository, rows);

      const maxRows = await repository.query(
        `SELECT NVL(MAX(SERIAL_NO), 0) AS MAX_SERIAL FROM ${constants.TABLE.SEC_MODULE_DATA}`,
      );
      const maxRow = Array.isArray(maxRows) ? maxRows[0] : maxRows?.rows?.[0];
      const nextSerial = Number(maxRow?.MAX_SERIAL ?? maxRow?.max_serial ?? 0) + 1;
      const module: SecModule = repository.create({
        app_code: globalData.app_code,
        level1: globalData.level1,
        level2: globalData.level2,
        level3: globalData.level3,
        url_path: globalData.url_path,
        icon: globalData.icon,
        created_by: globalData.created_by,
        updated_by: globalData.updated_by,
        position: 2000000 + nextSerial,
        serial_no: nextSerial,
        created_at: new Date(),
        updated_at: new Date(),
      });
      const saved = await repository.save(module);
      await queryRunner.manager.getRepository(SecCompanyModuleAccess).save({
        company_code,
        module_id: nextSerial,
        enabled: "Y",
      });
      rows.splice(desiredPosition - 1, 0, saved);
      await this.applyPositions(repository, rows);
      await queryRunner.commitTransaction();
      saved.position = desiredPosition;
      return saved;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  static async updateModule(serial_no: number, company_code: string, updateData: any): Promise<boolean> {
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await ensureCorrectSchemaOnQueryRunner(queryRunner);
    await queryRunner.startTransaction();
    try {
      const repository = queryRunner.manager.getRepository(SecModule);
      const access = await queryRunner.manager.getRepository(SecCompanyModuleAccess).findOne({
        where: { company_code, module_id: serial_no, enabled: "Y" },
      });
      const existing = access ? await repository.findOne({ where: { serial_no } }) : null;
      if (!existing) {
        await queryRunner.rollbackTransaction();
        return false;
      }

      const oldAppCode = existing.app_code;
      const newAppCode = String(updateData.app_code || oldAppCode).trim();
      const positionChanged = Number(updateData.position) !== Number(existing.position);
      const appChanged = newAppCode !== oldAppCode;
      const { company_code: ignored, ...globalUpdate } = updateData;

      if (!positionChanged && !appChanged) {
        const result = await repository.update(
          { serial_no },
          { ...globalUpdate, app_code: newAppCode, position: existing.position, updated_at: new Date() },
        );
        await queryRunner.commitTransaction();
        return Boolean(result.affected);
      }

      const oldRows = await this.lockScope(repository, oldAppCode);
      const targetRows = oldAppCode === newAppCode ? oldRows : await this.lockScope(repository, newAppCode);
      const remainingOld = oldRows.filter((row) => Number(row.serial_no) !== serial_no);
      const remainingTarget = oldAppCode === newAppCode
        ? remainingOld
        : targetRows.filter((row) => Number(row.serial_no) !== serial_no);
      const desiredPosition = clampPosition(updateData.position, remainingTarget.length + 1);
      await this.displaceScope(repository, oldRows);
      if (oldAppCode !== newAppCode) await this.displaceScope(repository, targetRows);
      await repository.update(
        { serial_no },
        { ...globalUpdate, app_code: newAppCode, position: 3000000, updated_at: new Date() },
      );
      remainingTarget.splice(desiredPosition - 1, 0, {
        ...existing,
        ...globalUpdate,
        app_code: newAppCode,
        position: 3000000,
      });
      await this.applyPositions(repository, remainingTarget);
      if (oldAppCode !== newAppCode) await this.applyPositions(repository, remainingOld);
      await queryRunner.commitTransaction();
      return true;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /** Removing a screen from one company must not delete the shared catalogue row. */
  static async deleteAndCompact(companyCode: string, serialNumbers: number[]): Promise<boolean> {
    const result = await getRepository(SecCompanyModuleAccess).delete({
      company_code: companyCode,
      module_id: In(serialNumbers),
    });
    return Boolean(result.affected);
  }

  private static async lockScope(repository: any, appCode: string): Promise<SecModule[]> {
    return repository.createQueryBuilder("module")
      .where("module.app_code = :appCode", { appCode })
      .orderBy("NVL(module.position, 999999)", "ASC")
      .addOrderBy("module.serial_no", "ASC")
      .setLock("pessimistic_write")
      .getMany();
  }

  private static async displaceScope(repository: any, rows: SecModule[]) {
    for (let index = 0; index < rows.length; index += 1) {
      await repository.update({ serial_no: rows[index].serial_no }, { position: 1000000 + index + 1 });
      rows[index].position = 1000000 + index + 1;
    }
  }

  private static async applyPositions(repository: any, rows: SecModule[]) {
    for (let index = 0; index < rows.length; index += 1) {
      await repository.update({ serial_no: rows[index].serial_no }, { position: index + 1 });
      rows[index].position = index + 1;
    }
  }
}

function clampPosition(value: unknown, maximum: number) {
  const requested = Math.trunc(Number(value));
  if (!Number.isFinite(requested)) return maximum;
  return Math.min(Math.max(requested, 1), maximum);
}
