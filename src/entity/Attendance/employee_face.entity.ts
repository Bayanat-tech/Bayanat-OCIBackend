import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from "typeorm";
import constants from "../../helpers/constants";

@Entity({ name: constants.TABLE.employee_faces })
@Index("idx_employee_id", ["employee_id"])

export class EmployeeFace {
  
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar2", length: 20, nullable: false })
  employee_id!: string;

  @Column({ type: "varchar2", length: 255, nullable: false })
  s3_key!: string;

  @Column({ type: "clob", nullable: false })
  descriptor!: object;

  @Column({ type: "clob", nullable: true })
  arc_descriptor?: object;

  @Column({ type: "number", default: 1 })
  is_active!: boolean;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;
}
