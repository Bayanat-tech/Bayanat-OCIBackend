export interface IStockAdjustment {
  JOB_NO: string;
  PROD_CODE?: string;
  QTY_PUOM?: number;
  QTY_LUOM?: number;
  ADJ_TYPE?: string;
  COMPANY_CODE: string;
  CREATED_BY?: string;
  UPDATED_BY?: string;
  CREATED_AT?: Date;
  UPDATED_AT?: Date;
}

export interface ICreateStockAdjustmentRequest {
  JOB_NO: string;
  PROD_CODE?: string;
  QTY_PUOM?: number;
  QTY_LUOM?: number;
  ADJ_TYPE?: string;
}
