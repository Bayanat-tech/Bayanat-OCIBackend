import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";
import constants from "../../helpers/constants";

@Entity(constants.TABLE.MS_DEPARTMENT)
export class DepartmentMaster {

  @PrimaryColumn({ name: "DEPT_CODE", type: "varchar2", length: 10 })
  dept_code!: string;

  @Column({ name: "DEPT_NAME", type: "varchar2", length: 25, nullable: true })
  dept_name?: string;

  @Column({ name: "INV_FLAG", type: "varchar2", length: 2, nullable: true })
  inv_flag?: string;

  @Column({ name: "JOBNO_SEQ", type: "number", nullable: true })
  jobno_seq?: number;

  @Column({ name: "INVNO_SEQ", type: "number", nullable: true })
  invno_seq?: number;

  @Column({ name: "COMPANY_CODE", type: "varchar2", length: 20 })
  company_code!: string;

  @Column({ name: "OPERATION_TYPE", type: "varchar2", length: 1, nullable: true })
  operation_type?: string;

  @Column({ name: "DIV_CODE", type: "varchar2", length: 5, default: () => "'01'" })
  div_code!: string;

  @Column({ name: "AC_DIV_CODE", type: "varchar2", length: 5, default: () => "'10'" })
  ac_div_code!: string;

  @Column({ name: "DEPT_EMAIL", type: "varchar2", length: 250, nullable: true })
  dept_email?: string;

  @Column({ name: "DN_EMAIL", type: "varchar2", length: 250, nullable: true })
  dn_email?: string;

  @Column({ name: "GRN_EMAIL", type: "varchar2", length: 250, nullable: true })
  grn_email?: string;

  @Column({ name: "INV_GEN", type: "char", length: 1, default: () => "'N'" })
  inv_gen!: string;

  @Column({ name: "INB_OUB_RELATED", type: "char", length: 1, default: () => "'N'" })
  inb_oub_related!: string;

  @Column({ name: "INV_PREFIX", type: "varchar2", length: 2, nullable: true })
  inv_prefix?: string;

  @Column({ name: "UPDATED_BY", type: "varchar2", length: 50, nullable: true })
  updated_by?: string;

  @Column({ name: "CREATED_BY", type: "varchar2", length: 20, nullable: true })
  created_by?: string;

  @Column({ name: "WMS_INV_PREFIX", type: "varchar2", length: 100, nullable: true })
  wms_inv_prefix?: string;

  @Column({ name: "TRSPT_INV_PREFIX", type: "varchar2", length: 100, nullable: true })
  trspt_inv_prefix?: string;

  @CreateDateColumn({
    name: "CREATED_AT",
    type: "timestamp",
    default: () => "CURRENT_TIMESTAMP",
  })
  created_at!: Date;

  @UpdateDateColumn({
    name: "UPDATED_AT",
    type: "timestamp",
    default: () => "CURRENT_TIMESTAMP",
  })
  updated_at!: Date;
}
