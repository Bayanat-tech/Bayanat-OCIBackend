import { Entity, PrimaryColumn, Column, ManyToMany } from "typeorm";
import constants from "../../helpers/constants";
import { SecLoginRoleAccess } from "./seclogin-roleaccess.entity";

@Entity(constants.TABLE.MS_PS_ROLE)
export class MsRole {
  // map frontend's "user_role" property to actual column ROLE_CODE
  @PrimaryColumn({ name: "ROLE_CODE", type: "varchar2", length: 50 })
  user_role!: string;

  @Column({ name: "ROLE_NAME", type: "varchar2", length: 100, nullable: true })
  role_name!: string;

  @Column({ name: "COMPANY_CODE", type: "varchar2", length: 10, nullable: true })
  company_code!: string;

  @ManyToMany(() => SecLoginRoleAccess, (user) => user.assignedRoles)
  assignedUsers!: SecLoginRoleAccess[];
}
