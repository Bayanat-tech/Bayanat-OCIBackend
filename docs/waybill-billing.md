# Waybill revenue processing

Open **Waybill reader → Revenue verification**. Enter the three masters first, choose agreed rules under **Billing settings**, then click **Process all waybills**. Inspect each row and select **Details / Review** to verify automatic charges or record team-entered allocations.

## Excel workflow

1. Normalize destination/well and city keys by trimming, collapsing whitespace and uppercasing; match destinations to Well IDs (Destination Lookup).
2. Group within the authenticated company/tenant by normalized truck and pickup calendar date. Count distinct well IDs: one is STANDARD; two or more is NON_STANDARD, including two wells in the same city. Distinct loads for the same well remain separate standard waybill rows. Duplicate load/destination combinations are held for review. Invalid dates, mixed vendors in a truck/day, and more than two wells also require review.
3. Standard base revenue comes from that well's city rate.
4. Non-standard base revenue uses the explicitly selected billing setting: each waybill's own city rate, or one selected city's rate for the entire truck/day.
5. Standard chargeable Kms = max(0, Actual Kms - Base Kms - 15). Kms revenue = chargeable Kms × standard Kms charge.
6. Non-standard Kms use the well-pair distance and selected city rate. Available configurable formulas are pair-only `max(0, Distance - 15)` or selected-well diversion plus pair `max(0, Actual - Base - 15) + max(0, Distance - 15)`. Kms are allocated once to the selected waybill. These options are **not prescribed by the Excel**: the business must select the agreed rule or use a documented team-entered calculation. The selected city can be the farthest well (Actual Kms) or highest non-standard base rate. Ties use the earliest saved waybill ID. A reverse pair can supply the distance when there is no conflicting forward value; conflicting values require review.
7. Persist the revenue verification table with Load Number, Destination Name, Scheduled Vehicle, Pickup Date, Vendor Name, Rig ID, Base Revenue, Kms Revenue, Trip Type and Kms chargeable. Extra columns show city, drop count, local-trip revenue, total, verification state and review audit information. CSV export includes the verification status and review reason.

## Special rules and review

- The additional Duqm Salt local-trip amount and charge frequency must be explicitly configured. Frequency options are once per truck/day or per waybill. Exact normalized vendor name matching is used.
- Missing masters/rules never become zero-priced trips. Affected truck/day groups show NEEDS_REVIEW with null amounts and reasons.
- Trips with more than two drops support team-entered base revenue, net chargeable Kms, Kms revenue and local revenue on each waybill. A calculation reason is mandatory. Shared charges must be allocated by the team across the rows once. Manual amounts are final allocations; the system does not apply a second deduction to them.
- Automatic results are READY until verified. Team overrides are MANUAL_VERIFIED and preserve the original issues for audit.
- Amounts and rates use three decimal places; multiplication uses integer thousandths and half-up rounding. Negative billable Kms are floored at zero. Numeric overflow requires review.
- Dates accept DD/MM/YYYY, DD-MM-YYYY and YYYY-MM-DD, with optional time. Two-digit years and invalid calendar dates require review. No timezone conversion changes the pickup date.

## Persistence and concurrency

`VMS_WAYBILL_REVENUE` stores one result per company/waybill ID. `VMS_WAYBILL_BILLING_CONFIG` holds explicit company settings. `VMS_WAYBILL_REVENUE_AUDIT` records processing, reviews and settings changes, including actor and timestamp. Tables are initialized on first authenticated billing use, following the existing tenant-table pattern.

Processing uses one serializable Oracle transaction and a company lock. Failure rolls back result and audit writes together. Repeated processing preserves unchanged verified/manual rows without inserting duplicates. Source fingerprints include all truck/day peers, relevant master values and billing settings. Source changes make previous verification stale, and processing replaces it with a new calculation requiring review. Review tokens prevent one reviewer from overwriting another's intervening review. Reads use a consistent Oracle snapshot. Concurrent modification conflicts return HTTP 409 for retry.

All waybills are processed together so filtering a month/status cannot truncate a multi-drop group. UI filters affect display/export only. Verified totals include only currently processed VERIFIED or MANUAL_VERIFIED rows. Old audit history remains available in the audit table; no historical rate effective-date schedule is introduced.

## APIs

- GET `/api/vms/waybill-revenue`: current calculations, settings and processing/verification freshness.
- POST `/api/vms/waybill-revenue/process`: calculate and atomically persist company results.
- PUT `/api/vms/waybill-revenue/settings`: validate/save explicit company rules and audit the change.
- PUT `/api/vms/waybill-revenue/:id/review`: automatic verification or documented manual allocation, with source hash and review token.

Uses the existing JWT, tenant middleware and active-user authorization. Company scope always comes from the authenticated user. No separate reviewer role exists in the current VMS authorization model.

## Validation and limitations

Run `node -r ts-node/register --test tests/waybillMasters.test.cjs tests/waybillBilling.engine.test.cjs tests/waybillBilling.controller.test.cjs`.

Engine tests cover all seven steps, deductions, decimal rates, grouping, missing lookups/rules, duplicate loads, reverse distances, Duqm Salt and exceptional drops. Controller tests use mocked Oracle connections for persistence, isolation, stale reviews, idempotence and rollback. An authenticated Oracle smoke test is still required for real DDL privileges, SQL execution and persistence.

The workbook's later Cuetrans reconciliation, subcontractor invoices, FMS integration and stamp detection are separate from these seven billing steps and are not implemented by this change.
