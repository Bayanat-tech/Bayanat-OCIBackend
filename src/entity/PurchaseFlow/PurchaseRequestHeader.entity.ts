import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("GT_MY_TASK")
export class PurchaseRequestHeader {
  @PrimaryColumn({ type: "varchar", length: 25 })
  request_number: string;

  @Column({ type: "varchar", length: 25 })
  document_number: string;

  @Column({ type: "timestamp", nullable: true, default: () => "CURRENT_TIMESTAMP" })
  request_date: Date;

  @Column({ type: "varchar", length: 200, nullable: true })
  description: string;

  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  amount: number;

  @Column({ type: "varchar", length: 200, nullable: true })
  project_name: string;

  @PrimaryColumn({ type: "varchar", length: 15 })
  flow_code: string;

  @PrimaryColumn({ type: "varchar", length: 100 })
  document_type: string;

  @PrimaryColumn({ type: "varchar", length: 100 })
  status: string;

  @Column({ type: "int", nullable: true })
  flow_level_running: number;

  @UpdateDateColumn({ type: "timestamp", nullable: true })
  last_updated: Date;

  @Column({ type: "varchar", length: 50, nullable: true })
  created_by: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  updated_by: string;

  @Column({ type: "varchar", nullable: true })
  company_name: string;

  @Column({ type: "varchar", nullable: true })
  reference_doc_no: string;
}
