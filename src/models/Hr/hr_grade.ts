import { Entity, PrimaryColumn, Column } from "typeorm";
import constants from "../../helpers/constants";
import { IHrGrade } from "../../interfaces/Hr/hr_grade";

@Entity(constants.TABLE.MS_HR_GRADE)
export class HrGrade implements IHrGrade {
  @PrimaryColumn({ name: "COMPANY_CODE", type: "varchar2", length: 5, nullable: false })
  company_code!: string;

  @PrimaryColumn({ name: "GRADE_CODE", type: "varchar2", length: 5, nullable: false })
  grade_code!: string;

  @Column({ name: "GRADE_NAME", type: "varchar2", length: 50, nullable: true })
  grade_name!: string;

  @Column({ name: "GRADE_SHORT_NAME", type: "varchar2", length: 10, nullable: true })
  grade_short_name!: string;

  @Column({ name: "OT_ELIGIBILITY", type: "varchar2", length: 1, nullable: true })
  ot_eligibility!: string;

  @Column({ name: "AIRFARE_ENTITLEMENT", type: "number", precision: 10, scale: 2, nullable: true })
  airfare_entitlement!: string;

  @Column({ name: "SPOUSE_AF_ENTITLEMENT", type: "number", precision: 10, scale: 2, nullable: true })
  spouse_af_entitlement!: string;

  @Column({ name: "DEP_AF_ENTITLEMENT", type: "number", precision: 10, scale: 2, nullable: true })
  dep_af_entitlement!: string;

  @Column({ name: "MEDICAL_ENTITLEMENT", type: "number", precision: 10, scale: 2, nullable: true })
  medical_entitlement!: string;

  @Column({ name: "SPOUSE_MED_ENTITLEMENT", type: "varchar2", length: 10, nullable: true })
  spouse_med_entitlement!: string;

  @Column({ name: "DEP_MED_ENTITLEMENT", type: "varchar2", length: 10, nullable: true })
  dep_med_entitlement!: string;

  @Column({ name: "REMARKS", type: "varchar2", length: 100, nullable: true })
  remarks!: string;

  @Column({ name: "STATUS", type: "varchar2", length: 1, nullable: true })
  status!: string;

  @Column({ name: "USER_ID", type: "varchar2", length: 20, nullable: true })
  user_id!: string;

  @Column({ name: "USER_DT", type: "varchar2", length: 20, nullable: true })
  user_dt!: string;

  @Column({ name: "TYPE", type: "varchar2", length: 10, nullable: true })
  type!: string;

  @Column({ name: "GRADE_STATUS", type: "varchar2", length: 10, nullable: true })
  grade_status!: string;

  @Column({ name: "MAIN_GRADE_CODE", type: "varchar2", length: 10, nullable: true })
  main_grade_code!: string;

  @Column({ name: "DEF_GRADE_CODE", type: "varchar2", length: 10, nullable: true })
  def_grade_code!: string;
}