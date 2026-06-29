import { Entity, PrimaryColumn, Column } from "typeorm";
import constants from "../../helpers/constants";
import { IHrLabourDesignation } from "../../interfaces/Hr/hr_labour_designation";

@Entity(constants.TABLE.MS_HR_LABOUR_DESIGNATION)
export class HrLabourDesignation implements IHrLabourDesignation {
  @PrimaryColumn({ name: "COMPANY_CODE", type: "varchar2", length: 5, nullable: false })
  company_code!: string;

  @PrimaryColumn({ name: "LABOUR_DESG_CODE", type: "varchar2", length: 10, nullable: false })
  labour_desg_code!: string;

  @Column({ name: "LABOUR_DESG_NAME", type: "varchar2", length: 50, nullable: true })
  labour_desg_name!: string;

  @Column({ name: "LABOUR_DESG_SHORT_NAME", type: "varchar2", length: 10, nullable: true })
  labour_desg_short_name!: string;

  @Column({ name: "REMARKS", type: "varchar2", length: 100, nullable: true })
  remarks!: string;

  @Column({ name: "STATUS", type: "varchar2", length: 1, nullable: true })
  status!: string;

  @Column({ name: "USER_ID", type: "varchar2", length: 20, nullable: true })
  user_id!: string;

  @Column({ name: "USER_DT", type: "varchar2", length: 20, nullable: true })
  user_dt!: string;
}