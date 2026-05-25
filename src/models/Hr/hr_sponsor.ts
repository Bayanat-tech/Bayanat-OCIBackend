import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { IHrSponsor } from "../../interfaces/Hr/hr_sponsor";

@Entity("MS_HR_SPONSOR")
export class HrSponsor implements IHrSponsor {
  @PrimaryColumn({ name: "SPONSOR_CODE", type: "varchar2", length: 5 })
  sponsor_code: string;

  @PrimaryColumn({ name: "COMPANY_CODE", type: "varchar2", length: 5 })
  company_code: string;

  @Column({ name: "SPONSOR_NAME", type: "varchar2", length: 50, nullable: true })
  sponsor_name: string;

  @Column({ name: "SPONSOR_SHORT_NAME", type: "varchar2", length: 10, nullable: true })
  sponsor_short_name: string;

  @Column({ name: "TRADE_LICENSE_NO", type: "varchar2", length: 15, nullable: true })
  trade_license_no: string;

  @Column({ name: "TRADE_LICENSE_EXP_DATE", type: "date", nullable: true })
  trade_license_exp_date: Date;

  @Column({ name: "SPONSOR_ADDRESS1", type: "varchar2", length: 50, nullable: true })
  sponsor_address1: string;

  @Column({ name: "SPONSOR_ADDRESS2", type: "varchar2", length: 50, nullable: true })
  sponsor_address2: string;

  @Column({ name: "COUNTRY_CODE", type: "varchar2", length: 5, nullable: true })
  country_code: string;

  @Column({ name: "NO_OF_VISA", type: "number", nullable: true })
  no_of_visa: number;

  @Column({ name: "NO_OF_VISIT_VISA", type: "number", nullable: true })
  no_of_visit_visa: number;

  @Column({ name: "SPONSOR_LABOR_NO", type: "varchar2", length: 10, nullable: true })
  sponsor_labor_no: string;

  @Column({ name: "SPONSOR_IMMGR_NO", type: "varchar2", length: 10, nullable: true })
  sponsor_immgr_no: string;

  @Column({ name: "SPONSOR_IMMGR_DT", type: "date", nullable: true })
  sponsor_immgr_dt: Date;

  @Column({ name: "LABOUR_CARD_BLOCKED", type: "varchar2", length: 10, nullable: true })
  labour_card_blocked: string;

  @Column({ name: "BLOCKED_REASON", type: "varchar2", length: 100, nullable: true })
  blocked_reason: string;

  @Column({ name: "REMARKS", type: "varchar2", length: 100, nullable: true })
  remarks: string;

  @Column({ name: "STATUS", type: "varchar2", length: 1, nullable: true })
  status: string;

  @Column({ name: "UPDATED_BY", type: "varchar2", length: 50, nullable: true })
  updated_by: string;

  @Column({ name: "CREATED_BY", type: "varchar2", length: 20, nullable: true })
  created_by: string;

  @CreateDateColumn({ name: "CREATED_AT", type: "timestamp" })
  created_at: Date;

  @UpdateDateColumn({ name: "UPDATED_AT", type: "timestamp" })
  updated_at: Date;
}
