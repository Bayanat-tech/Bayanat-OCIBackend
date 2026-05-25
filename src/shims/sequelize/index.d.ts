export class Model<TModelAttributes = any, TCreationAttributes = TModelAttributes> {
  constructor(values?: Partial<TModelAttributes>);
  static init(config: any, options: any): any;
  static removeAttribute(name: string): void;
  static belongsTo(target: any, options?: any): void;
  static hasMany(target: any, options?: any): void;
  static hasOne(target: any, options?: any): void;
  static findOne(options?: any): Promise<any>;
  static findAll(options?: any): Promise<any[]>;
  static create(values: any): Promise<any>;
  static sync(options?: any): Promise<any>;
  static bulkCreate(records: any[], options?: any): Promise<any[]>;
  static update(values: any, options: any): Promise<[number]>;
  static destroy(options: any): Promise<number>;
  static count(options?: any): Promise<number>;
  static associations: any;
}

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type FindOptions<T = any> = any;

export const DECIMAL: any;
export const DecimalDataType: any;
export class Transaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export const DataTypes: Record<string, any>;
export const Op: Record<string, symbol>;
export const QueryTypes: Record<string, string>;
export const fn: (fnName: string, ...args: any[]) => any;
export const col: (colName: string) => any;
export const literal: (value: string) => any;
export const where: (attr: any, op: any, value: any) => any;

export default class Sequelize {
  constructor(options?: any);
  authenticate(): Promise<void>;
  close(): Promise<void>;
  define(name: string, attributes: any, options?: any): any;
  query(sql: string, options?: any): Promise<any>;
  sync(options?: any): Promise<void>;
  transaction(callback: (t: any) => Promise<any>): Promise<any>;
}

export { Sequelize };
