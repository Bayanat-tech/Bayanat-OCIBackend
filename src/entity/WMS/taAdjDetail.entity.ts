import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";
import constants from "../../helpers/constants";

@Entity({ name: "TA_ADJDETAIL" })
export class TaAdjDetail {
  
  @PrimaryColumn({ name: "JOB_NO", type: "varchar2", length: 20 })
  JOB_NO!: string;

  @Column({ name: "PROD_CODE", type: "varchar2", length: 30, nullable: true })
  PROD_CODE?: string;

  @Column({ name: "QTY_PUOM", type: "number", precision: 18, scale: 4, nullable: true })
  QTY_PUOM?: number;

  @Column({ name: "QTY_LUOM", type: "number", precision: 18, scale: 4, nullable: true })
  QTY_LUOM?: number;

  @Column({ name: "ADJ_TYPE", type: "varchar2", length: 10, nullable: true })
  ADJ_TYPE?: string;

  @Column({ name: "COMPANY_CODE", type: "varchar2", length: 30 })
  COMPANY_CODE!: string;

  @Column({ name: "CREATED_BY", type: "varchar2", length: 50, nullable: true })
  CREATED_BY?: string;

  @Column({ name: "UPDATED_BY", type: "varchar2", length: 50, nullable: true })
  UPDATED_BY?: string;

  @CreateDateColumn({
    name: "CREATED_AT",
    type: "timestamp",
    default: () => "CURRENT_TIMESTAMP",
  })
  CREATED_AT!: Date;

  @UpdateDateColumn({
    name: "UPDATED_AT",
    type: "timestamp",
    default: () => "CURRENT_TIMESTAMP",
  })
  UPDATED_AT!: Date;
}
