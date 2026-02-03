import { Entity, PrimaryColumn, Column } from "typeorm";
import constants from "../../helpers/constants";

@Entity(constants.TABLE.TS_STN)
export class TsStn {
  @PrimaryColumn({ name: "STN_NO", type: "number" })
  stn_no!: number;

  @PrimaryColumn({ name: "COMPANY_CODE", type: "varchar2", length: 5 })
  company_code!: string;

  @Column({ name: "PRIN_CODE", type: "varchar2", length: 5 })
  prin_code!: string;

  @Column({ name: "DESCRIPTION", type: "varchar2", length: 40, nullable: true })
  description?: string;

  @Column({ name: "STN_DATE", type: "date", nullable: true })
  stn_date?: Date;

  @Column({ name: "ALLOCATED", type: "varchar2", length: 1, nullable: true, default: "'N'" })
  allocated?: string;

  @Column({ name: "ALLOCATED_DATE", type: "date", nullable: true })
  allocated_date?: Date;

  @Column({ name: "CONFIRMED", type: "varchar2", length: 1, nullable: true, default: "'N'" })
  confirmed?: string;

  @Column({ name: "CONFIRMED_DATE", type: "date", nullable: true })
  confirmed_date?: Date;

  @Column({ name: "USER_ID", type: "varchar2", length: 10, nullable: true, default: "USER" })
  user_id?: string;

  @Column({ name: "USER_DT", type: "date", nullable: true, default: () => "SYSDATE" })
  user_dt?: Date;

  @Column({ name: "REPLENISH_NO", type: "number", precision: 10, nullable: true })
  replenish_no?: number;

  @Column({ name: "REPLENISH_DATE", type: "date", nullable: true })
  replenish_date?: Date;

  @Column({ name: "REMARKS", type: "varchar2", length: 25, nullable: true })
  remarks?: string;

  @Column({ name: "OUT_JOB_NO", type: "varchar2", length: 10, nullable: true })
  out_job_no?: string;

  @Column({ name: "COUNT_NO", type: "varchar2", length: 10, nullable: true })
  count_no?: string;

  @Column({ name: "CANCEL", type: "varchar2", length: 1, nullable: true })
  cancel?: string;

  @Column({ name: "TEST", type: "char", length: 1, nullable: true })
  test?: string;
}
