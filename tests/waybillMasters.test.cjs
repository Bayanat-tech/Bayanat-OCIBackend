const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateMaster } = require('../src/controllers/vms/waybillMasters.model');

test('master amounts accept zero and decimals and normalize destination identifiers', () => {
  assert.deepEqual(validateMaster('wells', { well_id: '  well   101 ', city: ' muscat ', actual_kms: '0.125' }), {
    well_id: 'WELL 101', city: 'MUSCAT', actual_kms: 0.125,
  });
  assert.equal(validateMaster('distances', { well_id_1: 'A', well_id_2: 'B', distance: 0 }).distance, 0);
});

test('invalid distances cannot silently become zero or be rounded by Oracle', () => {
  for (const distance of ['', ' ', null, true, -1, '1.2345', '100000000000', 'NaN', 'Infinity']) {
    assert.throws(() => validateMaster('distances', { well_id_1: 'A', well_id_2: 'B', distance }));
  }
  assert.throws(() => validateMaster('distances', { well_id_1: ' a ', well_id_2: 'A', distance: 10 }));
});

const calls = [];
let tenant = 'test-tenant';
let result = { rows: [], rowsAffected: 1 };
let queryError;
const queryPath = require.resolve('../src/database/QueryExecutor');
require.cache[queryPath] = { id: queryPath, filename: queryPath, loaded: true, exports: {
  QueryExecutor: { executeRawQuery: async (sql, binds) => { calls.push({ sql, binds }); if (queryError) throw queryError; return result; } },
} };
const contextPath = require.resolve('../src/middleware/tenantContext.middleware');
require.cache[contextPath] = { id: contextPath, filename: contextPath, loaded: true, exports: {
  getCurrentTenantId: () => tenant,
} };
const { deleteWaybillMaster, listWaybillMaster, saveWaybillMaster } = require('../src/controllers/vms/waybillMasters.controller');
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('master handlers enforce company scope for inserts, lists and updates', async () => {
  const req = { user: { company_code: 'OWN', loginid: 'tester' }, body: { company_code: 'OTHER', well_id: 'W1', city: 'CITY', actual_kms: 20 }, params: { id: '42' } };
  let res = response();
  await saveWaybillMaster('wells')(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(calls.at(-1).binds.company_code, 'OWN');
  res = response();
  await listWaybillMaster('wells')(req, res);
  assert.match(calls.at(-1).sql, /m.COMPANY_CODE = :company_code/);
  assert.match(calls.at(-1).sql, /m.ACTUAL_KMS - r.BASE_KMS - 15/);
  result = { rowsAffected: 0 };
  res = response();
  await saveWaybillMaster('wells', true)(req, res);
  assert.equal(res.statusCode, 404);
  assert.match(calls.at(-1).sql, /ID = :id AND COMPANY_CODE = :company_code/);
  const count = calls.length;
  res = response();
  await saveWaybillMaster('wells')({ ...req, user: {} }, res);
  assert.equal(res.statusCode, 403);
  tenant = undefined;
  res = response();
  await listWaybillMaster('wells')(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(calls.length, count);
});

test('delete is company scoped, rejects invalid IDs, and protects dependent masters', async () => {
  tenant = 'test-tenant'; result = { rowsAffected: 1 };
  const req = { user: { company_code: 'OWN' }, params: { id: '42' }, body: { company_code: 'OTHER' } };
  for (const [kind, table] of [['rates', 'VMS_WAYBILL_RATES'], ['wells', 'VMS_WAYBILL_WELLS'], ['distances', 'VMS_WAYBILL_DISTANCES']]) {
    const res = response(); await deleteWaybillMaster(kind)(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.at(-1).sql, `DELETE FROM ${table} WHERE ID = :id AND COMPANY_CODE = :company_code`);
    assert.deepEqual(calls.at(-1).binds, { id: 42, company_code: 'OWN' });
  }
  result = { rowsAffected: 0 };
  let res = response(); await deleteWaybillMaster('wells')(req, res); assert.equal(res.statusCode, 404);
  const count = calls.length;
  for (const id of ['0', '-1', 'abc', '1.5', '9007199254740992']) {
    res = response(); await deleteWaybillMaster('rates')({ ...req, params: { id } }, res); assert.equal(res.statusCode, 400);
  }
  res = response(); await deleteWaybillMaster('rates')({ ...req, user: {} }, res); assert.equal(res.statusCode, 403);
  tenant = undefined;
  res = response(); await deleteWaybillMaster('rates')(req, res); assert.equal(res.statusCode, 403);
  assert.equal(calls.length, count);
  tenant = 'test-tenant'; queryError = { errorNum: 2292 };
  res = response();
  try { await deleteWaybillMaster('rates')(req, res); } finally { queryError = undefined; }
  assert.equal(res.statusCode, 409); assert.match(res.body.message, /dependent master entries/);
});
