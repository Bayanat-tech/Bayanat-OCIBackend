// Import Express framework
import * as express from "express";
const multer = require("multer");
// Import country related controllers
import {
  createBulkCountries, // For creating multiple countries at once
  createCountry, // For creating a single country
  deleteCountries, // For deleting countries
  exportCountry, // For exporting country data
  updateCountry, // For updating country information
} from "../../controllers/wms/country_wms.controller";

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const router = express.Router();

// Import port management controllers
import {
  createPort, // For creating new ports
  deletePorts, // For deleting ports
  updatePort, // For updating port information
} from "../../controllers/wms/port_wms.controller";

// Import product type related controllers
import {
  createBulkProducttypes, // For creating multiple product types
  createProducttype, // For creating single product type
  deleteProducttypes, // For deleting product types
  exportProducttype, // For exporting product type data
  updateProducttype, // For updating product type
} from "../../controllers/wms/producttype_wms.controller";

// Import product management controllers
import {
  createProduct, // For creating new products
  updateProduct, // For updating product details
  importExcelProducts,
} from "../../controllers/wms/product_wms.controller";

// Import account setup controllers
import {
  createAccountsetup, // For creating account setup
  updateAccountsetup, // For updating account setup
} from "../../controllers/wms/accountsetup_wms.controller";

// Import manufacture controllers
import {
  createManufacture, // For creating manufacturer
  updateManufacture, // For updating manufacturer
} from "../../controllers/wms/manufacture_wms.controller";

// Import product group controllers
import {
  createGroup, // For creating product groups
  updateGroup, // For updating product groups
} from "../../controllers/wms/productgroup_wms.controller";

// Import activity group controllers
import {
  createActivityGroup, // For creating activity groups
  deleteActivityGroup, // For deleting activity groups
  updateActivityGroup, // For updating activity groups
} from "../../controllers/wms/activitygroup_wms.controller";

// Import line management controllers
import {
  createLine, // For creating lines
  deleteLine, // For deleting lines
  updateLine, // For updating lines
} from "../../controllers/wms/line_wms.controller";

// Import vessel management controllers
import {
  createVessel, // For creating vessels
  deleteVessel, // For deleting vessels
  updateVessel, // For updating vessels
} from "../../controllers/wms/vessel_wms.controller";

// Import airline management controllers
import {
  createAirLine, // For creating airlines
  deleteAirLines, // For deleting airlines
  updateAirLine, // For updating airlines
} from "../../controllers/wms/airline_wms.controller";

// Import partner management controllers
import {
  createPartner, // For creating partners
  deletePartner, // For deleting partners
  updatePartner, // For updating partners
} from "../../controllers/wms/partner_wms.controller";

// Import brand management controllers
import {
  createBrand, // For creating brands
  updateBrand, // For updating brands
} from "../../controllers/wms/brand_wms.controller";

// Import supplier management controllers
import {
  createsupplier, // For creating suppliers
  updatesupplier, // For updating suppliers
} from "../../controllers/wms/supplier_wms.controller";

// Import currency management controllers
import {
  createcurrency, // For creating currencies
  updatecurrency, // For updating currencies
} from "../../controllers/wms/currency_wms.controller";

// Import department management controllers
import {
  createdepartment, // For creating departments
  updatedepartment, // For updating departments
} from "../../controllers/wms/department_wms.controller";

// Import salesman management controllers
import {
  createSalesman, // For creating salesmen
  updateSalesman, // For updating salesmen
} from "../../controllers/wms/salesman_wms.controller";

// Import security related controllers
import {
  createrolemaster, // For creating role masters
  updaterolemaster, // For updating role masters
} from "../../controllers/Security/rolemaster_security.controller";

import {
  createflowmaster, // For creating flow masters
  updateflowmaster, // For updating flow masters
} from "../../controllers/Security/flowmaster_security.controller";

// Import principal management controllers
import {
  createBulkPrincipal, // For creating multiple principals
  createPrincipal, // For creating single principal
  exportPrincipal, // For exporting principal data
  getPrincipal, // For getting principal details
  updatePrincipal, // For updating principal
} from "../../controllers/wms/principal_wms.controller";

// Import other WMS controllers
import {
  createHarmonize,
  updateHarmonize,
} from "../../controllers/wms/harmonize_wms.controller";
import {
  createlocation,
  updatelocation,
} from "../../controllers/wms/location_wms.controller";
import {
  createMoc2,
  updateMoc2,
} from "../../controllers/wms/moc2_wms.controller";
import { createMoc, updateMoc } from "../../controllers/wms/moc_wms.controller";
import { createUoc, updateUoc } from "../../controllers/wms/uoc_wms.controller";
import { createUom, updateUom } from "../../controllers/wms/uom_wms.controller";
import { checkPassword } from "../../middleware/checkPassword";

// Import activity related controllers
import {
  createActivitysubgroup,
  updateActivitysubgroup,
} from "../../controllers/wms/activity_subgroup_wms.controller";

import {
  copyBillingActivity,
  createActivityBillingDataByCompanyAndPrincipal,
  deleteBillingActivities,
  updateActivityBillingDataByCompanyAndPrincipal,
} from "../../controllers/wms/activity_wms.controller";

// Import division controllers
import {
  CreateDivision,
  updateDivision,
} from "../../controllers/wms/division_wms.controller";

// Import asset group controllers
import {
  createAssetgroup,
  updateAssetgroup,
} from "../../controllers/wms/assetgroup_wms.controller";

// Import warehouse controllers
import {
  createWarehouse,
  updateWarehouse,
} from "../../controllers/wms/warehouse_wms.controller";

// Import alert management controllers
import {
  createAlert,
  createBulkAlerts,
  deleteAlerts,
  exportAlert,
  updateAlert,
} from "../../controllers/wms/alert_wms.controller";

// Import KPI related controllers
import {
  createActivityKPI,
  createBulkActivityKPI,
  exportActivityKPI,
  updateActivityKPI,
} from "../../controllers/wms/activitykpi_wms.controller";

// Import location type controllers
import {
  createBulkLocationType,
  createLocationType,
  exportBulkLocationType,
  updateLocationType,
} from "../../controllers/wms/locationtype_wms.controller";

// Role Master Routes - Handle role creation and updates
router.post("/rolemaster", createrolemaster); // Create new role master
router.put("/rolemaster", updaterolemaster); // Update existing role master

// Flow Master Routes - Handle workflow creation and updates
router.post("/flowmaster", createflowmaster); // Create new flow master
router.put("/flowmaster", updateflowmaster); // Update existing flow master

// Country Routes - Handle country management
router.post("/country", createCountry); // Create new country
router.put("/country", updateCountry); // Update existing country
router.post("/country/bulk", createBulkCountries); // Create multiple countries at once
router.get("/country/export", exportCountry); // Export country data
router.post("/country/delete", deleteCountries); // Delete countries

// Activity KPI Routes - Handle KPI management
router.post("/activity-kpi", createActivityKPI); // Create new activity KPI
router.put("/activity-kpi", updateActivityKPI); // Update existing activity KPI
router.post("/activity-kpi/bulk", createBulkActivityKPI); // Create multiple KPIs at once
router.get("/activity-kpi/export", exportActivityKPI); // Export KPI data

// Product Type Routes - Handle product type management
router.post("/Producttype", createProducttype); // Create new product type
router.put("/Producttype", updateProducttype); // Update existing product type
router.post("/Producttype/bulk", createBulkProducttypes); // Create multiple product types
router.get("/Producttype/export", exportProducttype); // Export product type data
router.post("/Producttype/delete", deleteProducttypes); // Delete product types

// Alert Routes - Handle alert management
router.post("/alert", createAlert); // Create new alert
router.put("/alert", updateAlert); // Update existing alert
router.post("/alert/bulk", createBulkAlerts); // Create multiple alerts
router.get("/alert/export", exportAlert); // Export alert data
router.post("/alert/delete", deleteAlerts); // Delete alerts

// Account Setup Routes - Handle account configuration
router.post("/accountsetup", createAccountsetup); // Create new account setup
router.put("/accountsetup", updateAccountsetup); // Update existing account setup

// Manufacture Routes - Handle manufacturer management
router.post("/manufacture", createManufacture); // Create new manufacturer
router.put("/manufacture", updateManufacture); // Update existing manufacturer

// Group Routes - Handle product group management
router.post("/group", createGroup); // Create new product group
router.put("/group", updateGroup); // Update existing product group

// Brand Routes - Handle brand management
router.post("/brand", createBrand); // Create new brand
router.put("/brand", updateBrand); // Update existing brand

// Department Routes - Handle department management
router.post("/department", createdepartment); // Create new department
router.put("/department", updatedepartment); // Update existing department

// Principal Routes - Handle principal management
router.get("/principal/export", exportPrincipal); // Export principal data
router.get("/principal/:prin_code", getPrincipal); // Get specific principal details
router.post("/principal", createPrincipal); // Create new principal
router.post("/principal/bulk", createBulkPrincipal); // Create multiple principals
router.put("/principal/:prin_code", updatePrincipal); // Update specific principal

// Location Routes - Handle location management
router.post("/location", createlocation); // Create new location
router.put("/location", updatelocation); // Update existing location

// Product Routes - Handle product management
router.post("/product", createProduct); // Create new product
router.put("/product", updateProduct); // Update existing product
router.post(
  "/product/import-excel",
  upload.single("file"),
  importExcelProducts
);

// Currency Routes - Handle currency management
router.post("/currency", createcurrency); // Create new currency
router.put("/currency", updatecurrency); // Update existing currency

// Salesman Routes - Handle salesman management
router.post("/salesman", createSalesman); // Create new salesman
router.put("/salesman", updateSalesman); // Update existing salesman

// Supplier Routes - Handle supplier management
router.post("/supplier", createsupplier); // Create new supplier
router.put("/supplier", updatesupplier); // Update existing supplier

// UOM Routes - Handle unit of measurement
router.post("/uom", createUom); // Create new UOM
router.put("/uom", updateUom); // Update existing UOM

// MOC Routes - Handle method of collection
router.post("/moc", createMoc); // Create new MOC
router.put("/moc", updateMoc); // Update existing MOC

// MOC2 Routes - Handle secondary method of collection
router.post("/moc2", createMoc2); // Create new MOC2
router.put("/moc2", updateMoc2); // Update existing MOC2

// UOC Routes - Handle unit of currency
router.post("/uoc", createUoc); // Create new UOC
router.put("/uoc", updateUoc); // Update existing UOC

// Harmonize Routes - Handle harmonization
router.post("/harmonize", createHarmonize); // Create new harmonization
router.put("/harmonize", updateHarmonize); // Update existing harmonization

// Activity Group Routes - Handle activity group management
router.post("/activitygroup", createActivityGroup); // Create new activity group
router.put("/activitygroup", updateActivityGroup); // Update existing activity group
router.post("/activitygroup/delete", deleteActivityGroup); // Delete activity group

// Line Routes - Handle line management
router.post("/line", createLine); // Create new line
router.put("/line", updateLine); // Update existing line
router.post("/line/delete", deleteLine); // Delete line

// Vessel Routes - Handle vessel management
router.post("/vessel", createVessel); // Create new vessel
router.put("/vessel", updateVessel); // Update existing vessel
router.post("/vessel/delete", deleteVessel); // Delete vessel

// Airline Routes - Handle airline management
router.post("/airline", createAirLine); // Create new airline
router.put("/airline", updateAirLine); // Update existing airline
router.post("/airline/delete", deleteAirLines); // Delete airlines

// Partner Routes - Handle partner management
router.post("/partner", createPartner); // Create new partner
router.put("/partner", updatePartner); // Update existing partner
router.post("/partner/delete", deletePartner); // Delete partner

// Activity Billing Routes - Handle billing activities
router.post(
  "/activity_billing/:principalCode",
  checkPassword,
  createActivityBillingDataByCompanyAndPrincipal
); // Create billing activity for principal
router.put(
  "/activity_billing/:principalCode/:activityCode",
  checkPassword,
  updateActivityBillingDataByCompanyAndPrincipal
); // Update billing activity
router.post("/copy_billing_activity", checkPassword, copyBillingActivity); // Copy billing activity
router.post("/delete_billing_activity", deleteBillingActivities); // Delete billing activities

// Activity Sub Group Routes - Handle activity subgroup management
router.post("/activitysubgroup", createActivitysubgroup); // Create new activity subgroup
router.put("/activitysubgroup", updateActivitysubgroup); // Update existing activity subgroup

// Division Routes - Handle division management
router.post("/division", CreateDivision); // Create new division
router.put("/division", updateDivision); // Update existing division

// Port Routes - Handle port management
router.post("/port", createPort); // Create new port
router.put("/port", updatePort); // Update existing port
router.post("/port/delete", deletePorts); // Delete ports

// Asset Group Routes - Handle asset group management
router.post("/assetgroup", createAssetgroup); // Create new asset group
router.put("/assetgroup", updateAssetgroup); // Update existing asset group

// Warehouse Routes - Handle warehouse management
router.post("/warehouse", createWarehouse); // Create new warehouse
router.put("/warehouse", updateWarehouse); // Update existing warehouse
router.post("/warehouse/bulk", createBulkLocationType); // Create multiple warehouse locations
router.get("/warehouse/export", exportBulkLocationType); // Export warehouse data

// Location Type Routes - Handle location type management
router.post("/locationtype", createLocationType); // Create new location type
router.put("/locationtype", updateLocationType); // Update existing location type
router.post("/locationtype/bulk", createBulkLocationType); // Create multiple location types
router.get("/locationtype/export", exportBulkLocationType); // Export location type data

export default router;
