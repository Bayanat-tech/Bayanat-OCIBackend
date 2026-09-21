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
import { createUoc, updateUoc, deleteCountries as deleteUocs } from "../../controllers/wms/uoc_wms.controller";

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const router = express.Router();

// Import port management controllers
import {
  createPort, // For creating new ports
  deletePorts, // For deleting ports
  updatePort, // For updating port information
  getPorts,
} from "../../controllers/wms/port_wms.controller";

// Import product type related controllers
// import {
//   // createBulkProducttypes, // For creating multiple product types
//   createProducttype, // For creating single product type
//   // deleteProducttypes, // For deleting product types
//   // exportProducttype, // For exporting product type data
//   // updateProducttype, // For updating product type
// } from "../../controllers/wms/producttype_wms.controller";
import { Request, Response } from "express";
import { 
  createProducttype,
  getProducttypes,
  updateProducttype,
  deleteProducttypes
 } from "../../controllers/wms/producttype_wms.controller";

// Import product management controllers
import {
  createProduct, // For creating new products
  updateProduct, // For updating product details
  importExcelProducts,
  deleteProduct,
  importProductsJSON,
  uploadProductEDI,
  getProductEDI,
  postValidProducts,
  clearProductEDI
} from "../../controllers/wms/product_wms.controller";

// Import account setup controllers
import {
  createAccountsetup, // For creating account setup
  updateAccountsetup, // For updating account setup
} from "../../controllers/wms/accountsetup_wms.controller";

// Import manufacture controllers
import {
  createManufacture, // For creating manufacturer
  deleteManufactures,
  updateManufacture, // For updating manufacturer
} from "../../controllers/wms/manufacture_wms.controller";

// Import product group controllers
import {
  createGroup, // For creating product groups
  updateGroup, // For updating product groups
  deleteGroups,
} from "../../controllers/wms/productgroup_wms.controller";

// Import activity group controllers
import {
  createActivityGroup, // For creating activity groups
  deleteActivityGroups, // For deleting activity groups
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
  deletePartners, // For deleting partners
  updatePartner, // For updating partners
} from "../../controllers/wms/partner_wms.controller";

// Import brand management controllers
import {
  createBrand, // For creating brands
  deleteBrands,
  updateBrand, // For updating brands
} from "../../controllers/wms/brand_wms.controller";

// Import supplier management controllers
import {
  createSupplier, // For creating suppliers
  deleteSuppliers,
  updateSupplier, // For updating suppliers
} from "../../controllers/wms/supplier_wms.controller";

// Import currency management controllers0
import {
  createcurrency, // For creating currencies
  deletecurrencys,
  updatecurrency, // For updating currencies
} from "../../controllers/wms/currency_wms.controller";

// Import department management controllers
import {
  createDepartment, // For creating departments
  updateDepartment,
  deleteDepartments,
   // For updating departments
} from "../../controllers/wms/department_wms.controller";

// Import salesman management controllers
import {
  createSalesman, // For creating salesmen
  updateSalesman, // For updating salesmen
  deleteSalesmen, // For deleting salesmen
} from "../../controllers/wms/salesman_wms.controller";

// Import principal management controllers
import {
  createBulkPrincipal, // For creating multiple principals
  createPrincipal, // For creating single principal
  // exportPrincipal, // For exporting principal data
  getPrincipal, // For getting principal details
  updatePrincipal, // For updating principal
} from "../../controllers/wms/principal_wms.controller";

// Import other WMS controllers
import {
  createHarmonize,
  deleteHarmonizeCodes,
  updateHarmonize,
} from "../../controllers/wms/harmonize_wms.controller";
import {
  createLocation,
  deleteLocations,
  updateLocation,
} from "../../controllers/wms/location_wms.controller";
import {
  createMoc2,
  deleteActivityUOCs,
  updateMoc2,
} from "../../controllers/wms/moc2_wms.controller";
import { createMoc, deleteMoc, updateMoc } from "../../controllers/wms/moc_wms.controller";
import { createUom, updateUom, deleteUoms } from "../../controllers/wms/uom_wms.controller";
// import { checkPassword } from "../../middleware/checkPassword";

// Import activity related controllers
import {
  createActivitysubgroup,
  deleteActivitySubgroups,
  updateActivitysubgroup,
} from "../../controllers/wms/activity_subgroup_wms.controller";

// import {
//   copyBillingActivity,
//   createActivityBillingDataByCompanyAndPrincipal,
//   deleteBillingActivities,
//   updateActivityBillingDataByCompanyAndPrincipal,
// } from "../../controllers/wms/activity_wms.controller";

// Import division controllers
import {
  CreateDivision,
  updateDivision,
  deleteDivisions,
} from "../../controllers/wms/division_wms.controller";

// Import asset group controllers


// Import warehouse controllers
// import {
//   createWarehouse,
//   updateWarehouse,
// } from "../../controllers/wms/warehouse_wms.controller";

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
  deleteActivityKPI,
  exportActivityKPI,
  updateActivityKPI,
} from "../../controllers/wms/activitykpi_wms.controller";

// Import location type controllers
import {
  createBulkLocationType,
  createLocationType,
  exportBulkLocationType,
  updateLocationType,
  getAllLocationTypes, // <-- Add this import
} from "../../controllers/wms/locationtype_wms.controller";
import { CustomerMasterController } from "../../controllers/wms/customer_wms.controller";
import { BillingActivity } from "../../controllers/wms/billing_activity_wms.controller";
import { checkPassword } from "../../middleware/checkPassword";
import { createPrincipalActivity } from "../../controllers/wms/createPrincipalActivity";
import { updateSiteMaster } from "../../controllers/wms/ms_site_wms_controller";

// Country Routes - Handle country management
router.post("/country", createCountry as unknown as express.RequestHandler); // Create new country
router.put("/country", updateCountry as unknown as express.RequestHandler); // Update existing country
router.post(
  "/country/bulk",
  createBulkCountries as unknown as express.RequestHandler
); // Create multiple countries at once
router.get(
  "/country/export",
  exportCountry as unknown as express.RequestHandler
); // Export country data
router.post(
  "/country/delete",
  deleteCountries as unknown as express.RequestHandler
); // Delete countries

// Activity KPI Routes - Handle KPI management
router.post(
  "/activity-kpi",
  createActivityKPI as unknown as express.RequestHandler
); // Create new activity KPI
router.put(
  "/activity-kpi",
  updateActivityKPI as unknown as express.RequestHandler
); // Update existing activity KPI
router.post(
  "/activity-kpi/bulk",
  createBulkActivityKPI as unknown as express.RequestHandler
); // Create multiple KPIs at once
router.get(
  "/activity-kpi/export",
  exportActivityKPI as unknown as express.RequestHandler
); // Export KPI data
router.post(
  "/activity-kpi/delete",
  deleteActivityKPI as unknown as express.RequestHandler
); // Delete activity KPI data
// ..\controllers\wms\producttype_wms.controller.ts

// Product Type Routes - Handle product type management


router.post("/producttype", async (req: Request, res: Response) => {
  await createProducttype(req, res);
});

router.get("/producttype", async (req: Request, res: Response) => {
  await getProducttypes(req, res);
}); // Export product type data
router.put("/producttype", async (req: Request, res: Response) => {
  await updateProducttype(req, res);
}); // Update existing product type
 // Create new product type
// router.post("/Producttype/bulk", createBulkProducttypes); // Create multiple product types
router.post("/producttype/delete", async (req: Request, res: Response) => {
  await deleteProducttypes(req, res);
}); // Delete product types

// Alert Routes - Handle alert management
router.post("/alert", createAlert); // Create new alert
router.put("/alert/:op_code/:op_type", updateAlert); // Update existing alert with params
router.post("/alert/bulk", createBulkAlerts); // Create multiple alerts
router.get("/alert/export", exportAlert); // Export alert data
router.post("/alert/delete", deleteAlerts); // Delete alerts

// Account Setup Routes - Handle account configuration
router.post("/accountsetup", createAccountsetup); // Create new account setup
router.put("/accountsetup", updateAccountsetup); // Update existing account setup

// Manufacture Routes - Handle manufacturer management
router.post("/manufacture", createManufacture); // Create new manufacturer
router.put("/manufacture", updateManufacture); // Update existing manufacturer
router.post("/manufacture/delete", deleteManufactures); // Delete manufacturer

// Group Routes - Handle product group management
router.post("/group", createGroup); // Create new product group
router.put("/group", updateGroup); // Update existing product group
router.delete("/group",deleteGroups);
// Brand Routes - Handle brand management
router.post("/brand", createBrand); // Create new brand
router.put("/brand", updateBrand); // Update existing brand
router.post("/brand/delete", deleteBrands); // Delete brands

// Department Routes - Handle department management
// Department Routes - Handle department management
router.post("/department", async (req, res, next) => {
  try {
    await createDepartment(req as any, res as any);
  } catch (err) {
    next(err);
  }
}); // Create new department

router.put("/department", async (req, res, next) => {
  try {
    await updateDepartment(req as any, res as any);
  } catch (err) {
    next(err);
  }
}); // Update existing department
router.delete("/department", async (req, res, next)=>{
  try{
    await deleteDepartments(req as any, res as any)
  } catch(err){
    next(err);
  }
}) // Delete existing department
// Principal Routes - Handle principal management
// router.get("/principal/export", exportPrincipal); // Export principal data
router.get("/principal/:prin_code", getPrincipal); // Get specific principal details
router.post("/principal", createPrincipal); // Create new principal
router.post("/principal/bulk", createBulkPrincipal); // Create multiple principals
router.put("/principal/:prin_code", updatePrincipal); // Update specific principal

// Location Routes - Handle location management
router.post("/location", async (req, res, next) => {
  try {
    await createLocation(req as any, res as any);
  } catch (err) {
    next(err);
  }
}); // Create new location
router.put("/location", async (req, res, next) => {
  try {
    await updateLocation(req as any, res as any);
  } catch (err) {
    next(err);
  }
}); // Update existing location
router.post("/location/delete", deleteLocations as unknown as express.RequestHandler); // Delete location

// Product Routes - Handle product management
  router.post("/product", createProduct); // Create new product
  router.put("/product", updateProduct); // Update existing product
  router.delete("/delproduct", deleteProduct);
  router.post(
    "/product/import-excel",
    upload.single("file"),
    importExcelProducts
  );
  router.post(
    '/product/import-json',
    importProductsJSON
  );
  router.post(
  "/product/edi/upload",
  uploadProductEDI
);
router.get("/product/edi", getProductEDI);
router.post(
  "/product/edi/post-valid",
  postValidProducts
);
router.delete(
  "/edi/clear",
  clearProductEDI
) 

// Currency Routes - Handle currency management
router.post("/currency", createcurrency); // Create new currency
router.put("/currency", updatecurrency); // Update existing currency
router.post("/currency/delete", deletecurrencys); // Delete currencies

// Salesman Routes - Handle salesman management
router.get("/salesman", createSalesman as unknown as express.RequestHandler); // Fetch all salesmen
router.post("/salesman", createSalesman as unknown as express.RequestHandler); // Create new salesman
router.put("/salesman", updateSalesman as unknown as express.RequestHandler); // Update existing salesman
router.post(
  "/salesman/delete",
  deleteSalesmen as unknown as express.RequestHandler
); // Delete salesmen

// Supplier Routes - Handle supplier management
router.post("/supplier", createSupplier as unknown as express.RequestHandler); // Create new supplier
router.put("/supplier", updateSupplier as unknown as express.RequestHandler); // Update existing supplier
router.post("/supplier/delete", deleteSuppliers as unknown as express.RequestHandler); // Delete supplier

// UOM Routes - Handle unit of measurement
router.post("/uom", createUom as unknown as express.RequestHandler); // Create new UOM
router.put("/uom", updateUom as unknown as express.RequestHandler); // Update existing UOM
router.post("/uom/delete", deleteUoms as unknown as express.RequestHandler); // Delete UOM

// MOC Routes - Handle method of collection
router.post("/moc", createMoc as unknown as express.RequestHandler); // Create new MOC
router.put("/moc", updateMoc as unknown as express.RequestHandler); // Update existing MOC
router.post("/moc/delete", deleteMoc as unknown as express.RequestHandler); // Delete MOC

// MOC2 Routes - Handle secondary method of collection
router.post("/moc2", createMoc2 as unknown as express.RequestHandler); // Create new MOC2
router.put("/moc2", updateMoc2 as unknown as express.RequestHandler); // Update existing MOC2
router.post("/moc2/delete", deleteActivityUOCs as unknown as express.RequestHandler); // Delete MOC2

// UOC Routes - Handle unit of currency
router.post("/uoc", createUoc as unknown as express.RequestHandler); // Create new UOC
router.put("/uoc", updateUoc as unknown as express.RequestHandler); // Update existing UOC
router.post("/uoc/delete", deleteUocs as unknown as express.RequestHandler); // Delete UOC

// Harmonize Routes - Handle harmonization
router.post("/harmonize", createHarmonize as unknown as express.RequestHandler); // Create new harmonization
router.put("/harmonize", updateHarmonize as unknown as express.RequestHandler); // Update existing harmonization
router.post("/harmonize/delete", deleteHarmonizeCodes as unknown as express.RequestHandler); // Delete harmonization

// Activity Group Routes - Handle activity group management
router.post(
  "/activitygroup",
  createActivityGroup as unknown as express.RequestHandler
); // Create new activity group
router.put(
  "/activitygroup",
  updateActivityGroup as unknown as express.RequestHandler
); // Update existing activity group
router.post(
  "/activitygroup/delete",
  deleteActivityGroups as unknown as express.RequestHandler
); // Delete activity group

// Line Routes - Handle line management
router.post("/line", createLine as unknown as express.RequestHandler); // Create new line
router.put("/line", updateLine as unknown as express.RequestHandler); // Update existing line
router.post("/line/delete", deleteLine as unknown as express.RequestHandler); // Delete line

// Vessel Routes - Handle vessel management
router.post("/vessel", createVessel); // Create new vessel
router.put("/vessel", updateVessel); // Update existing vessel
router.post("/vessel/delete", deleteVessel); // Delete vessel

// Airline Routes - Handle airline management
router.post("/airline", createAirLine as unknown as express.RequestHandler); // Create new airline
router.put("/airline", updateAirLine as unknown as express.RequestHandler); // Update existing airline
router.post(
  "/airline/delete",
  deleteAirLines as unknown as express.RequestHandler
); // Delete airlines

// Partner Routes - Handle partner management
router.post("/partner", createPartner as unknown as express.RequestHandler); // Create new partner
router.put("/partner", updatePartner as unknown as express.RequestHandler); // Update existing partner
router.post(
  "/partner/delete",
  deletePartners as unknown as express.RequestHandler
); // Delete partner

// Billing Activity Routes
router.post(
  "/activity_billing/:principalCode",
  checkPassword,
  BillingActivity
); // Create billing activity for principal
router.put(
  "/activity_billing/:principalCode/:activityCode",
  checkPassword,
  BillingActivity
); // Update billing activity



router.post("/createPrincipalActivity", createPrincipalActivity); // Create new activity subgroup
// Activity Billing Routes - Handle billing activities
// router.post(
//   "/activity_billing/:principalCode",
//   checkPassword,
//   createActivityBillingDataByCompanyAndPrincipal
// ); // Create billing activity for principal
// router.put(
//   "/activity_billing/:principalCode/:activityCode",
//   checkPassword,
//   updateActivityBillingDataByCompanyAndPrincipal
// ); // Update billing activity
// router.post("/copy_billing_activity", checkPassword, copyBillingActivity); // Copy billing activity
// router.post("/delete_billing_activity", deleteBillingActivities); // Delete billing activities

// Activity Sub Group Routes - Handle activity subgroup management
router.post("/activitysubgroup", createActivitysubgroup); // Create new activity subgroup
router.put("/activitysubgroup", updateActivitysubgroup); // Update existing activity subgroup
router.post("/activitysubgroup/delete", deleteActivitySubgroups); // Delete activity subgroup

// Division Routes - Handle division management
router.post("/division", CreateDivision); // Create new division
router.put("/division", updateDivision); // Update existing division
router.delete("/division",deleteDivisions);
// Port Routes - Handle port management
// Add this line for GET
// router.get("/port", getPort); // Uncomment and use your actual GET handler
router.post("/port", createPort); // Create new port
router.put("/port", updatePort); // Update existing port
router.post("/port/delete", deletePorts); // Delete ports
router.get("/getPort", getPorts); // Get list of ports

// Asset Group Routes - Handle asset group management

// router.post("/assetgroup", createAssetgroup); // Create new asset group
// router.put("/assetgroup", updateAssetgroup); // Update existing asset group
// router.post("/assetgroup/delete", deleteAssetgroups); // Delete asset group

// Warehouse Routes - Handle warehouse management
// router.post("/warehouse", createWarehouse); // Create new warehouse
// router.put("/warehouse", updateWarehouse); // Update existing warehouse
router.post("/warehouse/bulk", createBulkLocationType); // Create multiple warehouse locations
router.get("/warehouse/export", exportBulkLocationType); // Export warehouse data

// Location Type Routes - Handle location type management
router.post("/locationtype", createLocationType); // Create new location type
router.put("/locationtype", updateLocationType); // Update existing location type
router.post("/locationtype/bulk", createBulkLocationType); // Create multiple location types
router.get("/locationtype", getAllLocationTypes); // Get all location types as JSON

router.post("/customer", CustomerMasterController.createCustomerMaster); 
router.put("/customer", CustomerMasterController.updateCustomerMaster); 


router.post("/locationtype/bulk", createBulkLocationType); // Create multiple location types
router.get("/locationtype", getAllLocationTypes); // Get all location types as JSON

router.post("/siteMaster", updateSiteMaster); 
router.put("/siteMaster", updateSiteMaster);

export default router;
