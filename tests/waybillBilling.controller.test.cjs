const { test } = require('node:test');
const assert = require('node:assert/strict');
const { emptyBillingSettings } = require('../src/controllers/vms/waybillBilling.engine');
const stub = (path, exports) => { const id = require.resolve(path); require.cache[id] = { id, filename: id, loaded: true, exports }; };
let tenant = 'tenant-1';
let commits = 0;
let rollbacks = 0;
let failAudit = false;
let config = JSON.stringify(emptyBillingSettings);
let persisted = new Map();
let calls = [];
let revenue = 100;
const source = { ID: 1, WAYBILL_LOAD_NUMBER: 'L1', DESTINATION_NAME: 'W1', SCHEDULED_VEHICLE: 'T1', PICKUP_DATE: '15/09/2026', VENDOR_NAME: 'VENDOR', RIG_ID: 'R1' };
stub('../src/middleware/tenantContext.middleware', { getCurrentTenantId: () => tenant });
stub('../src/controllers/vms/waybillMasters.controller', { ensureMasterTables: async () => {} });
stub('../src/controllers/vms/waybill.controller', { ensureWaybillTable: async () => {} });
stub('../src/database/QueryExecutor', { QueryExecutor: { executeRawQuery: async () => ({ rows: [] }) } });
stub('../src/database/TenantManager', { TenantManager: { getConnection: async () => {
  let transactionRows = new Map(persisted);
  let transactionConfig = config;
  return {
    execute: async (sql, binds) => {
      calls.push({ sql, binds });
      if (/^SET TRANSACTION/.test(sql)) return {};
      assert.equal(binds.company, 'OWN', `Query must use authenticated company: ${sql}`);
      if (sql.includes('FROM VMS_WAYBILL_REQUESTS')) return { rows: [source] };
      if (sql.includes('FROM VMS_WAYBILL_WELLS')) return { rows: [{ WELL_ID: 'W1', CITY: 'A', ACTUAL_KMS: 150 }] };
      if (sql.includes('FROM VMS_WAYBILL_RATES')) return { rows: [{ CITY: 'A', BASE_KMS: 100, STANDARD_REVENUE: revenue, NON_STANDARD_REVENUE: 80, STANDARD_KMS_CHARGE: 2, NON_STANDARD_KMS_CHARGE: 3 }] };
      if (sql.includes('FROM VMS_WAYBILL_DISTANCES')) return { rows: [] };
      if (sql.startsWith('SELECT SETTINGS_JSON')) return { rows: [{ SETTINGS_JSON: transactionConfig }] };
      if (sql.startsWith('SELECT RESULT_JSON')) return { rows: [...transactionRows.values()].map((row) => ({ RESULT_JSON: JSON.stringify(row) })) };
      if (sql.startsWith('MERGE INTO')) { transactionRows.set(binds.id, JSON.parse(binds.result_json.val)); return { rowsAffected: 1 }; }
      if (sql.startsWith('UPDATE VMS_WAYBILL_BILLING_CONFIG')) { transactionConfig = binds.settings; return { rowsAffected: 1 }; }
      if (sql.startsWith('INSERT INTO VMS_WAYBILL_REVENUE_AUDIT') && failAudit) throw new Error('Simulated audit failure');
      return { rows: [] };
    },
    commit: async () => { persisted = transactionRows; config = transactionConfig; commits++; },
    rollback: async () => { rollbacks++; }, close: async () => {},
  };
} } });
const handlers = require('../src/controllers/vms/waybillBilling.controller');
const request = (body = {}, id = '1') => ({ user: { company_code: 'OWN', loginid: 'reviewer' }, body: { company_code: 'OTHER', ...body }, params: { id } });
async function call(handler, req = request()) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler(req, res); return res;
}

test('Processing is company-scoped, transactional, repeatable, and preserves unchanged verification', async () => {
  let response = await call(handlers.getWaybillBilling);
  assert.equal(response.body.data.rows[0].processed, false);
  response = await call(handlers.processWaybillBilling);
  assert.equal(response.statusCode, 200); assert.equal(response.body.data.updated, 1);
  assert.equal(persisted.size, 1); assert.equal(persisted.get(1).total_revenue, 170);
  response = await call(handlers.processWaybillBilling);
  assert.equal(response.body.data.updated, 0); assert.equal(persisted.size, 1);
  let row = (await call(handlers.getWaybillBilling)).body.data.rows[0];
  response = await call(handlers.reviewWaybillRevenue, request({ mode: 'verify', source_hash: row.source_hash, review_token: row.review_token }));
  assert.equal(response.statusCode, 200); assert.equal(persisted.get(1).status, 'VERIFIED');
  await call(handlers.processWaybillBilling);
  assert.equal(persisted.get(1).status, 'VERIFIED');
  // An old open review cannot overwrite another reviewer even when source data is unchanged.
  response = await call(handlers.reviewWaybillRevenue, request({ mode: 'verify', source_hash: row.source_hash, review_token: row.review_token }));
  assert.equal(response.statusCode, 409);
  row = (await call(handlers.getWaybillBilling)).body.data.rows[0];
  revenue = 125;
  response = await call(handlers.getWaybillBilling);
  assert.equal(response.body.data.rows[0].stale, true); assert.equal(response.body.data.rows[0].processed, false);
  response = await call(handlers.reviewWaybillRevenue, request({ mode: 'verify', source_hash: row.source_hash, review_token: row.review_token }));
  assert.equal(response.statusCode, 409);
  await call(handlers.processWaybillBilling);
  assert.equal(persisted.get(1).status, 'READY'); assert.equal(persisted.get(1).total_revenue, 195);
  assert.ok(calls.some(({ sql }) => sql.includes('FOR UPDATE')));
});

test('Manual exceptions require a reason, save all row allocations, and record the reviewer', async () => {
  const row = (await call(handlers.getWaybillBilling)).body.data.rows[0];
  const payload = { mode: 'manual', source_hash: row.source_hash, review_token: row.review_token, base_revenue: '50', kms_revenue: '12.500', kms_chargeable: '5', local_trip_revenue: '25' };
  assert.equal((await call(handlers.reviewWaybillRevenue, request(payload))).statusCode, 400);
  let response = await call(handlers.reviewWaybillRevenue, request({ ...payload, review_note: 'Agreed shared trip allocation' }));
  assert.equal(response.statusCode, 200); assert.equal(persisted.get(1).total_revenue, 87.5);
  assert.equal(persisted.get(1).reviewed_by, 'reviewer'); assert.equal(persisted.get(1).status, 'MANUAL_VERIFIED');
  await call(handlers.processWaybillBilling);
  assert.equal(persisted.get(1).status, 'MANUAL_VERIFIED');
  assert.equal((await call(handlers.reviewWaybillRevenue, request({}, '999'))).statusCode, 404);
});

test('Failed auditing rolls back the whole processing operation', async () => {
  revenue = 130; failAudit = true;
  const before = JSON.stringify([...persisted]);
  const oldError = console.error; console.error = () => {};
  let response;
  try { response = await call(handlers.processWaybillBilling); } finally { console.error = oldError; failAudit = false; }
  assert.equal(response.statusCode, 500); assert.equal(JSON.stringify([...persisted]), before); assert.ok(rollbacks > 0);
});

test('Settings validate input, persist explicit zero charge, and missing scope never reaches database', async () => {
  assert.equal((await call(handlers.saveWaybillBillingSettings, request({ duqm_local_charge: -1 }))).statusCode, 400);
  assert.equal((await call(handlers.saveWaybillBillingSettings, request({ duqm_local_charge: 0, duqm_frequency: 'ONCE_PER_TRUCK_DAY' }))).statusCode, 200);
  assert.equal(JSON.parse(config).duqm_local_charge, 0);
  const count = calls.length;
  assert.equal((await call(handlers.processWaybillBilling, { ...request(), user: {} })).statusCode, 403);
  tenant = undefined;
  assert.equal((await call(handlers.getWaybillBilling)).statusCode, 403);
  assert.equal(calls.length, count); assert.ok(commits > 0);
});
