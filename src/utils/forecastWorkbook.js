import { normalizeForecastDate, validateForecastRows } from './forecastData.js';

export const FORECAST_GRADES = ['A', 'AA', 'AAA'];
const metadataFields = {
  provenance:'provenance', dataprovenance:'provenance', source:'sourceName', sourcename:'sourceName',
  modelversion:'modelVersion', generatedat:'generatedAt', generationtime:'generatedAt',
  datacutoff:'dataCutoff', cutoff:'dataCutoff', seed:'seed',
};
export const readForecastMetadata = (workbook, utils) => {
  const name = workbook.SheetNames.find((candidate) => candidate.trim().toLowerCase() === 'about');
  if (!name) return {};
  const cells = utils.sheet_to_json(workbook.Sheets[name],{header:1,defval:null});
  const metadata = {};
  for (const row of cells) {
    const key = String(row[0] ?? '').toLowerCase().replace(/[^a-z]/g,'');
    const field = metadataFields[key];
    if (!field || row[1] === null || row[1] === undefined) continue;
    if (field === 'dataCutoff') {
      const value = normalizeForecastDate(row[1]);
      if (value) metadata[field] = value;
    } else if (field === 'generatedAt') {
      const value = row[1] instanceof Date ? row[1].getTime() : Date.parse(String(row[1]));
      if (Number.isFinite(value)) metadata[field] = new Date(value).toISOString();
    } else {
      metadata[field] = String(row[1]).trim().slice(0,240);
    }
  }
  const aboutText = cells.map((row) => row.slice(0,2).join(' ')).join('\n');
  if (metadata.provenance?.toLowerCase() === 'synthetic' || /\b(?:simulated|synthetic)\b/i.test(aboutText)) {
    metadata.provenance = 'synthetic';
    metadata.sourceName ||= 'Synthetic market simulation';
  }
  return metadata;
};

export const parseForecastWorkbook = (workbook, utils) => {
  const metadata = readForecastMetadata(workbook,utils);
  const dataSheets = workbook.SheetNames.filter((name) => name.trim().toLowerCase() !== 'about');
  const grades = {};
  for (const [index,grade] of FORECAST_GRADES.entries()) {
    const name = dataSheets.find((candidate) => candidate.trim().toUpperCase() === 'GRADE '+grade) ||
      dataSheets.find((candidate) => candidate.trim().toUpperCase() === grade) || dataSheets[index];
    if (!name) { grades[grade] = {error:'Sheet for Grade '+grade+' not found.'}; continue; }
    // Metadata or repeated fallback sheets cannot masquerade as another grade.
    const namedOtherGrade = name.trim().toUpperCase().match(/^(?:GRADE )?(A|AA|AAA)$/)?.[1];
    if (namedOtherGrade && namedOtherGrade !== grade) {
      grades[grade] = {error:'Sheet for Grade '+grade+' not found.'}; continue;
    }
    const result = validateForecastRows(utils.sheet_to_json(workbook.Sheets[name],{defval:null}));
    if (result.rejectedCount) grades[grade] = {error:'Invalid price, date, market or horizon in '+result.rejectedCount+' row(s) of '+name+'.'};
    else if (!result.rows.length) grades[grade] = {error:'No forecast rows in '+name+'. The file may be outside the local harvest season.'};
    else grades[grade] = result;
  }
  return { metadata, grades };
};
