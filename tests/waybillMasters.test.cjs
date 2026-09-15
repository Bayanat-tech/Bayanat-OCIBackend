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
const queryPath = require.resolve('../src/database/QueryExecutor');
require.cache[queryPath] = { id: queryPath, filename: queryPath, loaded: true, exports: {
  QueryExecutor: { executeRawQuery: async (sql, binds) => { calls.push({ sql, binds }); return result; } },
} };
const contextPath = require.resolve('../src/middleware/tenantContext.middleware');
require.cache[contextPath] = { id: contextPath, filename: contextPath, loaded: true, exports: {
  getCurrentTenantId: () => tenant,
} };
const { listWaybillMaster, saveWaybillMaster } = require('../src/controllers/vms/waybillMasters.controller');
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
