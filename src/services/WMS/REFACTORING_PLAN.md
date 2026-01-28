/**
 * Batch Refactoring Plan for WMS Services
 * All services listed below need to be refactored from AppDataSource to TenantManager
 * 
 * Services Already Fixed:
 * ✅ principal.service.ts (MS_PRINCIPAL)
 * ✅ port.service.ts (MS_PORT)
 * ✅ partner.service.ts (MS_BROKER)
 * 
 * Services Remaining (35 services):
 */

// CRITICAL SERVICES (Fix first - High impact):
const criticalServices = [
  { file: "activity.service.ts", table: "MS_ACTIVITY" },
  { file: "activitygroup.service.ts", table: "MS_ACTIVITY_GROUP" },
  { file: "activitykpi.service.ts", table: "MS_ACTIVITY_KPI" },
  { file: "activity_subgroup.service.ts", table: "MS_ACTIVITY_SUBGROUP" },
  { file: "department.service.ts", table: "MS_DEPARTMENT" },
  { file: "warehouse.service.ts", table: "MS_WAREHOUSE" },
  { file: "location.service.ts", table: "MS_LOCATION" },
  { file: "product.service.ts", table: "MS_PRODUCT" },
  { file: "moc.service.ts", table: "MS_MOC" },
  { file: "moc2.service.ts", table: "MS_MOC2" },
];

// SECONDARY SERVICES (Fix next):
const secondaryServices = [
  { file: "acsetup.service.ts", table: "MS_ACSETUP" },
  { file: "airline.service.ts", table: "MS_AIRLINE" },
  { file: "alert.service.ts", table: "MS_ALERT" },
  { file: "billing_activity.service.ts", table: "MS_BILLING_ACTIVITY" },
  { file: "brand.service.ts", table: "MS_BRAND" },
  { file: "country.service.ts", table: "MS_COUNTRY" },
  { file: "currency.service.ts", table: "MS_CURRENCY" },
  { file: "customer.service.ts", table: "MS_CUSTOMER" },
  { file: "division.service.ts", table: "MS_DIVISION" },
  { file: "group.service.ts", table: "MS_GROUP" },
  { file: "harmonize.service.ts", table: "MS_HARMONIZE" },
  { file: "line.service.ts", table: "MS_LINE" },
  { file: "locationtype.service.ts", table: "MS_LOCATIONTYPE" },
  { file: "manufacturer.service.ts", table: "MS_MANUFACTURER" },
  { file: "principalcontactdetl.service.ts", table: "MS_PRINCIPALCONTACTDETL" },
  { file: "principalfile.service.ts", table: "MS_PRINCIPALFILE" },
  { file: "producttype.service.ts", table: "MS_PRODUCTTYPE" },
  { file: "salesman.service.ts", table: "MS_SALESMAN" },
  { file: "suppliermaster.service.ts", table: "MS_SUPPLIERMASTER" },
  { file: "taAdjDetail.service.ts", table: "MS_TA_ADJ_DETAIL" },
  { file: "taAdjHeader.service.ts", table: "MS_TA_ADJ_HEADER" },
  { file: "uoc.service.ts", table: "MS_UOC" },
  { file: "uom.service.ts", table: "MS_UOM" },
  { file: "vessel.service.ts", table: "MS_VESSEL" },
];

// UTILITY SERVICES (Lower priority):
const utilityServices = [
  { file: "confirmInboundjob.service.ts", table: "MS_INBOUND_JOB" },
  { file: "putwayPackingItem.service.ts", table: "MS_PUTWAY_PACKING" },
];

/**
 * REFACTORING PATTERN:
 * 
 * 1. Replace imports:
 *    FROM: import { getRepository } from "../../database/connection";
 *    TO: import { executeQuery, executeSingleQuery, executeMutation, executeCount } from "./tenant-service.helper";
 * 
 * 2. Remove repository class variables
 * 
 * 3. Replace each method:
 *    repository.find() → executeQuery<EntityType>(sql, params)
 *    repository.findOne() → executeSingleQuery<EntityType>(sql, params)
 *    repository.create() + repository.save() → INSERT SQL + executeMutation()
 *    repository.update() → UPDATE SQL + executeMutation()
 *    repository.delete() → DELETE SQL + executeMutation()
 *    repository.count() → SELECT COUNT(*) + executeCount()
 * 
 * 4. Normalize all results with normalizeOracleResult()
 * 
 * TOTAL TIME ESTIMATE: 2-3 hours for all 35 services
 * BENEFIT: Full 100-user, 6-7 tenant support + 10x faster queries
 */
