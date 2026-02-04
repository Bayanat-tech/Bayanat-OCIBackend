/**
 * Sequelize Type Declarations (Shim)
 * 
 * Legacy support for Sequelize model files.
 * Sequelize is no longer used at runtime.
 * This module provides minimal type stubs to satisfy TypeScript compilation
 * for existing model files that are being phased out.
 */

declare module "sequelize" {
  export class Model<TModelAttributes = any, TCreationAttributes = TModelAttributes> {
    static init(config: any, options: any): any;
    static removeAttribute(name: string): void;
    static belongsTo(target: any, options?: any): void;
    static hasMany(target: any, options?: any): void;
    static hasOne(target: any, options?: any): void;
    static findOne(options: any): Promise<any>;
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
  
  export const Sequelize: any;

  export const DataTypes: {
    STRING(length?: number): any;
    INTEGER: any;
    FLOAT: any;
    DOUBLE: any;
    DECIMAL(precision?: number, scale?: number): any;
    DATE: any;
    BOOLEAN: any;
    BLOB: any;
    JSON: any;
    JSONB: any;
    UUID: any;
    UUIDV4: any;
    UUIDV1: any;
    NOW: any;
    ENUM(...values: string[]): any;
    TEXT: any;
    BIGINT: any;
    SMALLINT: any;
    TINYINT: any;
    [key: string]: any;
  };

  export const Op: {
    eq: symbol;
    ne: symbol;
    gte: symbol;
    gt: symbol;
    lte: symbol;
    lt: symbol;
    like: symbol;
    between: symbol;
    in: symbol;
    notIn: symbol;
    and: symbol;
    or: symbol;
    [key: string]: symbol;
  };

  export const QueryTypes: {
    SELECT: string;
    INSERT: string;
    UPDATE: string;
    DELETE: string;
    DESCRIBE: string;
    RAW: string;
  };

  export const fn: (fnName: string, ...args: any[]) => any;
  export const col: (colName: string) => any;
  export const literal: (val: string) => any;
  export const where: (attr: any, op: any, val: any) => any;

  export default class Sequelize {
    constructor(options: any);
    authenticate(): Promise<void>;
    close(): Promise<void>;
    define(name: string, attributes: any, options?: any): any;
    query(sql: string, options?: any): Promise<any>;
    sync(options?: any): Promise<void>;
    transaction(callback: (t: any) => Promise<any>): Promise<any>;
  }
}
