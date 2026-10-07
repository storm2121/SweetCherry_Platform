import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { root } from './project-tools.mjs';
import { parseForecastWorkbook } from '../src/utils/forecastWorkbook.js';
const require = createRequire(new URL('../tests/rules/package.json',import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
for (const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST']) {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env[key] || '')) throw new Error('Refusing to seed without loopback Firebase emulator hosts.');
}
const folder = join(root,'forecasting/samples');
const candidates = existsSync(folder) ? readdirSync(folder).filter((name) => /forecast.*\.xlsx$/i.test(name)).sort() : [];
if (!candidates.length) {
  console.log('No generated forecast sample yet. Forecast views will show an empty state.');
} else {
  const { read, utils } = await import('xlsx');
  const workbook = read(readFileSync(join(folder,candidates[0])),{type:'buffer',cellDates:true});
  const parsed = parseForecastWorkbook(workbook,utils);
  if (parsed.metadata.provenance !== 'synthetic') throw new Error('Only an explicitly synthetic workbook can be used in the demo.');
  const db = getFirestore(initializeApp({projectId:'demo-sweetcherry'},'seed-forecast-demo'));
  const batch = db.batch();
  for (const [grade,result] of Object.entries(parsed.grades)) {
    if (result.error) throw new Error(result.error);
    batch.set(db.doc('forecastSheets/'+grade), {
      rows:result.rows, rowCount:result.rows.length, incompleteIntervalCount:result.incompleteIntervalCount,
      ...parsed.metadata, uploadedBy:'adminA', updatedAt:FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  console.log('Seeded the fixed synthetic forecast snapshot from '+candidates[0]+'.');
}
