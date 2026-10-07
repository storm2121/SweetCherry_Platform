const DAY_MS = 86400000;
export const CLIMATE_MODEL = 'MPI_ESM1_2_XR';
export const CLIMATE_TIMEZONE = 'Africa/Casablanca';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const dateKey = (date) => date.toISOString().slice(0, 10);

export const completedSevenDayWindow = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLIMATE_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type) => parts.find((entry) => entry.type === type).value;
  const today = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
  return {
    startDate: dateKey(new Date(today.getTime() - 7 * DAY_MS)),
    endDate: dateKey(new Date(today.getTime() - DAY_MS)),
    days: 7, timezone: CLIMATE_TIMEZONE, period: '7_completed_days',
  };
};

export const scenarioWindowForYear = (window, year) => {
  const [, month, day] = window.endDate.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = new Date(Date.UTC(year, month - 1, Math.min(day, lastDay)));
  return { ...window, startDate: dateKey(new Date(end.getTime() - 6 * DAY_MS)), endDate: dateKey(end) };
};

export const climateRequestParams = (region, year, window) => {
  const period = scenarioWindowForYear(window, year);
  return new URLSearchParams({
    latitude: String(region.centroid.lat), longitude: String(region.centroid.lon),
    start_date: period.startDate, end_date: period.endDate, models: CLIMATE_MODEL,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
  });
};

export const summarizeHourlyWindow = (hourly, window) => {
  const indices = (hourly.time || []).map((time, index) => ({ time, index }))
    .filter(({ time }) => time.slice(0, 10) >= window.startDate && time.slice(0, 10) <= window.endDate);
  const days = new Set(indices.map(({ time }) => time.slice(0, 10)));
  if (days.size !== 7 || indices.length < 167) throw new Error('Incomplete seven-day weather window.');
  const values = (name) => {
    const result = indices.map(({ index }) => hourly[name]?.[index]);
    if (!result.every(finite)) throw new Error(`Incomplete weather metric: ${name}`);
    return result;
  };
  const temperatures = values('temperature_2m');
  const precipitation = values('precipitation');
  const humidity = values('relative_humidity_2m');
  const wind = values('wind_speed_10m');
  return {
    tempMax: Math.max(...temperatures), tempMin: Math.min(...temperatures),
    avgHumidity: humidity.reduce((sum, value) => sum + value, 0) / humidity.length,
    maxWind: Math.max(...wind), rainfall7d: precipitation.reduce((sum, value) => sum + value, 0),
    chillHours: temperatures.filter((temp) => temp >= 0 && temp <= 7).length,
    seasonalChillHours: null, seasonalAssessment: 'unavailable', timeWindow: window,
    source: 'open-meteo-gfs', isSample: false,
  };
};

export const summarizeScenarioWindow = (daily, window) => {
  const times = daily.time || [];
  if (times.length !== 7 || times[0] !== window.startDate || times.at(-1) !== window.endDate) {
    throw new Error('Climate response does not match the requested seven-day period.');
  }
  const values = (name) => {
    const result = daily[name] || [];
    if (result.length !== 7 || !result.every(finite)) throw new Error(`Incomplete climate metric: ${name}`);
    return result;
  };
  return {
    tempMax: Math.max(...values('temperature_2m_max')),
    tempMin: Math.min(...values('temperature_2m_min')),
    rainfall7d: values('precipitation_sum').reduce((sum, value) => sum + value, 0),
    chillHours: null, seasonalChillHours: null, seasonalAssessment: 'unavailable',
    timeWindow: window, source: 'open-meteo-climate', model: CLIMATE_MODEL, isSample: false,
  };
};

export const shortWindowRisk = (region, stats) => {
  const heatStress = Math.max(0, stats.tempMax - 32) / 10;
  const dryness = Math.max(0, Math.min(1, (region.rainTarget - stats.rainfall7d) / region.rainTarget));
  return {
    rating: 'غير محسوم', riskScore: Math.max(0, Math.min(1, 0.35 * heatStress + 0.2 * dryness)),
    chillRatio: null, dryness, basis: 'seven_day_heat_rain_indicator', seasonalAssessment: 'unavailable',
  };
};

const decodedRegion = (value) => {
  const raw = String(value || '').trim();
  try { return decodeURIComponent(raw.replace(/_([0-9a-f]{2})/gi, '%$1')).trim().toLowerCase(); }
  catch { return raw.toLowerCase(); }
};

export const canonicalRegionId = (value, regions) => {
  const key = decodedRegion(value).replace(/[\s_-]+/g, ' ');
  const region = regions.find((entry) => [entry.id, entry.name, ...(entry.aliases || [])]
    .some((alias) => decodedRegion(alias).replace(/[\s_-]+/g, ' ') === key));
  return region?.id || null;
};

export const buildRegionRiskIndex = (scores, regions) => {
  const index = new Map();
  for (const entry of scores || []) {
    if (!entry?.regionId || !finite(entry.score)) continue;
    index.set(entry.regionId, entry.score);
    const canonical = canonicalRegionId(entry.regionId, regions);
    if (!canonical) continue;
    const region = regions.find((candidate) => candidate.id === canonical);
    for (const alias of [region.id, region.name, ...(region.aliases || [])]) {
      index.set(alias, entry.score);
      index.set(encodeURIComponent(alias.trim()).replace(/%/g, '_').toLowerCase(), entry.score);
    }
  }
  return index;
};
