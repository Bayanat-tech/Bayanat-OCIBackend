import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import constants from "../../helpers/constants";
 
@Entity({ name: constants.TABLE.MS_ACTIVITY })
export class Activity {
  @PrimaryColumn({ name: "ACTIVITY_CODE", length: 15 })
  activityCode: string;
 
  @Column({ name: "ACTIVITY", length: 100 })
  activity: string;
 
  @Column({ name: "WIP_CODE", length: 10 })
  wipCode: string;
 
  @Column({ name: "INCOME_CODE", length: 10 })
  incomeCode: string;
 
  @Column("decimal", {
    name: "COST",
    precision: 15,
    scale: 2,
  })
  cost: number;
 
  @Column("decimal", {
    name: "BILL",
    precision: 15,
    scale: 2,
  })
  bill: number;
 
  @Column({ name: "COMPANY_CODE", length: 10 })
  companyCode: string;
 
  @Column({ name: "ACTIVITY_GROUP_CODE", length: 10 })
  activityGroupCode: string;
 
  @Column({ name: "ACTIVITY_SUBGROUP_CODE", length: 10 })
  activitySubgroupCode: string;
 
  @Column({ name: "START_POINT", length: 50, nullable: true })
  startPoint: string;
 
  @Column({ name: "END_POINT", length: 50, nullable: true })
  endPoint: string;
 
  @Column({ name: "VTYPE", length: 10, nullable: true })
  vtype: string;
 
  @Column({ name: "FREEZE_FLAG", length: 1 })
  freezeFlag: string;
 
  @Column("decimal", {
    name: "BUDGET_COST",
    precision: 15,
    scale: 2,
    nullable: true,
  })
  budgetCost: number;
 
  @Column({ name: "APPTN_HOUSE", length: 50, nullable: true })
  apptnHouse: string;
 
  @Column({ name: "APPTN_APP_ON", length: 20, nullable: true })
  apptnAppOn: string;
 
  @Column({ name: "EXP_SUB_TYPE", length: 10, nullable: true })
  expSubType: string;
 
  @Column({ name: "EXP_CODE", length: 10, nullable: true })
  expCode: string;
 
  @Column("decimal", {
    name: "TX_COMPNT_1_PERC",
    precision: 5,
    scale: 2,
    nullable: true,
  })
  txCompnt1Perc: number;
 
  @Column("decimal", {
    name: "TX_COMPNT_2_PERC",
    precision: 5,
    scale: 2,
    nullable: true,
  })
  txCompnt2Perc: number;
 
  @Column("decimal", {
    name: "TX_COMPNT_3_PERC",
    precision: 5,
    scale: 2,
    nullable: true,
  })
  txCompnt3Perc: number;
 
  @Column("decimal", {
    name: "TX_COMPNT_4_PERC",
    precision: 5,
    scale: 2,
    nullable: true,
  })
  txCompnt4Perc: number;
 
  @Column({ name: "TX_COMPNT_1_EXPMT", length: 50, nullable: true })
  txCompnt1Expmt: string;
 
  @Column({ name: "TX_COMPNT_2_EXPMT", length: 50, nullable: true })
  txCompnt2Expmt: string;
 
  @Column({ name: "TX_COMPNT_3_EXPMT", length: 50, nullable: true })
  txCompnt3Expmt: string;
 
  @Column({ name: "TX_COMPNT_4_EXPMT", length: 50, nullable: true })
  txCompnt4Expmt: string;
 
//   @Column({ name: "UPDATED_BY", length: 50 })
//   updatedBy: string;
 
//   @Column({ name: "CREATED_BY", length: 50 })
//   createdBy: string;
 
//   @CreateDateColumn({ name: "CREATED_AT", type: "timestamp" })
//   createdAt: Date;
 
//   @UpdateDateColumn({ name: "UPDATED_AT", type: "timestamp" })
//   updatedAt: Date;
}
 