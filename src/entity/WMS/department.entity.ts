import { Entity, PrimaryColumn, Column } from "typeorm";
import constants from "../../helpers/constants";

@Entity(constants.TABLE.MS_DEPARTMENT)
export class DepartmentMaster {

  @PrimaryColumn({ name: "COMPANY_CODE", type: "varchar2", length: 5 })
  company_code!: string;

  @PrimaryColumn({ name: "DEPT_CODE", type: "varchar2", length: 10 })
  dept_code!: string;

  @Column({ name: "DEPT_NAME", type: "varchar2", length: 25, nullable: true })
  dept_name?: string;

  @Column({ name: "INV_FLAG", type: "varchar2", length: 2, nullable: true })
  inv_flag?: string;

  @Column({ name: "USER_DT", type: "date", nullable: true })
  user_dt?: Date;

  @Column({ name: "USER_ID", type: "varchar2", length: 10, nullable: true })
  user_id?: string;

  @Column({ name: "JOBNO_SEQ", type: "number", precision: 10, nullable: true })
  jobno_seq?: number;

  @Column({ name: "INVNO_SEQ", type: "number", precision: 10, nullable: true })
  invno_seq?: number;

  @Column({ name: "OPERATION_TYPE", type: "varchar2", length: 1, nullable: true })
  operation_type?: string;

  @Column({ name: "DIV_CODE", type: "varchar2", length: 5, nullable: true })
  div_code?: string;

  @Column({ name: "AC_DIV_CODE", type: "varchar2", length: 5, nullable: true })
  ac_div_code?: string;

  @Column({ name: "INV_PREFIX", type: "varchar2", length: 3, nullable: true })
  inv_prefix?: string;

  @Column({ name: "WMS_INV_PREFIX", type: "varchar2", length: 3, nullable: true })
  wms_inv_prefix?: string;

  @Column({ name: "TRSPT_INV_PREFIX", type: "varchar2", length: 3, nullable: true })
  trspt_inv_prefix?: string;

  @Column({ name: "JOBNO_SEQ_INB", type: "char", length: 2, nullable: true })
  jobno_seq_inb?: string;

  @Column({ name: "JOBNO_SEQ_OUB", type: "char", length: 2, nullable: true })
  jobno_seq_oub?: string;
}