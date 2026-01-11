import { Entity, PrimaryColumn, Column } from "typeorm";
import constants from "../../helpers/constants";

@Entity(constants.TABLE.MS_PRODTYPE)
export class ProducttypeMaster {
  @PrimaryColumn({
    name: "PRODTYPE_CODE",
    type: "float",
  })
  prodtype_code!: number;

  @Column({
    name: "PRODTYPE_DESC",
    type: "varchar2",
    length: 30,
  })
  prodtype_desc!: string;

  @Column({
    name: "COMPANY_CODE",
    type: "varchar2",
    length: 5,
    nullable: true,
  })
  company_code?: string;

  // @Column({
  //   name: "CREATED_BY",
  //   type: "varchar2",
  //   length: 20,
  //   nullable: true,
  // })
  // created_by?: string;

  // @Column({
  //   name: "UPDATED_BY",
  //   type: "varchar2",
  //   length: 20,
  //   nullable: true,
  // })
  // updated_by?: string;

  // @Column({
  //   name: "CREATED_AT",
  //   type: "timestamp",
  //   default: () => "CURRENT_TIMESTAMP",
  //   nullable: true,
  // })
  // created_at?: Date;

  // @Column({
  //   name: "UPDATED_AT",
  //   type: "timestamp",
  //   default: () => "CURRENT_TIMESTAMP",
  //   onUpdate: "CURRENT_TIMESTAMP",
  //   nullable: true,
  // })
  // updated_at?: Date;
}
