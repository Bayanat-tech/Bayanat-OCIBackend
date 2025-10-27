import { DataTypes, Model } from "sequelize";

import { sequelize } from "../../../../database/connection";
import constants from "../../../../helpers/constants";
import { IToOrderDetail } from "../../../../interfaces/wms/transaction/outbound/outboundJobWms.interface";

class OrderDetail extends Model<IToOrderDetail> {}

OrderDetail.init(
  {
    company_code: {
      type: DataTypes.STRING(7),
      allowNull: false,
    },
    prin_code: {
      type: DataTypes.STRING(5),
      allowNull: false,
    },
    job_no: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
    cust_code: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    order_no: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    serial_no: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    prod_code: {
      type: DataTypes.STRING(40),
      allowNull: false,
    },
    qty_puom: {
      type: DataTypes.DECIMAL(12, 1),
      allowNull: false,
    },
    p_uom: {
      type: DataTypes.STRING(5),
      allowNull: false,
    },
    qty_luom: {
      type: DataTypes.DECIMAL(12, 1),
      allowNull: false,
    },
    quantity: {
      type: DataTypes.DECIMAL(12, 1),
      allowNull: false,
    },
    doc_ref: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    lot_no: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    po_no: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    imp_job_no: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
    manu_code: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
    container_no: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    production_from: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    production_to: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    expiry_from: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    expiry_to: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    unit_price: {
      type: DataTypes.DECIMAL(16, 6),
      allowNull: false,
    },
    site_code: {
      type: DataTypes.STRING(5),
      allowNull: false,
    },
    loc_code_from: {
      type: DataTypes.STRING(15),
      allowNull: false,
    },
    loc_code_to: {
      type: DataTypes.STRING(15),
      allowNull: false,
    },
    picked: {
      type: DataTypes.STRING(1),
      allowNull: false,
    },
    confirmed: {
      type: DataTypes.STRING(1),
      allowNull: false,
    },
    confirmed_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    l_uom: {
      type: DataTypes.STRING(6),
      allowNull: false,
    },
    uppp: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    selected: {
      type: DataTypes.STRING(1),
      allowNull: false,
    },
    aisle_from: {
      type: DataTypes.STRING(2),
      allowNull: false,
    },
    aisle_to: {
      type: DataTypes.STRING(2),
      allowNull: false,
    },
    height_from: {
      type: DataTypes.STRING(2),
      allowNull: false,
    },
    height_to: {
      type: DataTypes.STRING(2),
      allowNull: false,
    },
    column_from: {
      type: DataTypes.STRING(2),
      allowNull: false,
    },
    column_to: {
      type: DataTypes.STRING(2),
      allowNull: false,
    },
    gate_no: {
      type: DataTypes.STRING(3),
      allowNull: false,
    },
    sales_rate: {
      type: DataTypes.DECIMAL(18, 4),
      allowNull: false,
    },
    exp_container_no: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    exp_container_size: {
      type: DataTypes.DECIMAL(10, 0),
      allowNull: false,
    },
    exp_container_type: {
      type: DataTypes.STRING(40),
      allowNull: false,
    },
    exp_container_sealno: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    moc1: {
      type: DataTypes.STRING(3),
      allowNull: false,
    },
    moc2: {
      type: DataTypes.STRING(5),
      allowNull: false,
    },
    order_serial: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    origin_country: {
      type: DataTypes.STRING(5),
      allowNull: false,
    },
    bal_pack_qty: {
      type: DataTypes.DECIMAL(12, 1),
      allowNull: false,
    },
    multi_series: {
      type: DataTypes.STRING(1),
      allowNull: false,
    },
    prod_attrib_code: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    prod_grade1: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    prod_grade2: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    tx_identity_number: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    ref_txn_code: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
    ref_txn_slno: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    so_txn_code: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    inbound_done: {
      type: DataTypes.STRING(1),
      allowNull: false,
    },
    ref_txn_doc: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    supp_code: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
    supp_reference: {
      type: DataTypes.STRING(25),
      allowNull: false,
    },
    orig_prod_code: {
      type: DataTypes.STRING(40),
      allowNull: false,
    },
    salesman_code: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
    hs_code: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    batch_no: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    act_order_qty: {
      type: DataTypes.DECIMAL(12, 1),
      allowNull: false,
    },
    bal_order_qty: {
      type: DataTypes.DECIMAL(12, 1),
      allowNull: false,
    },
    minperiod_exppick: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    ignore_minexp_period: {
      type: DataTypes.STRING(1),
      allowNull: false,
    },
    stock_owner: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
    ind_code: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    git_no: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
     qty_string: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
    priority: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: "OrderDetail",
    tableName: "VW_TO_ORDER_DET",
    timestamps: false,
    // createdAt: "created_at",
    // updatedAt: "updated_at",
  }
);
OrderDetail.removeAttribute("id");
export default OrderDetail;
