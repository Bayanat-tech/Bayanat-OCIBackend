import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
} from "typeorm";

@Entity({ name: "proxy_logs" })
export class ProxyLog {
  @PrimaryColumn({ type: "varchar2", length: 36 })
  id!: string;

  @Column({ type: "varchar2", length: 100, nullable: true })
  uuid!: string | null;

  @Column({ type: "timestamp" })
  timestamp!: Date;

  @Column({ type: "varchar2", length: 100 })
  proxy_employee_code!: string;

  @Column({ type: "varchar2", length: 255 })
  proxy_employee_name!: string;

  @Column({ type: "varchar2", length: 100, nullable: true })
  actual_employee_code!: string | null;

  @Column({ type: "varchar2", length: 255, nullable: true })
  actual_employee_name!: string | null;

  @Column({ type: "number", precision: 5, scale: 2 })
  confidence!: number;

  @Column({ type: "varchar2", length: 500, nullable: true })
  s3_image_url!: string | null;

  @Column({ type: "clob", nullable: true })
  location_data!: any | null;

  @Column({ type: "varchar2", length: 20 })
  action!: "check_in" | "check_out";

  @Column({ type: "varchar2", length: 60 })
  action_taken!: "cancelled_by_user" | "auto_rejected" | "attempted_cancellation_after_confirmation";

  @Column({ type: "varchar2", length: 255, nullable: true })
  device_type!: string | null;

  @Column({ type: "varchar2", length: 50, default: "reported" })
  status!: string;

  @CreateDateColumn({ type: "timestamp", nullable: true })
  created_at!: Date | null;

  @Column({ type: "varchar2", length: 400, nullable: false })
  reason!: string | null;
}
