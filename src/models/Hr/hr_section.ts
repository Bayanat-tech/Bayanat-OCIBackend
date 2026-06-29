import { Entity, PrimaryColumn, Column } from "typeorm";
import constants from "../../helpers/constants";
import { IHrSection } from "../../interfaces/Hr/hr_section";

@Entity(constants.TABLE.MS_HR_SECTION)
export class HrSection implements IHrSection {
  @Column({ name: "COMPANY_CODE", type: "varchar2", length: 5, nullable: false })
  company_code!: string;

  @Column({ name: "DIV_CODE", type: "varchar2", length: 5, nullable: true })
  div_code!: string;

  @Column({ name: "DEPT_CODE", type: "varchar2", length: 5, nullable: true })
  dept_code!: string;

  @PrimaryColumn({ name: "SECTION_CODE", type: "varchar2", length: 5, nullable: false })
  section_code!: string;

  @Column({ name: "SECTION_NAME", type: "varchar2", length: 50, nullable: false })
  section_name!: string;

  @Column({ name: "SECTION_SHORT_NAME", type: "varchar2", length: 10, nullable: true })
  section_short_name!: string;

  @Column({ name: "SECT_ADDR1", type: "varchar2", length: 50, nullable: true })
  sect_addr1!: string;

  @Column({ name: "SECT_ADDR2", type: "varchar2", length: 50, nullable: true })
  sect_addr2!: string;

  @Column({ name: "SECT_ADDR3", type: "varchar2", length: 50, nullable: true })
  sect_addr3!: string;

  @Column({ name: "PHONE", type: "varchar2", length: 25, nullable: true })
  phone!: string;

  @Column({ name: "FAX", type: "varchar2", length: 25, nullable: true })
  fax!: string;

  @Column({ name: "EMAIL", type: "varchar2", length: 50, nullable: true })
  email!: string;

  @Column({ name: "SECT_HEAD_ID", type: "varchar2", length: 10, nullable: true })
  sect_head_id!: string;

  @Column({ name: "REMARKS", type: "varchar2", length: 100, nullable: true })
  remarks!: string;

  @Column({ name: "STATUS", type: "varchar2", length: 1, nullable: true })
  status!: string;

  @Column({ name: "USER_ID", type: "varchar2", length: 20, nullable: true })
  user_id!: string;

  @Column({ name: "USER_DT", type: "varchar2", length: 20, nullable: true })
  user_dt!: string;

  @Column({ name: "ENTERPRICE_CODE", type: "varchar2", length: 5, nullable: true })
  enterprice_code!: string;

  @Column({ name: "STAFF_CNTRL_AC_GROUP", type: "varchar2", length: 20, nullable: true })
  staff_cntrl_ac_group!: string;

  @Column({ name: "STAFF_LOAN_AC_GROUP", type: "varchar2", length: 20, nullable: true })
  staff_loan_ac_group!: string;

  @Column({ name: "SALARY_EXPENSE_AC_CODE", type: "varchar2", length: 20, nullable: true })
  salary_expense_ac_code!: string;

  @Column({ name: "EXPENSE_SUB_TYPE", type: "varchar2", length: 20, nullable: true })
  expense_sub_type!: string;

  @Column({ name: "EXPENSE_TYPE", type: "varchar2", length: 20, nullable: true })
  expense_type!: string;
}