import { AppDataSource, getRepository } from "../../database/connection";
import { ensureCorrectSchemaOnQueryRunner } from "../../database/TypeORMTenantInterceptor";
import { SecModule } from "../../entity/Security/secmodule.entity";
import constants from "../../helpers/constants";

export class SecModuleService {
  private static getSecModuleRepository() {
    return getRepository(SecModule);
  }

  static async findDuplicate(params: {
    app_code: string;
    level1: string;
    level2: string;
    level3: string;
    url_path: string;
    component_name?: string;
    icon: string;
  }): Promise<SecModule | null> {
    const repository = this.getSecModuleRepository();
    return await repository.findOne({
      where: {
        app_code: params.app_code,
        level1: params.level1,
        level2: params.level2,
        level3: params.level3,
        url_path: params.url_path,
        icon: params.icon,
      },
    });
  }

  static async findBySerial(serial_no: number): Promise<SecModule | null> {
    const repository = this.getSecModuleRepository();
    return await repository.findOne({
      where: { serial_no },
    });
  }

  static async createModule(moduleData: {
    app_code: string;
    level1: string;
    level2: string;
    level3: string;
    position: number;
    url_path: string;
    component_name?: string;
    icon: string;
    created_by: string;
    updated_by: string;
  }): Promise<SecModule> {
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await ensureCorrectSchemaOnQueryRunner(queryRunner);
    await queryRunner.startTransaction();
    try {
      const repository = queryRunner.manager.getRepository(SecModule);
      const rows = await this.lockScope(repository, moduleData.app_code);
      const desiredPosition = clampPosition(moduleData.position, rows.length + 1);
      await this.displaceScope(repository, rows);

      const maxSerialRows = await repository.query(
        `SELECT NVL(MAX(SERIAL_NO), 0) AS MAX_SERIAL FROM ${constants.TABLE.SEC_MODULE_DATA}`,
      );
      const maxSerial = Array.isArray(maxSerialRows) ? maxSerialRows[0] : maxSerialRows?.rows?.[0];
      const nextSerial = Number(maxSerial?.MAX_SERIAL ?? maxSerial?.max_serial ?? 0) + 1;
      const module = repository.create({
        ...moduleData,
        position: 2000000 + nextSerial,
        serial_no: nextSerial,
        created_at: new Date(),
        updated_at: new Date(),
      });
      const saved = await repository.save(module);
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

  static async updateModule(
    serial_no: number,
    updateData: any
  ): Promise<boolean> {
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await ensureCorrectSchemaOnQueryRunner(queryRunner);
    await queryRunner.startTransaction();
    try {
      const repository = queryRunner.manager.getRepository(SecModule);
      const existing = await repository.findOne({ where: { serial_no } });
      if (!existing) {
        await queryRunner.rollbackTransaction();
        return false;
      }

      const oldAppCode = existing.app_code;
      const newAppCode = String(updateData.app_code || oldAppCode).trim();
      const positionChanged = Number(updateData.position) !== Number(existing.position);
      const appChanged = newAppCode !== oldAppCode;

      // Hierarchy, URL, icon, or other metadata edits do not require menu
      // resequencing. Keep these as one normal UPDATE.
      if (!positionChanged && !appChanged) {
        const { company_code: ignoredCompanyCode, ...moduleUpdate } = updateData;
        const result = await repository.update(
          { serial_no },
          {
            ...moduleUpdate,
            app_code: newAppCode,
            position: existing.position,
            updated_at: new Date(),
          },
        );
        await queryRunner.commitTransaction();
        return Boolean(result.affected && result.affected > 0);
      }

      const oldRows = await this.lockScope(repository, oldAppCode);
      const targetRows = oldAppCode === newAppCode
        ? oldRows
        : await this.lockScope(repository, newAppCode);
      const remainingOldRows = oldRows.filter((row) => Number(row.serial_no) !== Number(serial_no));
      const remainingTargetRows = oldAppCode === newAppCode
        ? remainingOldRows
        : targetRows.filter((row) => Number(row.serial_no) !== Number(serial_no));
      const desiredPosition = clampPosition(updateData.position, remainingTargetRows.length + 1);

      const movingRow = oldRows.find((row) => Number(row.serial_no) === Number(serial_no));
      await this.displaceScope(repository, oldRows);
      if (oldAppCode !== newAppCode) await this.displaceScope(repository, targetRows);
      const movingTemporaryPosition = movingRow?.position ?? existing.position;
      const { company_code: ignoredCompanyCode, ...moduleUpdate } = updateData;
      await repository.update(
        { serial_no },
        { ...moduleUpdate, app_code: newAppCode, position: 3000000, updated_at: new Date() },
      );
      const moved = { ...existing, ...moduleUpdate, app_code: newAppCode, position: 3000000 } as SecModule;
      remainingTargetRows.splice(desiredPosition - 1, 0, moved);
      await this.applyPositions(repository, remainingTargetRows);
      if (oldAppCode !== newAppCode) await this.applyPositions(repository, remainingOldRows);
      await queryRunner.commitTransaction();
      return true;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  static async deleteAndCompact(serialNumbers: number[]): Promise<boolean> {
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await ensureCorrectSchemaOnQueryRunner(queryRunner);
    await queryRunner.startTransaction();
    try {
      const repository = queryRunner.manager.getRepository(SecModule);
      const selected = await repository.createQueryBuilder("module")
        .where("module.serial_no IN (:...serialNumbers)", { serialNumbers })
        .getMany();
      if (!selected.length) {
        await queryRunner.rollbackTransaction();
        return false;
      }

      const appCodes = Array.from(new Set(selected.map((row) => row.app_code)));
      for (const appCode of appCodes) {
        const rows = await this.lockScope(repository, appCode);
        const remaining = rows.filter((row) => !serialNumbers.includes(Number(row.serial_no)));
        await repository.delete(selected.filter((row) => row.app_code === appCode).map((row) => row.serial_no));
        await this.displaceScope(repository, remaining);
        await this.applyPositions(repository, remaining);
      }
      await queryRunner.commitTransaction();
      return true;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private static async lockScope(repository: any, appCode: string): Promise<SecModule[]> {
    return repository.createQueryBuilder("module")
      .where("module.app_code = :appCode", { appCode })
      .orderBy("NVL(module.position, 999999)", "ASC")
      .addOrderBy("module.serial_no", "ASC")
      .getMany();
  }

  private static async displaceScope(repository: any, rows: SecModule[]) {
    for (let index = 0; index < rows.length; index += 1) {
      const temporaryPosition = 1000000 + index + 1;
      await repository.update(
        { serial_no: rows[index].serial_no },
        { position: temporaryPosition },
      );
      rows[index].position = temporaryPosition;
    }
  }

  private static async applyPositions(repository: any, rows: SecModule[]) {
    for (let index = 0; index < rows.length; index += 1) {
      await repository.update(
        { serial_no: rows[index].serial_no },
        { position: index + 1 },
      );
      rows[index].position = index + 1;
    }
  }
}

function clampPosition(value: unknown, maximum: number) {
  const requested = Math.trunc(Number(value));
  if (!Number.isFinite(requested)) return maximum;
  return Math.min(Math.max(requested, 1), maximum);
}
