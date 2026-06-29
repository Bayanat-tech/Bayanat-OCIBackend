import { Entity, Column, PrimaryColumn } from "typeorm";

@Entity({ name: "TI_PACKDET" })
export class PackingDetailsInboundWms {

  @PrimaryColumn({ type: "varchar2", length: 7, name: "COMPANY_CODE" })
  company_code: string;

  @PrimaryColumn({ type: "varchar2", length: 5, name: "PRIN_CODE" })
  prin_code: string;

  @PrimaryColumn({ type: "varchar2", length: 10, name: "JOB_NO" })
  job_no: string;

  @PrimaryColumn({ type: "number", name: "PACKDET_NO" })
  packdet_no: number;

  @Column({ type: "varchar2", length: 40, name: "PROD_CODE" })
  prod_code: string;

  @Column({ type: "number", precision: 12, scale: 1, name: "QTY_PUOM" })
  qty_puom: number;

  @Column({ type: "varchar2", length: 5, name: "P_UOM" })
  p_uom: string;

  @Column({ type: "number", precision: 12, scale: 1, name: "QTY_LUOM" })
  qty_luom: number;

  @Column({ type: "varchar2", length: 5, name: "L_UOM" })
  l_uom: string;

  @Column({ type: "number", precision: 12, scale: 1, name: "QUANTITY" })
  quantity: number;

  @Column({ type: "date", name: "MFG_DATE" })
  mfg_date: Date;

  @Column({ type: "date", name: "EXP_DATE" })
  exp_date: Date;

  @Column({ type: "varchar2", length: 20, nullable: true, name: "LOT_NO" })
  lot_no?: string;

  @Column({ type: "varchar2", length: 20, nullable: true, name: "PO_NO" })
  po_no?: string;

  @Column({ type: "varchar2", length: 20, nullable: true, name: "BL_NO" })
  bl_no?: string;

  @Column({ type: "varchar2", length: 20, nullable: true, name: "VESSEL_NAME" })
  vessel_name?: string;

  @Column({ type: "varchar2", length: 20, nullable: true, name: "VOYAGE_NO" })
  voyage_no?: string;

  @Column({ type: "varchar2", length: 20, nullable: true, name: "CONTAINER_NO" })
  container_no?: string;

  @Column({ type: "number", precision: 18, scale: 2, nullable: true, name: "INVOICE_VALUE" })
  invoice_value?: number;

  @Column({ type: "varchar2", length: 3, nullable: true, name: "CURR_CODE" })
  curr_code?: string;

  @Column({ type: "number", precision: 15, scale: 5, nullable: true, name: "EX_RATE" })
  ex_rate?: number;

  @Column({ type: "varchar2", length: 20, nullable: true, name: "DOC_REF" })
  doc_ref?: string;

  @Column({ type: "varchar2", length: 10, nullable: true, name: "MANU_CODE" })
  manu_code?: string;

  @Column({ type: "varchar2", length: 5, nullable: true, name: "FROM_SITE" })
  from_site?: string;

  @Column({ type: "varchar2", length: 5, nullable: true, name: "TO_SITE" })
  to_site?: string;

  @Column({ type: "varchar2", length: 5, nullable: true, name: "FROM_AISLE" })
  from_aisle?: string;

  @Column({ type: "varchar2", length: 5, nullable: true, name: "TO_AISLE" })
  to_aisle?: string;

  @Column({ type: "number", nullable: true, name: "FROM_COLUMN" })
  from_column?: number;

  @Column({ type: "number", nullable: true, name: "TO_COLUMN" })
  to_column?: number;

  @Column({ type: "number", nullable: true, name: "FROM_HEIGHT" })
  from_height?: number;

  @Column({ type: "number", nullable: true, name: "TO_HEIGHT" })
  to_height?: number;

  @Column({ type: "varchar2", length: 1, nullable: true, name: "SELECTED" })
  selected?: string;

  @Column({ type: "varchar2", length: 1, nullable: true, name: "RECEIPT_TYPE" })
  receipt_type?: string;

  @Column({ type: "varchar2", length: 1, nullable: true, name: "ALLOCATED" })
  allocated?: string;

  @Column({ type: "varchar2", length: 20, nullable: true, name: "PALLET_ID" })
  pallet_id?: string;

  @Column({ type: "varchar2", length: 20, nullable: true, name: "PALLET_SERIAL_NO" })
  pallet_serial_no?: string;

  @Column({ type: "varchar2", length: 1, nullable: true, name: "MIXED_PUTAWAY" })
  mixed_putaway?: string;

  @Column({ type: "varchar2", length: 10, nullable: true, name: "USER_ID" })
  user_id?: string;

  @Column({ type: "date", nullable: true, name: "USER_DT" })
  user_dt?: Date;

  @Column({ type: "varchar2", length: 15, nullable: true, name: "LOCATION_FROM" })
  location_from?: string;

  @Column({ type: "varchar2", length: 15, nullable: true, name: "LOCATION_TO" })
  location_to?: string;

  @Column({ type: "number", nullable: true, name: "UPPP" })
  uppp?: number;

  @Column({ type: "varchar2", length: 1, nullable: true, name: "CONFIRMED" })
  confirmed?: string;

  @Column({ type: "number", precision: 18, scale: 6, nullable: true, name: "UNIT_PRICE" })
  unit_price?: number;

  @Column({ type: "number", precision: 18, scale: 6, nullable: true, name: "APPORTIONATE_VALUE" })
  apportionate_value?: number;

  @Column({ type: "varchar2", length: 1, nullable: true, name: "MULTI_SERIES" })
  multi_series?: string;

  @Column({ type: "varchar2", length: 1, nullable: true, name: "CLEARANCE" })
  clearance?: string;

  @Column({ type: "date", nullable: true, name: "CLEARED_DATE" })
  cleared_date?: Date;

  @Column({ type: "varchar2", length: 10, nullable: true, name: "CLEARED_USER" })
  cleared_user?: string;

  @Column({ type: "varchar2", length: 200, nullable: true, name: "REJECT_REASON" })
  reject_reason?: string;

  @Column({ type: "number", nullable: true, name: "CONTAINER_SIZE" })
  container_size?: number;

  @Column({ type: "varchar2", length: 20, nullable: true, name: "CUST_CODE" })
  cust_code?: string;

  @Column({ type: "varchar2", length: 2, nullable: true, name: "MOC1" })
  moc1?: string;

  @Column({ type: "varchar2", length: 2, nullable: true, name: "MOC2" })
  moc2?: string;

  @Column({ type: "char", length: 1, nullable: true, name: "SIMULATE_FLAG" })
  simulate_flag?: string;

  @Column({ type: "number", precision: 22, scale: 0, nullable: true, name: "LENGTH" })
  length?: number;

  @Column({ type: "number", precision: 22, scale: 0, nullable: true, name: "BREADTH" })
  breadth?: number;

  @Column({ type: "number", precision: 22, scale: 0, nullable: true, name: "HEIGHT" })
  height?: number;

  @Column({ type: "number", precision: 22, scale: 0, nullable: true, name: "GROSS_WEIGHT" })
  gross_weight?: number;

  @Column({ type: "varchar2", length: 40, nullable: true, name: "NEW_PRODUCT" })
  new_product?: string;

  @Column({ type: "varchar2", length: 50, nullable: true, name: "PROD_NAME" })
  prod_name?: string;

  @Column({ type: "number", precision: 22, scale: 0, nullable: true, name: "VOLUME" })
  volume?: number;

  @Column({ type: "number", precision: 22, scale: 0, nullable: true, name: "NEW_WEIGHT" })
  new_weight?: number;

  @Column({ type: "varchar2", length: 15, nullable: true, name: "ORIGIN_COUNTRY" })
  origin_country?: string;

  @Column({ type: "number", nullable: true, name: "SHELF_LIFE_DAYS" })
  shelf_life_days?: number;

  @Column({ type: "date", nullable: true, name: "SHELF_LIFE_DATE" })
  shelf_life_date?: Date;

  @Column({ type: "number", precision: 12, scale: 1, nullable: true, name: "PDA_QTY1" })
  pda_qty1?: number;

  @Column({ type: "number", precision: 12, scale: 1, nullable: true, name: "PDA_QTY2" })
  pda_qty2?: number;

  @Column({ type: "number", precision: 12, scale: 1, nullable: true, name: "PDA_QUANTITY" })
  pda_quantity?: number;

  @Column({ type: "number", precision: 12, scale: 1, nullable: true, name: "QTY1_ARRIVED" })
  qty1_arrived?: number;

  @Column({ type: "number", precision: 12, scale: 1, nullable: true, name: "QTY2_ARRIVED" })
  qty2_arrived?: number;

  @Column({ type: "number", precision: 12, scale: 1, nullable: true, name: "QUANTITY_ARRIVED" })
  quantity_arrived?: number;

  @Column({ type: "varchar2", length: 50, nullable: true, name: "PROD_ATTRIB_CODE" })
  prod_attrib_code?: string;

  @Column({ type: "varchar2", length: 20, nullable: true, name: "PROD_GRADE1" })
  prod_grade1?: string;

  @Column({ type: "varchar2", length: 20, nullable: true, name: "PROD_GRADE2" })
  prod_grade2?: string;

  @Column({ type: "varchar2", length: 30, nullable: true, name: "TX_IDENTITY_NUMBER" })
  tx_identity_number?: string;

  @Column({ type: "number", precision: 22, scale: 0, nullable: true, name: "NET_WEIGHT" })
  net_weight?: number;

  @Column({ type: "varchar2", length: 10, nullable: true, name: "SUPP_CODE" })
  supp_code?: string;

  @Column({ type: "varchar2", length: 10, nullable: true, name: "ASSIGNED_PUTAWAY_USER" })
  assigned_putaway_user?: string;

  @Column({ type: "varchar2", length: 10, nullable: true, name: "ASSIGNED_TALLY_USER" })
  assigned_tally_user?: string;

  @Column({ type: "varchar2", length: 15, nullable: true, name: "PRV_LOCATION_CODE" })
  prv_location_code?: string;

  @Column({ type: "date", nullable: true, name: "TALLY_DT" })
  tally_dt?: Date;

  @Column({ type: "varchar2", length: 20, nullable: true, name: "BE_DOC_NO" })
  be_doc_no?: string;

  @Column({ type: "number", precision: 18, scale: 0, nullable: true, name: "MASTER_CTN" })
  master_ctn?: number;

  @Column({ type: "number", precision: 18, scale: 0, nullable: true, name: "LOOSE_CTN" })
  loose_ctn?: number;

  @Column({ type: "number", precision: 18, scale: 4, nullable: true, name: "NET_PRICE" })
  net_price?: number;

  @Column({ type: "number", precision: 18, scale: 6, nullable: true, name: "SUPP_EX_RATE" })
  supp_ex_rate?: number;

  @Column({ type: "number", precision: 18, scale: 6, nullable: true, name: "LOCAL_CHARGES_VALUE" })
  local_charges_value?: number;

  @Column({ type: "number", precision: 18, scale: 6, nullable: true, name: "PO_EX_RATE" })
  po_ex_rate?: number;

  @Column({ type: "number", precision: 18, scale: 6, nullable: true, name: "LC_PO_VALUE" })
  lc_po_value?: number;

  @Column({ type: "varchar2", length: 10, nullable: true, name: "PO_CURR_CODE" })
  po_curr_code?: string;

  @Column({ type: "number", precision: 18, scale: 6, nullable: true, name: "PO_VALUE" })
  po_value?: number;

  @Column({ type: "number", precision: 18, scale: 6, nullable: true, name: "NET_VOLUME" })
  net_volume?: number;

  @Column({ type: "varchar2", length: 20, nullable: true, name: "HS_CODE" })
  hs_code?: string;

  @Column({ type: "number", precision: 18, scale: 6, nullable: true, name: "GROSS_WT" })
  gross_wt?: number;

  @Column({ type: "varchar2", length: 20, nullable: true, name: "CONFIRM_USER" })
  confirm_user?: string;

  @Column({ type: "date", nullable: true, name: "CONFIRM_DT" })
  confirm_dt?: Date;

  @Column({ type: "varchar2", length: 20, nullable: true, name: "BATCH_NO" })
  batch_no?: string;
}