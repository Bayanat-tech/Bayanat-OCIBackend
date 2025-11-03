import { Entity, PrimaryColumn, Column, OneToMany, ManyToMany, JoinTable } from "typeorm";
import constants from "../../helpers/constants";
import { AccessSecOperation } from "./accesssecoperation.entity";
import { SecLogin } from "./seclogin.entity";

@Entity(constants.TABLE.SEC_MODULE_DATA)
export class AccessSecModuleData {
  @PrimaryColumn({ name: "SERIAL_NO", type: "number" })
  serial_no!: number;

  @Column({ name: "APP_CODE", type: "varchar2", length: 10 })
  app_code!: string;

  @Column({ name: "LEVEL3", type: "varchar2", length: 30 })
  level3!: string;

  @Column({ name: "COMPANY_CODE", type: "varchar2", length: 10 })
  company_code!: string;

  // One-to-Many relationship with AccessSecOperation
  @OneToMany(() => AccessSecOperation, (operation) => operation.module)
  operations!: AccessSecOperation[];
  
  @ManyToMany(() => SecLogin, (user) => user.assignedModules)
  @JoinTable({ 
    name: constants.TABLE.SEC_ROLE_FUNCTION_ACCESS_USER,
    joinColumn: {
      name: "SERIAL_NO_OR_ROLE_ID",
      referencedColumnName: "serial_no",
    },
    inverseJoinColumn: {
      name: "LOGINID",
      referencedColumnName: "user_id",
    }

    })
  assignedUsers!: SecLogin[];
}
