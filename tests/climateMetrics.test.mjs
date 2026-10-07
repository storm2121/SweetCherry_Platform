import test from 'node:test';
import assert from 'node:assert/strict';
import {
  completedSevenDayWindow, scenarioWindowForYear, climateRequestParams,
  summarizeHourlyWindow, summarizeScenarioWindow, shortWindowRisk,
  canonicalRegionId, buildRegionRiskIndex,
} from '../functions/lib/climateMetrics.mjs';

const regions = [
  { id: 'ifrane', name: 'Ifrane', aliases: ['إفران'] },
  { id: 'el_hajeb', name: 'El Hajeb', aliases: ['el hajeb', 'الحاجب'] },
];
const encodeLegacy = (name) => encodeURIComponent(name).replace(/%/g, '_').toLowerCase();
const window = completedSevenDayWindow(new Date('2026-10-04T10:00:00Z'));
const hourlyFixture = () => {
  const time = Array.from({ length: 192 }, (_, i) => new Date(Date.parse('2026-09-27T00:00:00Z') + i * 3600000).toISOString().slice(0, 16));
  return {
    time, temperature_2m: time.map(() => 5), relative_humidity_2m: time.map(() => 60),
    wind_speed_10m: time.map(() => 10), precipitation: time.map((_, i) => i < 168 ? 1 : 100),
  };
};

test('uses seven completed Moroccan local days, excluding the current day', () => {
  assert.equal(window.startDate, '2026-09-27');
  assert.equal(window.endDate, '2026-10-03');
  const summary = summarizeHourlyWindow(hourlyFixture(), window);
  assert.equal(summary.rainfall7d, 168);
  assert.equal(summary.chillHours, 168);
  assert.equal(summary.seasonalChillHours, null);
  // A past instant: Morocco was on UTC+1 in October 2024 in every time-zone
  // database, whereas future offsets change with updates.
  const afterLocalMidnight = completedSevenDayWindow(new Date('2024-10-03T23:30:00Z'));
  assert.equal(afterLocalMidnight.endDate, '2024-10-03');
});

test('rejects missing dates and null values instead of treating them as zero rainfall/chill', () => {
  const missing = hourlyFixture(); missing.time = missing.time.slice(24);
  assert.throws(() => summarizeHourlyWindow(missing, window), /Incomplete/);
  const gap = hourlyFixture(); gap.precipitation[42] = null;
  assert.throws(() => summarizeHourlyWindow(gap, window), /Incomplete weather metric/);
});

test('requests supported climate model and explicit matching dates across year boundaries', () => {
  const params = climateRequestParams({ centroid: { lat: 33.53, lon: -5.11 } }, 2030, window);
  assert.equal(params.get('models'), 'MPI_ESM1_2_XR');
  assert.equal(params.get('start_date'), '2030-09-27');
  assert.equal(params.get('end_date'), '2030-10-03');
  assert.equal(params.has('start_year'), false);
  const crossYear = scenarioWindowForYear({ ...window, endDate: '2026-01-02' }, 2030);
  assert.equal(crossYear.startDate, '2029-12-27');
  const leap = scenarioWindowForYear({ ...window, endDate: '2028-02-29' }, 2030);
  assert.equal(leap.endDate, '2030-02-28');
});

test('scenario totals cover exactly requested dates; no invented hourly chill from daily values', () => {
  const futureWindow = scenarioWindowForYear(window, 2030);
  const daily = {
    time: Array.from({ length: 7 }, (_, i) => `2030-${i < 4 ? '09-' + (27 + i) : '10-0' + (i - 3)}`),
    temperature_2m_max: [25, 26, 27, 28, 29, 30, 31],
    temperature_2m_min: [8, 7, 6, 5, 4, 3, 2], precipitation_sum: [1, 2, 3, 4, 5, 6, 7],
  };
  const result = summarizeScenarioWindow(daily, futureWindow);
  assert.equal(result.rainfall7d, 28); assert.equal(result.tempMax, 31); assert.equal(result.tempMin, 2);
  assert.equal(result.chillHours, null);
  assert.throws(() => summarizeScenarioWindow({ ...daily, time: daily.time.slice(1) }, futureWindow), /requested/);
});

test('seven-day chill cannot produce a seasonal deficit or cultivar verdict', () => {
  const region = { rainTarget: 40, chillTarget: 900 };
  const stats = { tempMax: 25, rainfall7d: 30, chillHours: 0 };
  const first = shortWindowRisk(region, stats);
  assert.deepEqual(first, shortWindowRisk(region, { ...stats, chillHours: 168 }));
  assert.equal(first.chillRatio, null); assert.equal(first.rating, 'غير محسوم');
});

test('joins canonical, English and legacy encoded Arabic IDs without rewriting stored IDs', () => {
  assert.equal(canonicalRegionId(encodeLegacy('إفران'), regions), 'ifrane');
  assert.equal(canonicalRegionId('El-Hajeb', regions), 'el_hajeb');
  const index = buildRegionRiskIndex([{ regionId: 'ifrane', score: 0.3 }, { regionId: 'el_hajeb', score: 0.6 }], regions);
  assert.equal(index.get(encodeLegacy('إفران')), 0.3);
  assert.equal(index.get(encodeLegacy('الحاجب')), 0.6);
  assert.equal(index.get('ifrane'), 0.3);
  assert.equal(canonicalRegionId('unknown', regions), null);
  assert.equal(buildRegionRiskIndex([{ regionId: 'ifrane', score: null }], regions).size, 0);
});
