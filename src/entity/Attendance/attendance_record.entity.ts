import {
  Entity,
  Column,
  PrimaryColumn,
  OneToMany,
} from "typeorm";
import constants from "../../helpers/constants";
import { AttendanceEvent } from "./attendance_events.entity";

@Entity({ name: constants.TABLE.attendance_records })
export class AttendanceRecord {
  @PrimaryColumn("uuid")
  id!: string;

  @Column({ type: "varchar2", length: 20 })
  employee_id!: string;

  @Column({ type: "varchar2", length: 40 })
  employee_code!: string;

  @Column({ type: "date" })
  date!: Date;

  @Column({ type: "timestamp", nullable: true })
  first_check_in!: Date | null;

  @Column({ type: "timestamp", nullable: true })
  last_check_out!: Date | null;

  @Column({ type: "timestamp", nullable: true })
  check_in!: Date | null;

  @Column({ type: "timestamp", nullable: true })
  check_out!: Date | null;

  @Column({ type: "number", nullable: true })
  total_hours!: number | null;

  @Column({ type: "varchar2", length: 20 })
  status!: string;

  //relaonship with AttendanceEvent
  @OneToMany(
    () => AttendanceEvent,
    (event) => event.attendance_record_id,
    { eager: false }
  )
  events?: AttendanceEvent[];
}
