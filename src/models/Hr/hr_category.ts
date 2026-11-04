import { Entity, PrimaryColumn, Column } from "typeorm";
import constants from "../../helpers/constants";
import { ICategorymaster } from "../../interfaces/Hr/hr_category_interface";

@Entity(constants.TABLE.MS_HR_CATEGORY)
export class Categorymaster implements ICategorymaster {
    updated_at?: Date | undefined;
    updated_by?: string | undefined;
    created_by: string;
    created_at: Date;
    @Column({ 
        name: "COMPANY_CODE", 
        type: "varchar2", 
        length: 20, 
        nullable: false 
    })
    company_code!: string;

    @PrimaryColumn({ 
        name: "CATEGORY_CODE", 
        type: "varchar2", 
        length: 20, 
        nullable: false 
    })
    category_code!: string;

    @Column({ 
        name: "CATEGORY_NAME", 
        type: "varchar2", 
        length: 50, 
        nullable: false 
    })
    category_name!: string;

    @Column({ 
        name: "CATEGORY_SHORT_NAME", 
        type: "varchar2", 
        length: 10, 
        nullable: true 
    })
    category_short_name!: string;

    @Column({ 
        name: "REMARKS", 
        type: "varchar2", 
        length: 100, 
        nullable: true 
    })
    remarks!: string;

    @Column({ 
        name: "STATUS", 
        type: "char", 
        length: 1, 
        nullable: false 
    })
    status!: string;

    // Matches USER_ID in database
    @Column({ 
        name: "USER_ID", 
        type: "varchar2", 
        length: 50, 
        nullable: true 
    })
    user_id!: string;

    // Matches USER_DT in database
    @Column({ 
        name: "USER_DT", 
        type: "timestamp",
        nullable: true 
    })
    user_dt!: Date;
}