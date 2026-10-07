import test from 'node:test';
import assert from 'node:assert/strict';
import { GROWING_REGIONS } from '../src/data/growingRegions.js';
import { conditionLabel, regionsForecastUrl, regionsFromOpenMeteo } from '../src/utils/regionsWeather.js';
import { addDays, monthStarts, niceScale, seriesEnd, weekContaining, weeklySeries } from '../src/utils/landingForecast.js';

const location = (overrides = {}) => ({
  elevation: 1650,
  current: { time: '2026-10-04T18:15', temperature_2m: 17.4, weather_code: 2 },
  daily: {
    time: ['2026-10-04', '2026-10-05', '2026-10-06'],
    weather_code: [2, 61, 3],
    temperature_2m_max: [21.7, 19, 18.2],
    temperature_2m_min: [6.1, 7.4, 2.5],
    precipitation_probability_max: [10, 55, 20],
  },
  ...overrides,
});

test('asks for all five areas in one request, in region order', () => {
  const url = new URL(regionsForecastUrl());
  assert.equal(url.hostname, 'api.open-meteo.com');
  assert.equal(url.searchParams.get('latitude'), GROWING_REGIONS.map((region) => region.lat).join(','));
  assert.equal(url.searchParams.get('longitude'), GROWING_REGIONS.map((region) => region.lon).join(','));
  assert.equal(url.searchParams.get('forecast_days'), '3');
  assert.equal(url.searchParams.get('timezone'), 'Africa/Casablanca');
});

test('pairs each response entry with its region and keeps three days', () => {
  const payload = GROWING_REGIONS.map((_, index) => location({ elevation: 600 + index * 100 }));
  const regions = regionsFromOpenMeteo(payload);
  assert.equal(regions.length, 5);
  assert.equal(regions[2].id, 'ifrane');
  assert.equal(regions[2].elevation, 800);
  assert.equal(regions[0].temperature, 17.4);
  assert.equal(regions[0].time, '2026-10-04T18:15');
  assert.deepEqual(regions[0].days[1], {
    date: '2026-10-05', max: 19, min: 7.4, rainChance: 55, code: 61, frost: false, heat: false, wet: true,
  });
  // 2.5 °C is inside the app's frost limit (3 °C or below).
  assert.equal(regions[0].days[2].frost, true);
});

test('flags heat per day and leaves gaps as null', () => {
  const hot = location({ daily: { ...location().daily, temperature_2m_max: [32, 31.9, 35] } });
  const empty = location({ current: {}, daily: {} });
  const regions = regionsFromOpenMeteo([hot, empty, hot, hot, hot]);
  assert.deepEqual(regions[0].days.map((day) => day.heat), [true, false, true]);
  assert.equal(regions[1].temperature, null);
  assert.equal(regions[1].elevation, 1650);
  assert.deepEqual(regions[1].days, []);
  const gap = location({ daily: { ...location().daily, temperature_2m_min: [null, 4, 5] } });
  assert.equal(regionsFromOpenMeteo([gap, gap, gap, gap, gap])[0].days[0].frost, false);
});

test('refuses a response that cannot be matched to the regions', () => {
  assert.deepEqual(regionsFromOpenMeteo(location()), []);
  assert.deepEqual(regionsFromOpenMeteo([location(), location()]), []);
  assert.deepEqual(regionsFromOpenMeteo(null), []);
});

test('labels weather codes in both languages', () => {
  assert.equal(conditionLabel(2, 'ar'), 'غائم جزئياً');
  assert.equal(conditionLabel(2, 'en'), 'Partly cloudy');
  assert.equal(conditionLabel(1234, 'en'), null);
});

const row = (date, expected, extra = {}) => ({
  date, market: 'M01', low: expected - 1, expected, high: expected + 1, horizonType: 'medium_term', horizon: '9w', ...extra,
});

test('builds one weekly series per market without the long-range rows', () => {
  const rows = [
    row('2026-02-08', 30, { horizonType: 'short_term', horizon: '2w' }),
    row('2026-02-01', 29, { horizonType: 'short_term', horizon: '1w' }),
    row('2026-02-01', 99, { market: 'M02' }),
    row('2026-02-01', 50, { horizonType: 'long_range', horizon: '2026' }),
    row('2026-03-29', 22),
  ];
  assert.deepEqual(weeklySeries(rows, 'M01').map((entry) => entry.expected), [29, 30, 22]);
  assert.deepEqual(weeklySeries(rows, 'M03'), []);
});

test('finds the week that contains a date', () => {
  const series = [row('2026-09-27', 26), row('2026-10-04', 27), row('2026-10-11', 28)];
  assert.equal(weekContaining(series, '2026-10-04').expected, 27);
  assert.equal(weekContaining(series, '2026-10-10').expected, 27);
  assert.equal(weekContaining(series, '2026-10-17').expected, 28);
  assert.equal(weekContaining(series, '2026-10-18'), null);
  assert.equal(weekContaining(series, '2026-09-01'), null);
  assert.equal(weekContaining([], '2026-10-04'), null);
  assert.equal(seriesEnd(series), '2026-10-18');
});

test('rounds the price axis to readable steps', () => {
  assert.deepEqual(niceScale(18.08, 31.62, 4), { lo: 15, hi: 35, step: 5, ticks: [15, 20, 25, 30, 35] });
  assert.deepEqual(niceScale(84.33, 152.95, 4).ticks, [80, 100, 120, 140, 160]);
  assert.equal(niceScale(Number.NaN, 3), null);
  assert.ok(niceScale(5, 5).hi > 5);
});

test('lists month starts for the time axis', () => {
  assert.deepEqual(monthStarts('2026-02-01', '2026-05-10'), ['2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01']);
  assert.deepEqual(monthStarts('2026-11-16', '2027-01-31'), ['2026-12-01', '2027-01-01']);
  assert.equal(addDays('2026-12-28', 7), '2027-01-04');
});
