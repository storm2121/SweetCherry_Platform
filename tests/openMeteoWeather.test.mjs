import test from 'node:test';
import assert from 'node:assert/strict';
import { openMeteoForecastUrl, weatherCodeLabel, weatherFromOpenMeteo } from '../src/utils/weatherState.js';

const payload = {
  utc_offset_seconds: 3600,
  current: { time: '2026-10-04T19:00', temperature_2m: 18.9, relative_humidity_2m: 54, weather_code: 3, wind_speed_10m: 3.5 },
  daily: {
    time: ['2026-10-04', '2026-10-05', '2026-10-06'],
    temperature_2m_max: [21.7, 23.1, 24],
    temperature_2m_min: [2.5, 9.8, 10.4],
    precipitation_probability_max: [10, 5, 45],
    relative_humidity_2m_mean: [54, 50, 61],
    wind_speed_10m_max: [13.6, 11, 9],
    weather_code: [3, 1, 61],
  },
  hourly: {
    time: ['2026-10-04T06:00', '2026-10-04T12:00', '2026-10-04T18:00'],
    temperature_2m: [9, 19, 18],
    weather_code: [0, 2, 3],
  },
};

test('builds a coordinate request for the region', () => {
  const url = new URL(openMeteoForecastUrl('33.53,-5.11'));
  assert.equal(url.hostname, 'api.open-meteo.com');
  assert.equal(url.searchParams.get('latitude'), '33.53');
  assert.equal(url.searchParams.get('longitude'), '-5.11');
  assert.equal(url.searchParams.get('timezone'), 'Africa/Casablanca');
  assert.equal(openMeteoForecastUrl('ifrane'), null);
});

test('normalizes current conditions, Arabic labels and the local observation time', () => {
  const weather = weatherFromOpenMeteo(payload);
  assert.equal(weather.source, 'open-meteo');
  assert.equal(weather.temperature, 18.9);
  assert.equal(weather.humidity, 54);
  assert.equal(weather.conditionAr, 'غائم');
  assert.equal(weather.asOf, Date.parse('2026-10-04T18:00:00Z'));
  assert.equal(weather.forecast.length, 3);
  assert.equal(weather.forecast[2].conditionAr, 'مطر خفيف');
  assert.deepEqual(weather.forecast[0].hourly.map((hour) => hour.time), ['2026-10-04 06:00', '2026-10-04 12:00', '2026-10-04 18:00']);
});

test('flags frost when tonight drops to 3 °C or below', () => {
  const weather = weatherFromOpenMeteo(payload);
  assert.equal(weather.risk, 'Frost risk');
  assert.equal(weather.dataStatus, 'live');
});

test('reports missing data instead of inventing it', () => {
  assert.equal(weatherFromOpenMeteo({}).dataStatus, 'unavailable');
  const partial = weatherFromOpenMeteo({ ...payload, current: { time: '2026-10-04T19:00' } });
  assert.equal(partial.dataStatus, 'partial');
  assert.equal(weatherCodeLabel(1234), null);
});
