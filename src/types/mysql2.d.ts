declare module "mysql2" {
  export interface RowDataPacket { [column: string]: any }
  const mysql: any;
  export default mysql;
}
