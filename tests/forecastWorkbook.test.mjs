import assert from 'node:assert/strict';
import test from 'node:test';
import { utils } from 'xlsx';
import { parseForecastWorkbook } from '../src/utils/forecastWorkbook.js';

const forecast = { Date:'2026-05-25', Market:'M01', 'Low (P10)':25, 'Expected (P50)':30, 'High (P90)':38, 'Horizon Type':'short_term', Horizon:'1w' };
const makeWorkbook = () => {
  const workbook = utils.book_new();
  for (const grade of ['A','AA','AAA']) utils.book_append_sheet(workbook,utils.json_to_sheet([forecast]),'Grade '+grade);
  utils.book_append_sheet(workbook,utils.aoa_to_sheet([
    ['SIMULATED DATA','Generated for demonstration'],
    ['provenance','synthetic'], ['sourceName','Synthetic market simulation'],
    ['dataCutoff','2026-05-24'], ['generatedAt','2026-10-07T12:00:00Z'], ['modelVersion','example-v1'],
  ]),'About');
  return workbook;
};
test('the admin import preserves synthetic provenance, source cutoff and model version',() => {
  const parsed = parseForecastWorkbook(makeWorkbook(),utils);
  assert.equal(parsed.metadata.provenance,'synthetic');
  assert.equal(parsed.metadata.dataCutoff,'2026-05-24');
  assert.equal(parsed.metadata.modelVersion,'example-v1');
  assert.equal(parsed.metadata.generatedAt,'2026-10-07T12:00:00.000Z');
  for (const value of Object.values(parsed.grades)) { assert.equal(value.rejectedCount,0); assert.equal(value.rows.length,1); }
});
test('a missing grade cannot silently reuse another grade or the About sheet',() => {
  const workbook = makeWorkbook();
  delete workbook.Sheets['Grade AA'];
  workbook.SheetNames = workbook.SheetNames.filter((name) => name !== 'Grade AA');
  const parsed = parseForecastWorkbook(workbook,utils);
  assert.match(parsed.grades.AA.error,/not found/);
});
test('invalid quantiles remain a rejection rather than being repaired',() => {
  const workbook = makeWorkbook();
  workbook.Sheets['Grade AAA'] = utils.json_to_sheet([{...forecast,'Low (P10)':99}]);
  assert.match(parseForecastWorkbook(workbook,utils).grades.AAA.error,/Invalid/);
});
