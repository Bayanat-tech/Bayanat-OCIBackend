const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateRevenue, pickupDay, emptyBillingSettings, validateBillingSettings } = require('../src/controllers/vms/waybillBilling.engine');
const waybill = (id = 1, overrides = {}) => ({ id, waybill_load_number: `LOAD-${id}`, destination_name: 'W1', scheduled_vehicle: 'TRUCK 1', pickup_date: '15/09/2026 08:00:00', vendor_name: 'VENDOR', rig_id: 'RIG', ...overrides });
const wells = [{ well_id: 'W1', city: 'A', actual_kms: 150 }, { well_id: 'W2', city: 'B', actual_kms: 200 }, { well_id: 'W3', city: 'A', actual_kms: 160 }];
const rates = [
  { city: 'A', base_kms: 100, standard_revenue: 100, non_standard_revenue: 80, standard_kms_charge: 2, non_standard_kms_charge: 3 },
  { city: 'B', base_kms: 100, standard_revenue: 120, non_standard_revenue: 90, standard_kms_charge: 2, non_standard_kms_charge: 4 },
];
const distances = [{ well_id_1: 'W1', well_id_2: 'W2', distance: 40 }, { well_id_1: 'W1', well_id_2: 'W3', distance: 30 }];
const settings = { ...emptyBillingSettings, non_standard_base: 'ONCE_PER_TRUCK_DAY', rate_city: 'FARTHEST_WELL', non_standard_kms: 'DIVERSION_PLUS_PAIR' };
const run = (rows, config = settings, w = wells, r = rates, d = distances) => calculateRevenue(rows, w, r, d, config);

test('Step 1/3/5: standard trip matches normalized destination and deducts 15 only once', () => {
  const [row] = run([waybill(1, { destination_name: ' w1 ' })], emptyBillingSettings);
  assert.equal(row.city, 'A'); assert.equal(row.trip_type, 'STANDARD');
  assert.equal(row.base_revenue, 100); assert.equal(row.kms_chargeable, 35);
  assert.equal(row.kms_revenue, 70); assert.equal(row.total_revenue, 170); assert.equal(row.status, 'READY');
});
test('Negative diversion floors at zero, and explicit zero rates are valid', () => {
  const [row] = run([waybill()], settings, [{ ...wells[0], actual_kms: 110 }], [{ ...rates[0], standard_revenue: 0, standard_kms_charge: 0 }]);
  assert.equal(row.kms_chargeable, 0); assert.equal(row.total_revenue, 0); assert.equal(row.status, 'READY');
});
test('Step 2/4/6: same truck and calendar date group across timestamps and date formats', () => {
  const result = run([waybill(), waybill(2, { destination_name: 'W2', scheduled_vehicle: ' truck   1 ', pickup_date: '2026-09-15T19:00:00' })]);
  assert.ok(result.every((row) => row.trip_type === 'NON_STANDARD' && row.drop_count === 2));
  assert.equal(result[0].group_key, result[1].group_key);
  assert.equal(result[0].base_revenue, 0); assert.equal(result[0].kms_revenue, 0);
  assert.equal(result[1].base_revenue, 90); assert.equal(result[1].kms_chargeable, 110); // 200-100-15 + 40-15
  assert.equal(result[1].kms_revenue, 440);
  assert.equal(result.reduce((total, row) => total + row.total_revenue, 0), 530);
});
test('Configurable per-waybill base rates and pair-only Kms allocate shared distance once', () => {
  const result = run([waybill(), waybill(2, { destination_name: 'W2' })], { ...settings, non_standard_base: 'PER_WAYBILL', non_standard_kms: 'PAIR_ONLY' });
  assert.deepEqual(result.map((row) => row.base_revenue), [80, 90]);
  assert.deepEqual(result.map((row) => row.kms_revenue), [0, 100]);
});
test('Highest-rate selection can differ from farthest-well selection', () => {
  const result = run([waybill(), waybill(2, { destination_name: 'W2' })], { ...settings, rate_city: 'HIGHEST_NON_STANDARD_RATE', non_standard_kms: 'PAIR_ONLY' }, wells, [{ ...rates[0], non_standard_revenue: 110 }, rates[1]]);
  assert.deepEqual(result.map((row) => row.base_revenue), [110, 0]);
  assert.deepEqual(result.map((row) => row.kms_revenue), [75, 0]);
});
test('Different wells in the same city count as drops; another day/truck is a separate group', () => {
  const rows = run([waybill(), waybill(2, { destination_name: 'W3' }), waybill(3, { pickup_date: '16/09/2026' }), waybill(4, { scheduled_vehicle: 'TRUCK 2' })]);
  assert.deepEqual(rows.map((row) => row.trip_type), ['NON_STANDARD', 'NON_STANDARD', 'STANDARD', 'STANDARD']);
});
test('Missing destinations, rates, pair distances and unset rules require review, never zero billing', () => {
  const variants = [
    run([waybill(1, { destination_name: 'UNKNOWN' })]),
    run([waybill()], settings, wells, []),
    run([waybill(), waybill(2, { destination_name: 'W2' })], settings, wells, rates, []),
    run([waybill(), waybill(2, { destination_name: 'W2' })], emptyBillingSettings),
  ];
  for (const rows of variants) for (const row of rows) { assert.equal(row.status, 'NEEDS_REVIEW'); assert.equal(row.total_revenue, null); }
});
test('More than two drops, mixed vendors and duplicate load/destination require team review', () => {
  for (const input of [
    [waybill(), waybill(2, { destination_name: 'W2' }), waybill(3, { destination_name: 'W3' })],
    [waybill(), waybill(2, { vendor_name: 'OTHER' })],
    [waybill(), waybill(2, { waybill_load_number: 'LOAD-1' })],
  ]) assert.ok(run(input).every((row) => row.status === 'NEEDS_REVIEW' && row.total_revenue === null));
});
test('Same well with distinct loads stays standard; duplicate detection ignores case/space', () => {
  assert.ok(run([waybill(), waybill(2)]).every((row) => row.trip_type === 'STANDARD' && row.status === 'READY'));
  assert.ok(run([waybill(), waybill(2, { waybill_load_number: ' load-1 ', destination_name: ' w1 ' })]).every((row) => row.status === 'NEEDS_REVIEW'));
});
test('Reverse distance is usable only when unambiguous', () => {
  const input = [waybill(), waybill(2, { destination_name: 'W2' })];
  const reversed = { well_id_1: 'W2', well_id_2: 'W1', distance: 40 };
  assert.ok(run(input, settings, wells, rates, [reversed]).every((row) => row.status === 'READY'));
  assert.ok(run(input, settings, wells, rates, [distances[0], { ...reversed, distance: 50 }]).every((row) => row.status === 'NEEDS_REVIEW'));
});
test('Duqm Salt extra local charge uses configured amount and frequency; absent config blocks billing', () => {
  const input = [waybill(1, { vendor_name: ' duqm salt ' }), waybill(2, { vendor_name: 'DUQM SALT' })];
  assert.ok(run(input).every((row) => row.status === 'NEEDS_REVIEW'));
  assert.deepEqual(run(input, { ...settings, duqm_local_charge: 25, duqm_frequency: 'ONCE_PER_TRUCK_DAY' }).map((row) => row.local_trip_revenue), [25, 0]);
  assert.deepEqual(run(input, { ...settings, duqm_local_charge: 25, duqm_frequency: 'PER_WAYBILL' }).map((row) => row.local_trip_revenue), [25, 25]);
});
test('Dates validate calendar days without timezone conversion or two-digit year guessing', () => {
  assert.equal(pickupDay('29/02/2024'), '2024-02-29'); assert.equal(pickupDay('2026-09-15T23:30:00-04:00'), '2026-09-15');
  for (const invalid of ['29/02/2025', '31/04/2026', '1/1/26', '2026-13-01', '15/09/2026 24:00', 'bad']) assert.equal(pickupDay(invalid), null);
  assert.equal(run([waybill(1, { pickup_date: 'bad' })])[0].trip_type, 'UNCLASSIFIED');
});
test('Source fingerprints are deterministic and change when peer waybills or rates change', () => {
  const a = run([waybill()])[0].source_hash;
  assert.equal(run([waybill()])[0].source_hash, a);
  assert.notEqual(run([waybill(), waybill(2)])[0].source_hash, a);
  assert.notEqual(run([waybill()], settings, wells, [{ ...rates[0], standard_revenue: 101 }, rates[1]])[0].source_hash, a);
});
test('Decimal rates round half-up to three decimals and excessive revenue is flagged', () => {
  const [row] = run([waybill()], settings, [{ ...wells[0], actual_kms: 115.005 }], [{ ...rates[0], standard_kms_charge: 0.3 }]);
  assert.equal(row.kms_chargeable, 0.005); assert.equal(row.kms_revenue, 0.002);
  assert.equal(run([waybill()], settings, wells, [{ ...rates[0], standard_kms_charge: 99999999999 }])[0].status, 'NEEDS_REVIEW');
});
test('Settings reject invented rule values and negative local rates', () => {
  assert.throws(() => validateBillingSettings({ non_standard_base: 'UNKNOWN' }));
  assert.throws(() => validateBillingSettings({ duqm_local_charge: -1 }));
  assert.deepEqual(validateBillingSettings({}), emptyBillingSettings);
});
