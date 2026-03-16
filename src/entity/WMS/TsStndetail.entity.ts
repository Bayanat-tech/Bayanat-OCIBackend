import { Entity, PrimaryColumn, Column } from "typeorm";
import constants from "../../helpers/constants";

@Entity(constants.TABLE.TS_STNDETAIL)
export class TsStndetail {
  @PrimaryColumn({ name: "COMPANY_CODE", type: "varchar2", length: 5 })
  company_code!: string;

  @PrimaryColumn({ name: "PRIN_CODE", type: "varchar2", length: 5 })
  prin_code!: string;

  @PrimaryColumn({ name: "STN_NO", type: "number" })
  stn_no!: number;

  @PrimaryColumn({ name: "SERIAL_NO", type: "number" })
  serial_no!: number;

  @Column({ name: "SEQ_NUMBER", type: "number", precision: 15 })
  seq_number!: number;

  @Column({ name: "PROD_CODE", type: "varchar2", length: 40, nullable: true })
  prod_code?: string;

  @Column({ name: "JOB_NO", type: "varchar2", length: 10, nullable: true })
  job_no?: string;

  @Column({ name: "CONTAINER_NO", type: "varchar2", length: 20, nullable: true })
  container_no?: string;

  @Column({ name: "DOC_REF", type: "varchar2", length: 20, nullable: true })
  doc_ref?: string;

  @Column({ name: "FROM_SITE", type: "varchar2", length: 5, nullable: true })
  from_site?: string;

  @Column({ name: "TO_SITE", type: "varchar2", length: 5, nullable: true })
  to_site?: string;

  @Column({ name: "FROM_LOC_START", type: "varchar2", length: 15, nullable: true })
  from_loc_start?: string;

  @Column({ name: "FROM_LOC_END", type: "varchar2", length: 15, nullable: true })
  from_loc_end?: string;

  @Column({ name: "TO_LOC_START", type: "varchar2", length: 15, nullable: true })
  to_loc_start?: string;

  @Column({ name: "TO_LOC_END", type: "varchar2", length: 15, nullable: true })
  to_loc_end?: string;

  @Column({ name: "FROM_COLUMN_START", type: "number", nullable: true })
  from_column_start?: number;

  @Column({ name: "FROM_COLUMN_END", type: "number", nullable: true })
  from_column_end?: number;

  @Column({ name: "TO_COLUMN_START", type: "number", nullable: true })
  to_column_start?: number;

  @Column({ name: "TO_COLUMN_END", type: "number", nullable: true })
  to_column_end?: number;

  @Column({ name: "FROM_HEIGHT_START", type: "number", nullable: true })
  from_height_start?: number;

  @Column({ name: "FROM_HEIGHT_END", type: "number", nullable: true })
  from_height_end?: number;

  @Column({ name: "TO_HEIGHT_START", type: "number", nullable: true })
  to_height_start?: number;

  @Column({ name: "TO_HEIGHT_END", type: "number", nullable: true })
  to_height_end?: number;

  @Column({ name: "FROM_AISLE_START", type: "varchar2", length: 5, nullable: true })
  from_aisle_start?: string;

  @Column({ name: "FROM_AISLE_END", type: "varchar2", length: 5, nullable: true })
  from_aisle_end?: string;

  @Column({ name: "TO_AISLE_START", type: "varchar2", length: 5, nullable: true })
  to_aisle_start?: string;

  @Column({ name: "TO_AISLE_END", type: "varchar2", length: 5, nullable: true })
  to_aisle_end?: string;

  @Column({ name: "LOT_NO", type: "varchar2", length: 20, nullable: true })
  lot_no?: string;

  @Column({ name: "MFG_DATE", type: "date", nullable: true })
  mfg_date?: Date;

  @Column({ name: "EXP_DATE", type: "date", nullable: true })
  exp_date?: Date;

  @Column({ name: "USER_ID", type: "varchar2", length: 10, nullable: true, default: "USER" })
  user_id?: string;

  @Column({ name: "USER_DT", type: "date", nullable: true, default: () => "SYSDATE" })
  user_dt?: Date;

  @Column({ name: "QTY_PUOM", type: "number", precision: 12, scale: 1, nullable: true })
  qty_puom?: number;

  @Column({ name: "QTY_LUOM", type: "number", precision: 12, scale: 1, nullable: true })
  qty_luom?: number;

  @Column({ name: "P_UOM", type: "varchar2", length: 5, nullable: true })
  p_uom?: string;

  @Column({ name: "ALLOCATED", type: "varchar2", length: 1, nullable: true, default: "'N'" })
  allocated?: string;

  @Column({ name: "CONFIRMED", type: "varchar2", length: 1, nullable: true, default: "'N'" })
  confirmed?: string;

  @Column({ name: "ALLOCATED_DATE", type: "date", nullable: true })
  allocated_date?: Date;

  @Column({ name: "CONFIRMED_DATE", type: "date", nullable: true })
  confirmed_date?: Date;

  @Column({ name: "MIXED_PUTAWAY", type: "varchar2", length: 1, nullable: true, default: "'N'" })
  mixed_putaway?: string;

  @Column({ name: "L_UOM", type: "varchar2", length: 5, nullable: true })
  l_uom?: string;

  @Column({ name: "QUANTITY", type: "number", precision: 12, scale: 1, nullable: true })
  quantity?: number;

  @Column({ name: "KEY_NUMBER", type: "varchar2", length: 15, nullable: true })
  key_number?: string;

  @Column({ name: "SELECTED", type: "varchar2", length: 1, nullable: true, default: "'N'" })
  selected?: string;

  @Column({ name: "PROCESSED", type: "varchar2", length: 1, nullable: true, default: "'N'" })
  processed?: string;

  @Column({ name: "RECEIPT_TYPE", type: "varchar2", length: 1, nullable: true, default: "'N'" })
  receipt_type?: string;

  @Column({ name: "EXP_DATE_TO", type: "date", nullable: true })
  exp_date_to?: Date;

    @Column({ name: "MFG_DATE_TO", type: "date", nullable: true })
  mfg_date_to?: Date;

      @Column({ name: "EXP_DATE_FROM", type: "date", nullable: true })
  exp_date_from?: Date;

    @Column({ name: "MFG_DATE_FROM", type: "date", nullable: true })
  mfg_date_from?: Date

  @Column({ name: "LOT_NO_TO", type: "varchar2", length: 20, nullable: true })
  lot_no_to?: string;

  @Column({ name: "BATCH_NO_FROM", type: "varchar2", length: 20, nullable: true })
  batch_no_from?: string;

  @Column({ name: "BATCH_NO_TO", type: "varchar2", length: 20, nullable: true })
  batch_no_to?: string;

  @Column({ name: "COUNT_NO", type: "varchar2", length: 10, nullable: true })
  count_no?: string;

  @Column({ name: "PALLET_ID", type: "varchar2", length: 20, nullable: true })
  pallet_id?: string;

  @Column({ name: "MULTI_SERIES", type: "char", length: 1, nullable: true, default: "'N'" })
  multi_series?: string;

  @Column({ name: "CARTON_NO_FROM", type: "varchar2", length: 20, nullable: true })
  carton_no_from?: string;

  @Column({ name: "CARTON_NO_TO", type: "varchar2", length: 20, nullable: true })
  carton_no_to?: string;

  @Column({ name: "PALLET_ID_FROM", type: "varchar2", length: 20, nullable: true })
  pallet_id_from?: string;

  @Column({ name: "PALLET_ID_TO", type: "varchar2", length: 20, nullable: true })
  pallet_id_to?: string;
}
