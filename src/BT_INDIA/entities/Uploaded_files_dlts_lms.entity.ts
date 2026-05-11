import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity("UPLOADED_FILES_DLTS_LMS")
export class BT_Uploadfilesdltslms{

    @Column({name:"REQUEST_NUMBER",type:"varchar", length:25})
    REQUEST_NUMBER?: string;

    @Column({name:"SR_NO",type:"decimal",nullable: true ,length:10 , scale : 0})
    SR_NO?: number;

    @Column({name:"ORG_FILE_NAME",type:"varchar",nullable: true ,length : 400})
    ORG_FILE_NAME?: string;

    @Column({name:"AWS_FILE_LOCN",type:"varchar",nullable: true , length : 500})
    AWS_FILE_LOCN?: string;

    @Column({name:"EXTENSIONS",type:"varchar",nullable: true , length : 5})
    EXTENSIONS?: string;

    @Column({name:"USER_FILE_NAME",type:"varchar", nullable: true , length : 75})
    USER_FILE_NAME?: string;
};
