import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { read, utils } from 'xlsx';
import {
  normalizeForecastDate, normalizeForecastRow, normalizeHorizon, validateForecastRows,
  selectForecastRows, indexPriceObservations, observationKey, summarizeObservations,
  comparePriceObservation, timestampMillis,
} from '../forecastData.js';

const sample = (overrides = {}) => ({
  date: '2026-10-12', market: 'M01', low: 20, expected: 25, high: 30,
  horizonType: 'short_term', horizon: '1w', ...overrides,
});

test('valid finite quantiles retain order, aliases and zero bounds', () => {
  assert.deepEqual(normalizeForecastRow({
    Date: '2026-10-12', Market: ' m01 ', 'Low (P10)': '0', 'Expected (P50)': '25',
    'High (P90)': '30', 'Horizon Type': 'long_range', Horizon: '9w',
  }), sample({ low: 0, horizonType: 'medium_term', horizon: '9w' }));
});

test('rejects malformed, nonfinite, negative and crossed prices without repairing them', () => {
  for (const overrides of [
    { expected: Infinity }, { expected: '25invalid' }, { expected: '' }, { expected: null },
    { low: 26 }, { high: 24 }, { low: NaN }, { high: -1 }, { expected: -4 },
    { low: true }, { market: '' }, { date: '2026-02-30' },
  ]) assert.equal(normalizeForecastRow(sample(overrides)), null);
});

test('missing quantiles stay null rather than inventing a zero-width interval', () => {
  assert.deepEqual(normalizeForecastRow(sample({ low: null, high: undefined })),
    sample({ low: null, high: null }));
  const result = validateForecastRows([sample(), sample({ high: null }), sample({ low: 26 })]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rejectedCount, 1);
  assert.equal(result.incompleteIntervalCount, 1);
});

test('all three lead-time ranges and legacy calendar years normalize consistently', () => {
  for (const value of ['1w', '8 weeks', '1–8w']) assert.equal(normalizeHorizon(value)?.horizonType, 'short_term');
  for (const value of ['9w', '52 weeks', '9-52w']) assert.equal(normalizeHorizon(value)?.horizonType, 'medium_term');
  for (const value of ['1y', '5 years', '1–5y', '2027']) assert.equal(normalizeHorizon(value)?.horizonType, 'long_range');
  for (const value of ['0w', '53w', '8-9w', '6y', '5-1y', 'unknown']) assert.equal(normalizeHorizon(value), null);
  assert.deepEqual(normalizeHorizon('', 'long-range'), { horizon: '', horizonType: 'long_range' });
  assert.equal(normalizeHorizon('', ''), null);
});

test('strict calendar dates handle Excel dates without accepting rollover or invalid Date', () => {
  assert.equal(normalizeForecastDate(25569), '1970-01-01');
  assert.equal(normalizeForecastDate('2024-02-29'), '2024-02-29');
  assert.equal(normalizeForecastDate('2026-02-29'), null);
  assert.equal(normalizeForecastDate(new Date('invalid')), null);
  assert.equal(normalizeForecastDate(Infinity), null);
});

test('chart and table can consume the same selected market/horizon rows', () => {
  const { rows } = validateForecastRows([
    sample(), sample({ market: 'M02' }), sample({ horizon: '12w' }), sample({ horizon: '2027' }),
  ]);
  const selected = selectForecastRows(rows, 'M01', 'medium_term');
  assert.equal(selected.length, 1);
  assert.equal(selected[0].horizon, '12w');
  assert.equal(selectForecastRows(rows, 'M01').length, 3);
});

test('observations require an explicit matching market, grade and date', () => {
  const indexed = indexPriceObservations([
    { quality: 'A', market: 'M01', date: '2026-10-12', price: '19' },
    { quality: 'A', market: 'M02', date: '2026-10-12', price: 100 },
    { quality: 'AA', market: 'M01', date: '2026-10-12', price: 90 },
    { quality: 'A', region: 'M01', date: '2026-10-12', price: 80 },
    { quality: 'A', market: 'M01', date: '2026-10-13', price: 50 },
    { quality: 'A', market: 'M01', date: '2026-10-12', price: Infinity },
  ], 'A');
  assert.equal(indexed.unscopedCount, 2);
  const matched = indexed.observations.get(observationKey('M01', '2026-10-12'));
  assert.equal(matched.length, 1);
  assert.equal(summarizeObservations(sample(), matched).average, 19);
});

test('outside-band observations are descriptive, and missing bands cannot flag them', () => {
  assert.equal(comparePriceObservation(sample(), 20), 'within');
  assert.equal(comparePriceObservation(sample(), 30), 'within');
  assert.equal(comparePriceObservation(sample(), 19), 'below');
  assert.equal(comparePriceObservation(sample(), 31), 'above');
  assert.equal(comparePriceObservation(sample({ low: null }), 19), 'no_interval');
  assert.equal(comparePriceObservation(sample(), NaN), null);
  assert.equal(summarizeObservations(sample(), [{ price: 19 }, { price: 31 }]).outsideCount, 2);
});

test('upload timestamps handle supported Firestore and ordinary representations', () => {
  assert.equal(timestampMillis({ seconds: 100 }), 100000);
  assert.equal(timestampMillis({ toMillis: () => 100000 }), 100000);
  assert.equal(timestampMillis(new Date(100000)), 100000);
  assert.equal(timestampMillis(100000), 100000);
  assert.equal(timestampMillis('invalid'), null);
  assert.equal(timestampMillis(null), null);
});


// The instant is in the past on purpose: Morocco was on UTC+1 in October 2024
// in every time-zone database, whereas future offsets change with updates.
test('timestamp observations use Moroccan dates and do not replace corrupt explicit dates', () => {
  const indexed = indexPriceObservations([
    { quality: 'A', market: 'M01', createdAt: Date.parse('2024-10-11T23:30:00Z'), price: 25 },
    { quality: 'A', market: 'M01', date: 'invalid', createdAt: Date.parse('2024-10-11T23:30:00Z'), price: 29 },
  ], 'A');
  assert.equal(indexed.observations.get(observationKey('M01', '2024-10-12')).length, 1);
  assert.equal(indexed.unscopedCount, 1);
});

// --- Contract: the generated SIMULATED forecast sample goes through the same
// parsing and validation as an admin upload (src/services/forecastService.js).

const SAMPLES = new URL('../../../forecasting/samples/', import.meta.url);
const FORECAST_XLSX = new URL('sweetcherry_forecast_SIMULATED_2026-05-24.xlsx', SAMPLES);
const FORECAST_JSON = new URL('sweetcherry_forecast_SIMULATED_2026-05-24.json', SAMPLES);
const GRADE_LIST = ['A', 'AA', 'AAA'];

const workbook = () => read(readFileSync(FORECAST_XLSX), { type: 'buffer', cellDates: true });
const gradeSheet = (book, grade) => book.SheetNames.find((name) => name.trim().toUpperCase() === `GRADE ${grade}`);

test('the simulated forecast workbook passes the upload validator with nothing rejected', () => {
  const book = workbook();
  assert.deepEqual(book.SheetNames, ['Grade A', 'Grade AA', 'Grade AAA', 'About']);
  for (const grade of GRADE_LIST) {
    const raw = utils.sheet_to_json(book.Sheets[gradeSheet(book, grade)], { defval: null });
    const { rows, rejectedCount, incompleteIntervalCount } = validateForecastRows(raw);
    assert.equal(rejectedCount, 0, `${grade}: rejected rows`);
    assert.equal(incompleteIntervalCount, 0, `${grade}: rows without P10 or P90`);
    assert.equal(rows.length, raw.length);
    assert.ok(rows.length > 0, `${grade}: no rows`);
    for (const row of rows) {
      assert.equal(row.horizonType, 'short_term');
      assert.match(row.horizon, /^[1-8]w$/);
      assert.ok(['M01', 'M02', 'M03'].includes(row.market));
      assert.ok(Number.isFinite(row.low) && row.low >= 0 && row.low <= row.expected && row.expected <= row.high);
      assert.ok(row.date > '2026-05-24', `${row.date} is not after the cutoff`);
    }
  }
});

test('the About sheet carries the synthetic provenance as key/value rows', () => {
  const book = workbook();
  const pairs = Object.fromEntries(
    utils.sheet_to_json(book.Sheets.About, { header: 1, defval: null })
      .filter((row) => typeof row[0] === 'string' && row[1] !== null)
      .map((row) => [row[0], String(row[1])]),
  );
  assert.equal(pairs.provenance, 'synthetic');
  assert.equal(pairs.dataCutoff, '2026-05-24');
  assert.equal(pairs.sourceName, 'Synthetic market simulation');
  assert.match(pairs.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.match(pairs.modelVersion, /\S/);
  assert.match(pairs.seed, /^\d+$/);
});

test('the JSON export holds the same rows and provenance as the workbook', () => {
  const payload = JSON.parse(readFileSync(FORECAST_JSON, 'utf8'));
  const book = workbook();
  assert.equal(payload.about.provenance, 'synthetic');
  assert.equal(payload.about.dataCutoff, '2026-05-24');
  for (const grade of GRADE_LIST) {
    const fromJson = validateForecastRows(payload.grades[grade]);
    const fromSheet = validateForecastRows(utils.sheet_to_json(book.Sheets[gradeSheet(book, grade)], { defval: null }));
    assert.equal(fromJson.rejectedCount, 0);
    assert.deepEqual(fromJson.rows, fromSheet.rows);
  }
});
