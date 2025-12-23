import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index, ManyToOne, JoinColumn } from "typeorm";
import constants from "../../helpers/constants";
import { Employee } from "./employee.entity";

@Entity({ name: constants.TABLE.employee_faces })
@Index(["employee_id"])

export class EmployeeFace {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar2", length: 20 })
  employee_id!: string;

  @Column({ type: "varchar2", length: 255 })
  s3_key!: string;

  @Column({ type: "clob" })
  descriptor!: object;

 @Column({ type: "number", precision: 1, default: "1"})
 is_active!: "1" | "0";

  @Column({ type: "timestamp" })
  created_at!: Date;

  @ManyToOne(() => Employee, employee => employee.employeeFaces)
  @JoinColumn({ name: "EMPLOYEE_ID", referencedColumnName: "employee_id" })
  employee!: Employee;
}
