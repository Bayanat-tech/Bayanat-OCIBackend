# Waybill master setup

Open the vendor waybill reader and select **Manage masters**.

1. Enter city rates: city, base kilometres, standard/non-standard base revenue and the two per-kilometre charges.
2. Enter well destinations: the destination name from the waybill, its city and actual kilometres.
3. Enter non-standard distances: well ID 1, well ID 2 and their distance in kilometres.

The tables are `VMS_WAYBILL_RATES`, `VMS_WAYBILL_WELLS` and `VMS_WAYBILL_DISTANCES`. The first authenticated master request creates them in the tenant connection's schema, following the existing waybill feature. This requires table-creation privileges. Existing tables are not migrated. No sample billing values are seeded.

Each entry belongs to the authenticated company. City/well references include company code, so records cannot reference another company's masters. Text keys are trimmed, whitespace-normalized and uppercased. Numeric values are required, non-negative, and support three decimal places. City and well names cannot be renamed while referenced by dependent masters.

Diversion kilometres are returned by the well lookup as `actual_kms - base_kms - 15`, without clamping. They are calculated from current city rates, not stored as a value that can become stale. This is a lookup result, not yet a chargeable-kilometres calculation.

Distances currently preserve the order of Well ID 1 and Well ID 2. Reverse pairs are separate records; no reverse-distance or symmetry assumption is applied until the trip calculation rules are confirmed.

## API

For each of `rates`, `wells`, `distances`:

- `GET /api/vms/waybill-masters/{kind}` lists company entries.
- `POST /api/vms/waybill-masters/{kind}` creates an entry.
- `PUT /api/vms/waybill-masters/{kind}/{id}` updates a company entry.

All routes use the existing JWT, tenant context and active-user authorization middleware. Company code is never taken from the request body. These routes inherit the existing VMS authorization model; they do not introduce a separate administrator role.

## Next processing stages

The requested processing stages are not enabled by master setup alone:

- Match waybill destination names to well IDs/cities.
- Group by truck and pickup calendar date to identify multiple drops; more than two drop points require team review.
- Apply standard/non-standard revenue and kilometre rules.
- Produce verification rows containing load number, destination, truck, pickup date, vendor, rig ID, base revenue, kilometre revenue, trip type and chargeable kilometres.

Before calculating bills, confirm which city's rate controls a two-drop trip, how the pair distance combines with actual/base kilometres, where each 15 km deduction applies, whether repeated wells or different wells within one city count as multiple drops, and the Duqm Salt additional local trip rate. The current implementation does not invent these monetary rules.

## Validation

Run `node -r ts-node/register --test tests/waybillMasters.test.cjs` for validation and mocked request-scope checks. These tests do not connect to Oracle. An authenticated tenant smoke test is still required to verify DDL privileges, foreign keys and actual persistence.
