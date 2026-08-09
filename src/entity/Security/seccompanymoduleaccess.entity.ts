import { Column, Entity, PrimaryColumn } from "typeorm";
import constants from "../../helpers/constants";

/** Company-specific enablement for the global SEC_MODULE_DATA catalogue. */
@Entity(constants.TABLE.SEC_COMPANY_MODULE_ACCESS)
export class SecCompanyModuleAccess {
  @PrimaryColumn({ name: "COMPANY_CODE", type: "varchar2", length: 20 })
  company_code!: string;

  @PrimaryColumn({ name: "MODULE_ID", type: "number" })
  module_id!: number;

  @Column({ name: "ENABLED", type: "char", length: 1, default: "Y" })
  enabled!: string;
}
