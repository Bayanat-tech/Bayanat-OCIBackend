import { Entity, Column,PrimaryColumn } from "typeorm";
import constants from "../../helpers/constants";
 
@Entity(constants.TABLE.MS_ACTIVITY_BILLING)
export class BillingActivity {
    @PrimaryColumn({ name: "PRIN_CODE", type: "varchar2", length: 15 })
    prin_code!: string;
 
    @Column({ name: "ACT_CODE", type: "varchar2", length: 15 })
    act_code!: string;
 
    @Column({ name: "WIP_CODE", type: "varchar2", length: 15 })
    wip_code!: string;
 
    @Column({ name: "JOBTYPE", type: "varchar2", length: 10 })
    jobtype!: string;
 
    @Column({ name: "COST", type: "decimal", precision: 15, scale: 3 })
    cost!: number;
 
    @Column({ name: "COMPANY_CODE", type: "varchar2", length: 10 })
    company_code!: string;
 
    @Column({ name: "BILL_AMOUNT", type: "decimal", precision: 15, scale: 3 })
    bill_amount?: number;
 
    @Column({ name: "USER_DT", type: "date" })
    user_dt!: Date;
 
    @Column({ name: "INCOME_CODE", type: "varchar2", length: 10 })
    income_code!: string;
 
    @Column({ name: "UOC", type: "varchar2", length: 10 })
    uoc!: string;
 
    @Column({ name: "MOC", type: "number" })
    moc!: number;
 
    @Column({ name: "MOC1", type: "varchar2", length: 50 })
    moc1!: string;
 
    @Column({ name: "MOC2", type: "varchar2", length: 50 })
    moc2!: string;
 
    @Column({ name: "CUST_CODE", type: "varchar2", length: 15 })
    cust_code!: string;
 
    @Column({ name: "FREEZE_FLAG", type: "varchar2", length: 1 })
    freeze_flag!: string;
 
    @Column({ name: "MANDATORY_FLAG", type: "varchar2", length: 1 })
    mandatory_flag!: string;
 
    @Column({ name: "UPDATED_BY", type: "varchar2", length: 50 })
    updated_by!: string;
 
    @Column({ name: "USER_ID", type: "varchar2", length: 50 })
    user_id!: string;
 
//    @Column({ name: "CREATED_BY", type: "varchar2", length: 50 })
//    created_by!: string;
 
//    @Column({
//     name: "CREATED_AT",
//     type: "timestamp",
//     default: () => "CURRENT_TIMESTAMP",
//    })
//    created_at!: Date;
 
   @Column({
    name: "UPDATED_AT",
    type: "timestamp",
    default: () => "CURRENT_TIMESTAMP",
   })
   updated_at!: Date;
}