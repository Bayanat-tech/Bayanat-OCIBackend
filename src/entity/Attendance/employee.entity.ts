import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
  PrimaryColumn,
} from "typeorm";
import constants from "../../helpers/constants";

@Entity({ name: constants.TABLE.EMPLOYEES })
@Index(["employee_id"], { unique: true })
@Index(["employee_code"], { unique: true })

export class Employee {
  //@PrimaryGeneratedColumn("uuid")
  @PrimaryColumn({ name: "ID", type: "varchar2", length: 36 })
  id!: string;

  @Column({ name: "EMPLOYEE_ID", type: "varchar2", length: 20, unique: true })
  employee_id!: string;

  @Column({ name: "EMPLOYEE_CODE", type: "varchar2", length: 20, unique: true})
  employee_code!: string;

  @Column({ name: "FULL_NAME", type: "varchar2", length: 100 })
  full_name!: string;

  @Column({ name: "EMAIL", type: "varchar2", length: 100 })
  email!: string;

  @Column({ name: "DEPARTMENT", type: "varchar2", length: 50 })
  department!: string;

  @Column({ name: "POSITION", type: "varchar2", length: 50 })
  position!: string;

  @Column({ name: "HIRE_DATE", type: "timestamp", nullable: true })
  hire_date!: Date | null;

  @Column({ name: "PHONE_NUMBER", type: "varchar2", length: 20, nullable: true })
  phone_number!: string | null;

  @Column({ name: "IS_ACTIVE", type: "number", precision: 1 , default: "true"})
 is_active!: 1 | 0;

  @Column({ name: "CREATED_AT", type: "timestamp" })
  created_at!: Date;

  @Column({ name: "UPDATED_AT", type: "timestamp" })
  updated_at!: Date;
}



