import { Entity, Column, PrimaryColumn, UpdateDateColumn, CreateDateColumn } from 'typeorm';

@Entity('MS_PRODUCT')
export class Product {
    @Column({ name: 'PRIN_CODE', type: 'varchar', length: 5, nullable: false })
    prin_code: string;

    @PrimaryColumn({ name: 'PROD_CODE', type: 'varchar', length: 40, nullable: false })
    prod_code: string;

    @Column({ name: 'PROD_NAME', type: 'varchar', length: 250, nullable: false })
    prod_name: string;

    @Column({ name: 'GROUP_CODE', type: 'varchar', length: 50, nullable: true })
    group_code: string;

    @Column({ name: 'BRAND_CODE', type: 'varchar', length: 50, nullable: true })
    brand_code: string;

    @Column({ name: 'PACKDESC', type: 'varchar', length: 50, nullable: true })
    packdesc: string;

    @Column({ name: 'BARCODE', type: 'varchar', length: 40, nullable: true })
    barcode: string;

    @Column({ name: 'P_UOM', type: 'varchar', length: 10, nullable: false })
    p_uom: string;

    @Column({ name: 'SUOM', type: 'varchar', length: 5, nullable: true })
    suom: string;

    @Column({ name: 'LENGTH', type: 'decimal', precision: 12, scale: 6, nullable: true })
    length: number;

    @Column({ name: 'BREADTH', type: 'decimal', precision: 12, scale: 6, nullable: true })
    breadth: number;

    @Column({ name: 'HEIGHT', type: 'decimal', precision: 12, scale: 6, nullable: true })
    height: number;

    @Column({ name: 'VOLUME', type: 'decimal', precision: 12, scale: 6, nullable: false })
    volume: number;

    @Column({ name: 'GROSS_WT', type: 'decimal', precision: 12, scale: 6, nullable: true })
    gross_wt: number;

    @Column({ name: 'NET_WT', type: 'decimal', precision: 12, scale: 6, nullable: true })
    net_wt: number;

    @Column({ name: 'FOC', type: 'varchar', length: 20, nullable: true })
    foc: string;

    @Column({ name: 'CPU', type: 'decimal', precision: 10, scale: 4, nullable: true })
    cpu: number;

    @Column({ name: 'HARM_CODE', type: 'varchar', length: 20, nullable: true })
    harm_code: string;

    @Column({ name: 'IMCO_CODE', type: 'varchar', length: 20, nullable: true })
    imco_code: string;

    @Column({ name: 'KITTING', type: 'varchar', length: 1, nullable: true })
    kitting: string;

    @Column({ name: 'MANU_CODE', type: 'varchar', length: 10, nullable: true })
    manu_code: string;

    @Column({ name: 'BASE_PRICE', type: 'decimal', precision: 16, scale: 6, nullable: true })
    base_price: number;

    @Column({ name: 'FLAT_STORAGE', type: 'decimal', precision: 10, scale: 4, nullable: true })
    flat_storage: number;

    @Column({ name: 'SITE_TYPE', type: 'varchar', length: 5, nullable: true })
    site_type: string;

    @Column({ name: 'SITE_IND', type: 'varchar', length: 5, nullable: true })
    site_ind: string;

    @Column({ name: 'PACK_KEY', type: 'varchar', length: 40, nullable: true })
    pack_key: string;

    @Column({ name: 'PROD_TI', type: 'int', nullable: true })
    prod_ti: number;

    @Column({ name: 'PROD_HI', type: 'int', nullable: true })
    prod_hi: number;

    @Column({ name: 'CHARGETIME', type: 'varchar', length: 5, nullable: true })
    chargetime: string;

    @Column({ name: 'PROD_STATUS', type: 'varchar', length: 2, nullable: true })
    prod_status: string;

    @Column({ name: 'SHELF_LIFE', type: 'int', nullable: true })
    shelf_life: number;

    @Column({ name: 'CATEGORY_ABC', type: 'varchar', length: 2, nullable: true })
    category_abc: string;

    @Column({ name: 'REORD_LEVEL', type: 'int', nullable: true })
    reord_level: number;

    @Column({ name: 'REORD_QTY', type: 'decimal', precision: 12, scale: 1, nullable: true })
    reord_qty: number;

    @Column({ name: 'ALT_PROD_CODE', type: 'varchar', length: 40, nullable: true })
    alt_prod_code: string;

    @Column({ name: 'PREF_SITE', type: 'varchar', length: 5, nullable: true })
    pref_site: string;

    @Column({ name: 'PREF_LOC_FROM', type: 'varchar', length: 15, nullable: true })
    pref_loc_from: string;

    @Column({ name: 'PREF_LOC_TO', type: 'varchar', length: 15, nullable: true })
    pref_loc_to: string;

    @Column({ name: 'PREF_AISLE_FROM', type: 'varchar', length: 5, nullable: true })
    pref_aisle_from: string;

    @Column({ name: 'PREF_AISLE_TO', type: 'varchar', length: 5, nullable: true })
    pref_aisle_to: string;

    @Column({ name: 'PREF_COL_FROM', type: 'int', nullable: true })
    pref_col_from: number;

    @Column({ name: 'PREF_COL_TO', type: 'int', nullable: true })
    pref_col_to: number;

    @Column({ name: 'PREF_HT_FROM', type: 'int', nullable: true })
    pref_ht_from: number;

    @Column({ name: 'PREF_HT_TO', type: 'int', nullable: true })
    pref_ht_to: number;

    @Column({ name: 'UPPP', type: 'int', nullable: false })
    uppp: number;

    @Column({ name: 'CHK_MANUCODE', type: 'varchar', length: 1, nullable: true })
    chk_manucode: string;

    @Column({ name: 'CHK_LOTNO', type: 'varchar', length: 1, nullable: true })
    chk_lotno: string;

    @Column({ name: 'CHK_MFGEXPDT', type: 'varchar', length: 1, nullable: true })
    chk_mfgexpdt: string;

    @Column({ name: 'PUOM_VOLUME', type: 'decimal', precision: 12, scale: 6, nullable: true })
    puom_volume: number;

    @Column({ name: 'PUOM_NETWT', type: 'decimal', precision: 12, scale: 6, nullable: true })
    puom_netwt: number;

    @Column({ name: 'PUOM_GROSSWT', type: 'decimal', precision: 12, scale: 6, nullable: true })
    puom_grosswt: number;

    @Column({ name: 'L_UOM', type: 'varchar', length: 5, nullable: false })
    l_uom: string;

    @Column({ name: 'LUPPP', type: 'int', nullable: true })
    luppp: number;

    @Column({ name: 'UOM_COUNT', type: 'int', nullable: false })
    uom_count: number;

    @Column({ name: 'PROD_TYPE', type: 'int', nullable: true })
    prod_type: number;

    @Column({ name: 'COMPANY_CODE', type: 'varchar', length: 5, nullable: false })
    company_code: string;

    @Column({ name: 'TWOPLUS_UOM', type: 'varchar', length: 1, nullable: true })
    twoplus_uom: string;

    @Column({ name: 'UPP', type: 'int', nullable: true })
    upp: number;

    @Column({ name: 'WAVE_CODE', type: 'int', nullable: true })
    wave_code: number;

    @Column({ name: 'PRODUCT_STAGE', type: 'varchar', length: 1, nullable: true })
    product_stage: string;

    @Column({ name: 'CO_PACK', type: 'varchar', length: 1, nullable: true })
    co_pack: string;

    @Column({ name: 'MODEL_NUMBER', type: 'varchar', length: 50, nullable: true })
    model_number: string;

    @Column({ name: 'VARIANT_CODE', type: 'varchar', length: 4, nullable: true })
    variant_code: string;

    @Column({ name: 'CNT_ORIGIN', type: 'varchar', length: 20, nullable: true })
    cnt_origin: string;

    @Column({ name: 'SERIALIZE', type: 'varchar', length: 1, nullable: true })
    serialize: string;

    @Column({ name: 'PACKING', type: 'varchar', length: 20, nullable: true })
    packing: string;

    @Column({ name: 'OLD_UPP', type: 'int', nullable: true })
    old_upp: number;

    @Column({ name: 'AVG_CONSUMPTION', type: 'int', nullable: true })
    avg_consumption: number;

    @Column({ name: 'PROD_IMAGE_PATH_WEB', type: 'varchar', length: 250, nullable: true })
    prod_image_path_web: string;

    @Column({ name: 'MINPERIOD_EXPPICK', type: 'int', nullable: true })
    minperiod_exppick: number;

    @Column({ name: 'RCPT_EXP_LIMIT', type: 'int', nullable: true })
    rcpt_exp_limit: number;

    @Column({ name: 'QTY_AS_WT', type: 'varchar', length: 1, nullable: true })
    qty_as_wt: string;

    @Column({ name: 'HAZMAT_IND', type: 'varchar', length: 1, nullable: true })
    hazmat_ind: string;

    @Column({ name: 'HAZMAT_CLASS', type: 'varchar', length: 10, nullable: true })
    hazmat_class: string;

    @Column({ name: 'FOOD_IND', type: 'varchar', length: 1, nullable: true })
    food_ind: string;

    @Column({ name: 'PHARMA_IND', type: 'varchar', length: 1, nullable: true })
    pharma_ind: string;

    @Column({ name: 'SPECIAL_INSTRUCTIONS', type: 'varchar', length: 100, nullable: true })
    special_instructions: string;

    @Column({ name: 'STRENGTH', type: 'varchar', length: 50, nullable: true })
    strength: string;

    @Column({ name: 'PACK_SIZE', type: 'int', nullable: true })
    pack_size: number;

    @Column({ name: 'GROUP_CODE_BK', type: 'varchar', length: 10, nullable: true })
    group_code_bk: string;

    @Column({ name: 'BATCH_TYPE', type: 'int', nullable: true })
    batch_type: number;

    @Column({ name: 'SAP_PROD_CODE', type: 'varchar', length: 20, nullable: true })
    sap_prod_code: string;

    @Column({ name: 'SAP_PROD_DESC', type: 'varchar', length: 250, nullable: true })
    sap_prod_desc: string;

    @Column({ name: 'TEMP_CODE', type: 'varchar', length: 250, nullable: true })
    temp_code: string;

    @Column({ name: 'EDIT_USER', type: 'varchar', length: 10, nullable: true })
    edit_user: string;

    @Column({ name: 'PRNT_P_CODE', type: 'varchar', length: 40, nullable: true })
    prnt_p_code: string;

    @Column({ name: 'PROD_SIZE', type: 'varchar', length: 50, nullable: true })
    prod_size: string;

    @Column({ name: 'PROD_COLOR', type: 'varchar', length: 50, nullable: true })
    prod_color: string;

    @Column({ name: 'PROD_GENDER', type: 'varchar', length: 50, nullable: true })
    prod_gender: string;

    @Column({ name: 'GENERIC_ARTICLE', type: 'varchar', length: 50, nullable: true })
    generic_article: string;

    @Column({ name: 'PRODUCT_CATEGORY', type: 'varchar', length: 50, nullable: true })
    product_category: string;

    @Column({ name: 'CURRENT_SEASON', type: 'varchar', length: 50, nullable: true })
    current_season: string;

    @CreateDateColumn({
        name: "CREATED_AT",
        type: "timestamp",
        default: () => "SYSDATE",
      })
      created_at!: Date;
    
    @UpdateDateColumn({
        name: "UPDATED_AT",
        type: "timestamp",
        default: () => "SYSDATE",
      })
      updated_at!: Date;

    @Column({ name: "UPDATED_BY", type: "varchar2", length: 50, nullable: true })
    updated_by?: string;

    @Column({ name: "CREATED_BY", type: "varchar2", length: 20, nullable: true })
    created_by?: string;
}
