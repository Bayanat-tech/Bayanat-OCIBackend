import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";
import constants from "../../helpers/constants";

@Entity({ name: constants.TABLE.employees })
@Index(["employee_id"], { unique: true })
@Index(["employee_code"], { unique: true })

export class Employee {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar2", length: 20 })
  employee_id!: string;

  @Column({ type: "varchar2", length: 20 })
  employee_code!: string;

  @Column({ type: "varchar2", length: 100 })
  full_name!: string;

  @Column({ type: "varchar2", length: 100 })
  email!: string;

  @Column({ type: "varchar2", length: 50 })
  department!: string;

  @Column({ type: "varchar2", length: 50 })
  position!: string;

  @Column({ type: "timestamp", nullable: true })
  hire_date!: Date | null;

  @Column({ type: "varchar2", length: 20, nullable: true })
  phone_number!: string | null;

  @Column({ type: "varchar2", length: 5, default: "true"})
 is_active!: "true" | "false";

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
