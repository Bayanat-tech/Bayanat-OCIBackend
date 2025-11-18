import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from "typeorm";
import constants from "../../helpers/constants";
import { IPrincipalContactDetlWMs } from "../../interfaces/wms/principal_wms.interface";

@Entity({ name: constants.TABLE.MS_PRINCIPAL_CONTACT_DETL })
export class PrincipalContactDetl implements IPrincipalContactDetlWMs {
  @PrimaryColumn({ type: "varchar", length: 5 })
  prin_code: string;

  @PrimaryColumn({ type: "varchar", length: 7 })
  company_code: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  prin_cont1!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  prin_cont2!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  prin_cont3!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  prin_cont_telno1!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  prin_cont_telno2!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  prin_cont_telno3!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  prin_cont_email1!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  prin_cont_email2!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  prin_cont_email3!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  prin_cont_faxno1!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  prin_cont_faxno2!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  prin_cont_faxno3!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  prin_cont_ref1!: string;

  @Column({ type: "varchar", length: 50 })
  updated_by: string;

  @Column({ type: "varchar", length: 20 })
  created_by: string;

  @CreateDateColumn({ name: "created_at" })
  created_at: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updated_at: Date;
}
