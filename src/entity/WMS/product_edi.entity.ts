import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity({ name: 'MS_PRODUCT_EDI', schema: 'WMSTST' })
export class ProductEDI {

    @PrimaryColumn({ name: 'PROD_CODE', type: 'varchar', length: 40 })
    prod_code: string;
    
    @Column({ name: 'COMPANY_CODE', type: 'varchar', length: 5, nullable: false })
    company_code: string;

    @Column({ name: 'PRIN_CODE', type: 'varchar', length: 5 })
    prin_code: string;

    @Column({ name: 'PROD_NAME', type: 'varchar', length: 250 })
    prod_name: string;

    @Column({ name: 'GROUP_CODE', type: 'varchar', length: 50, nullable: true })
    group_code?: string;

    @Column({ name: 'BRAND_CODE', type: 'varchar', length: 50, nullable: true })
    brand_code?: string;

    @Column({ name: 'PACKDESC', type: 'varchar', length: 50, nullable: true })
    packdesc?: string;

    @Column({ name: 'BARCODE', type: 'varchar', length: 40, nullable: true })
    barcode?: string;

    @Column({ name: 'P_UOM', type: 'varchar', length: 5 })
    p_uom: string;

    @Column({ name: 'SUOM', type: 'varchar', length: 5, nullable: true })
    suom?: string;

    @Column({ name: 'LENGTH', type: 'decimal', precision: 12, scale: 6, nullable: true })
    length?: number;

    @Column({ name: 'BREADTH', type: 'decimal', precision: 12, scale: 6, nullable: true })
    breadth?: number;

    @Column({ name: 'HEIGHT', type: 'decimal', precision: 12, scale: 6, nullable: true })
    height?: number;

    @Column({ name: 'VOLUME', type: 'decimal', precision: 12, scale: 6 })
    volume: number;

    @Column({ name: 'GROSS_WT', type: 'decimal', precision: 12, scale: 6, nullable: true })
    gross_wt?: number;

    @Column({ name: 'NET_WT', type: 'decimal', precision: 12, scale: 6, nullable: true })
    net_wt?: number;

    @Column({ name: 'FOC', type: 'varchar', length: 20, nullable: true })
    foc?: string;

    @Column({ name: 'CPU', type: 'decimal', precision: 10, scale: 4, nullable: true })
    cpu?: number;

    @Column({ name: 'HARM_CODE', type: 'varchar', length: 20, nullable: true })
    harm_code?: string;

    @Column({ name: 'IMCO_CODE', type: 'varchar', length: 20, nullable: true })
    imco_code?: string;

    @Column({ name: 'KITTING', type: 'varchar', length: 1, nullable: true })
    kitting?: string;

    @Column({ name: 'MANU_CODE', type: 'varchar', length: 30, nullable: true })
    manu_code?: string;

    @Column({ name: 'BASE_PRICE', type: 'decimal', precision: 16, scale: 6, nullable: true })
    base_price?: number;

    @Column({ name: 'FLAT_STORAGE', type: 'decimal', precision: 10, scale: 4, nullable: true })
    flat_storage?: number;

    @Column({ name: 'SITE_TYPE', type: 'varchar', length: 5, nullable: true })
    site_type?: string;

    @Column({ name: 'SITE_IND', type: 'varchar', length: 5, nullable: true })
    site_ind?: string;

    @Column({ name: 'PACK_KEY', type: 'varchar', length: 40, nullable: true })
    pack_key?: string;

    @Column({ name: 'PROD_TI', type: 'int', nullable: true })
    prod_ti?: number;

    @Column({ name: 'PROD_HI', type: 'int', nullable: true })
    prod_hi?: number;

    @Column({ name: 'CHARGETIME', type: 'varchar', length: 5, nullable: true })
    chargetime?: string;

    @Column({ name: 'PROD_STATUS', type: 'varchar', length: 2, nullable: true })
    prod_status?: string;

    @Column({ name: 'SHELF_LIFE', type: 'int', nullable: true })
    shelf_life?: number;

    @Column({ name: 'CATEGORY_ABC', type: 'varchar', length: 2, nullable: true })
    category_abc?: string;

    @Column({ name: 'REORD_LEVEL', type: 'int', nullable: true })
    reord_level?: number;

    @Column({ name: 'REORD_QTY', type: 'decimal', precision: 12, scale: 1, nullable: true })
    reord_qty?: number;

    @Column({ name: 'ALT_PROD_CODE', type: 'varchar', length: 40, nullable: true })
    alt_prod_code?: string;

    @Column({ name: 'L_UOM', type: 'varchar', length: 5 })
    l_uom: string;  

    @Column({ name: 'UPPP', type: 'int' })
    uppp: number;

    @Column({ name: 'UPP', type: 'int' })
    upp: number;

    @Column({ name: 'UOM_COUNT', type: 'int' })
    uom_count: number;

    @Column({ name: 'ERROR_MESSAGE', type: 'varchar', length: 2000, nullable: true })
    error_message?: string | null;

    @Column({ name: 'UPDATED_AT', type: 'date', nullable: true })
    updated_at?: Date;

    @Column({ name: 'UPDATED_BY', type: 'varchar', length: 50, nullable: true })
    updated_by?: string;

    @Column({ name: 'CREATED_BY', type: 'varchar', length: 20, nullable: true })
    created_by?: string;

    @Column({ name: 'CREATED_AT', type: 'date', nullable: true })
    created_at?: Date;
}
