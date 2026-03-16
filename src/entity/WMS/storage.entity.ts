import {
  Entity,
  Column,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  CreateDateColumn
} from 'typeorm';

@Entity({ name: 'MNTSTORAGE_HDR' })
export class MntStorageHdr {
  @PrimaryColumn({ name: 'PRIN_CODE', type: 'varchar2', length: 5 })
  prin_code: string;

  @PrimaryGeneratedColumn({ name: 'MNTHSTORAGENO', type: 'number' })
  mnthstorageno: number;

  @Column({ name: 'STORAGEMONTH', type: 'float' })
  storagemonth: number;

  @Column({ name: 'INVSTARTDATE', type: 'date' })
  invstartdate: Date;

  @Column({ name: 'INVENDDATE', type: 'date' })
  invenddate: Date;

  @Column({ name: 'USERNAME', type: 'varchar2', length: 10, nullable: true })
  username: string;

  @Column({ name: 'USERDATE', type: 'date', nullable: true })
  userdate: Date;

  @Column({ name: 'CHARGETYPE', type: 'varchar2', length: 9, nullable: true })
  chargetype: string;

  @Column({ name: 'NODAYS', type: 'float', nullable: true })
  nodays: number;

  @Column({ name: 'COMPANY_CODE', type: 'varchar2', length: 5, nullable: true })
  company_code: string;
}