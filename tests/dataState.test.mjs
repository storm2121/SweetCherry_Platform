import test from 'node:test';
import assert from 'node:assert/strict';
import { unavailableWeather, weatherFromPayload, deriveWeatherRisk, normalizeWeatherForecast, weatherLocationQuery, weatherErrorMessage } from '../src/utils/weatherState.js';
import { climateDataState } from '../src/utils/climateState.js';

test('unavailable weather never substitutes sample temperature, humidity or safe advice', () => {
  const state = unavailableWeather();
  assert.equal(state.temperature, null); assert.equal(state.humidity, null);
  assert.equal(state.risk, 'Unavailable'); assert.equal(state.isSample, false);
  assert.equal(weatherFromPayload({}).dataStatus, 'unavailable');
  assert.equal(deriveWeatherRisk({}, {}).code, 'Unavailable');
});

test('partial forecast remains unknown, while real heat and frost are surfaced', () => {
  assert.equal(deriveWeatherRisk({ tempMax: 33 }).code, 'Heat risk');
  assert.equal(deriveWeatherRisk({ tempMin: 0 }).code, 'Frost risk');
  assert.equal(deriveWeatherRisk({ tempMax: 25, tempMin: null, rainChance: 0 }, { rainChance: 0 }).code, 'Unavailable');
  const result = normalizeWeatherForecast([{ day: { totalprecip_mm: 6 } }]);
  assert.equal(result[0].rainChance, null, 'millimetres cannot be converted to chance of rain');
  assert.equal(weatherFromPayload({ current: { temp_c: 18, humidity: 60, last_updated_epoch: 1791100000 } }).asOf, 1791100000000);
});

test('known Moroccan regions resolve to coordinates, avoiding ambiguous town names', () => {
  assert.equal(weatherLocationQuery('آزرو'), '33.43,-5.22');
  assert.equal(weatherLocationQuery('Ifrane'), '33.53,-5.11');
  assert.equal(weatherLocationQuery('el_hajeb'), '33.69,-5.37');
  assert.equal(weatherLocationQuery('صفرو'), '33.83,-4.84');
  assert.equal(weatherLocationQuery('تاونات'), '34.54,-4.64');
  assert.equal(weatherLocationQuery('unknown', 'custom-query'), 'custom-query');
});

test('sample and legacy climate provenance remain distinct from verified available data', () => {
  const sample = climateDataState({ generatedAt: Date.now(), source: 'open-meteo' }, true);
  assert.equal(sample.isSample, true); assert.equal(sample.source, 'sample'); assert.equal(sample.asOf, null);
  const legacy = climateDataState({ generatedAt: 1791124510266 });
  assert.equal(legacy.isSample, null); assert.equal(legacy.dataStatus, 'unverified'); assert.ok(legacy.warning);
  const live = climateDataState({ source: 'open-meteo', isSample: false, asOf: 1791124510266 });
  assert.equal(live.dataStatus, 'available'); assert.equal(live.isSample, false);
});

test('provider errors are readable Arabic and contain no provider detail or credential', () => {
  assert.match(weatherErrorMessage(2006), /خدمة الطقس/);
  assert.match(weatherErrorMessage(1006), /تحديد المنطقة/);
  assert.match(weatherErrorMessage(), /الاتصال/);
});
