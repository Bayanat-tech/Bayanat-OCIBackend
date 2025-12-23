import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, OneToOne } from "typeorm";
import constants from "../../helpers/constants";
import { AttendanceRecord } from "./attendance_record.entity";
import { ProxyLog } from "./ProxyLog.entity";
import { Employee } from "./employee.entity";

export enum AttendanceEventType {
  CHECK_IN = "check_in",
  CHECK_OUT = "check_out",
}

export enum DataTransferFlag {
  Y = "Y",
  N = "N",
}

export enum AttendanceStatus {
  PENDING = "pending_auto_confirm",
  CONFIRMED = "confirmed",
  CANCELLED = "cancelled",
}

@Entity({ name: constants.TABLE.attendance_events })
export class AttendanceEvent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar2", length: 20 })
  employee_id!: string;

  @Column({ type: "varchar2", length: 50 })
  employee_code!: string;

  @Column({ type: "varchar2", nullable: true })
  attendance_record_id?: string | null;

  @Column({ type: "timestamp" })
  event_time!: Date;

  @Column({ type: "varchar2", length: 20, enum: AttendanceEventType})
  event_type!: AttendanceEventType;

  @Column({ type: "char", length: 1, enum: DataTransferFlag, default: DataTransferFlag.N,})
  data_transfer!: DataTransferFlag;

  @Column({ type: "timestamp", nullable: true })
  transfer_date!: Date | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @Column({ type: "number", precision: 10, scale: 8, nullable: true })
  latitude!: number | null;

  @Column({ type: "number", precision: 11, scale: 8, nullable: true })
  longitude!: number | null;

  @Column({ type: "number", precision: 8, scale: 2, nullable: true })
  accuracy!: number | null;

  @Column({
    type: "varchar2",
    length: 20,
    default: "unknown",
  })
  location_type!: string;

  @Column({ type: "clob", nullable: true })
  address!: any;

  @Column({ type: "varchar2", length: 100, nullable: true })
  office_name!: string | null;

  @Column({ type: "varchar2", length: 100, nullable: true })
  uuid!: string | null;

  @Column({ type: "number", precision: 5, scale: 2, nullable: true })
  confidence!: number | null;

  @Column({ type: "varchar2", length: 500, nullable: true })
  s3_image_url!: string | null;

  @Column({
    type: "varchar2",
    length: 30,
    enum: AttendanceStatus,
    default: AttendanceStatus.CONFIRMED,
  })
  status!: AttendanceStatus;

  @Column({ type: "varchar2", length: 50, nullable: true })
  confirmed_by!: string | null;

  @Column({ type: "timestamp", nullable: true })
  confirmed_at!: Date | null;

  @Column({ type: "timestamp", nullable: true })
  auto_confirm_time!: Date | null;

  //Virtual composed field — NOT stored in DB (avoids selecting non-existing column)
  get location_data() {
    if (
      this.latitude == null &&
      this.longitude == null &&
      this.accuracy == null &&
      !this.address &&
      !this.location_type &&
      !this.office_name
    ) {
      return null;
    }

    return {
      latitude: this.latitude,
      longitude: this.longitude,
      accuracy: this.accuracy,
      location_type: this.location_type,
      office_name: this.office_name,
      address: this.address,
    };
  }

  @ManyToOne(() => Employee, employee => employee.attendanceEvents)
  @JoinColumn({ name: "EMPLOYEE_ID", referencedColumnName: "employee_id" })
  employee!: Employee;

  @ManyToOne(() => AttendanceRecord, record => record.events)
  @JoinColumn({ name: "ATTENDANCE_RECORD_ID" })
  record!: AttendanceRecord;

  // AttendanceEvent to ProxyLog 
  @OneToOne(() => ProxyLog, log => log.attendanceEvent)
  proxyLog!: ProxyLog;

}

