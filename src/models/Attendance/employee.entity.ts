import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import constants from "../../helpers/constants";

@Entity({ name: constants.TABLE.employees })
export class Employee {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 20, unique: true })
  employee_id!: string;

  @Column({ type: "varchar", length: 20, unique: true })
  employee_code!: string;

  @Column({ type: "varchar", length: 100 })
  full_name!: string;

  @Column({ type: "varchar", length: 100 })
  email!: string;

  @Column({ type: "varchar", length: 50 })
  department!: string;

  @Column({ type: "varchar", length: 50 })
  position!: string;

  @Column({ type: "date", nullable: true })
  hire_date!: Date | null;

  @Column({ type: "varchar", length: 20, nullable: true })
  phone_number!: string | null;

  @Column({ type: "boolean", default: true })
  is_active!: boolean;

  @CreateDateColumn({ type: "timestamp", name: "created_at", default: () => "CURRENT_TIMESTAMP" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp", name: "updated_at", default: () => "CURRENT_TIMESTAMP" })
  updated_at!: Date;
}
