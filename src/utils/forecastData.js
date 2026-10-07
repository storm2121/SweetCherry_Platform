/** Pure validation for both imported workbooks and existing Firestore rows. */
export const HORIZON_TYPES = ['short_term', 'medium_term', 'long_range'];

const ALIASES = {
  date: ['date', 'تاريخ'],
  market: ['market', 'سوق'],
  low: ['low (p10)', 'low', 'p10'],
  expected: ['expected (p50)', 'expected', 'p50'],
  high: ['high (p90)', 'high', 'p90'],
  horizonType: ['horizon type', 'horizontype', 'horizon_type'],
  horizon: ['horizon'],
};

const valueFor = (row, name) => {
  const key = Object.keys(row).find((candidate) =>
    ALIASES[name].includes(candidate.trim().toLowerCase()),
  );
  return key === undefined ? undefined : row[key];
};

const numberOrNull = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export const normalizeForecastDate = (raw) => {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) {
    return Number.isFinite(raw.getTime()) ? raw.toISOString().slice(0, 10) : null;
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    const date = new Date(Math.round((raw - 25569) * 86400000));
    return Number.isFinite(date.getTime()) ? normalizeForecastDate(date) : null;
  }
  const value = String(raw).trim();
  const match = value.match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:T.*)?$/);
  if (!match) return null;
  const iso = match[1] + '-' + match[2] + '-' + match[3];
  const parsed = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
};

export const normalizeHorizon = (rawHorizon, rawType) => {
  const horizon = String(rawHorizon ?? '').trim();
  const normalized = horizon.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, '');
  const weekly = normalized.match(/^(\d+)(?:-(\d+))?(?:w|wk|wks|week|weeks)$/);
  const annual = normalized.match(/^(\d+)(?:-(\d+))?(?:y|yr|yrs|year|years)$/);
  let horizonType = null;
  if (weekly) {
    const first = Number(weekly[1]);
    const last = Number(weekly[2] || weekly[1]);
    if (first < 1 || last < first || last > 52 || (first <= 8 && last > 8)) return null;
    horizonType = last <= 8 ? 'short_term' : 'medium_term';
  } else if (annual) {
    const first = Number(annual[1]);
    const last = Number(annual[2] || annual[1]);
    if (first < 1 || last < first || last > 5) return null;
    horizonType = 'long_range';
  } else if (/^(?:19|20|21)\d{2}$/.test(normalized)) {
    // Legacy annual outputs contain a target calendar year, not a lead-time.
    horizonType = 'long_range';
  } else if (!horizon) {
    const type = String(rawType ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const aliases = { short: 'short_term', short_term: 'short_term', medium: 'medium_term',
      medium_term: 'medium_term', long: 'long_range', long_term: 'long_range', long_range: 'long_range' };
    horizonType = aliases[type] || null;
  }
  return horizonType ? { horizon, horizonType } : null;
};

export const normalizeForecastRow = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const date = normalizeForecastDate(valueFor(raw, 'date'));
  const marketValue = valueFor(raw, 'market');
  const market = typeof marketValue === 'string' ? marketValue.trim().toUpperCase() : '';
  const expected = numberOrNull(valueFor(raw, 'expected'));
  const rawLow = valueFor(raw, 'low');
  const rawHigh = valueFor(raw, 'high');
  const low = numberOrNull(rawLow);
  const high = numberOrNull(rawHigh);
  const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';
  const horizon = normalizeHorizon(valueFor(raw, 'horizon'), valueFor(raw, 'horizonType'));
  if (!date || !market || expected === null || !horizon) return null;
  if ((hasValue(rawLow) && low === null) || (hasValue(rawHigh) && high === null)) return null;
  if ((low !== null && low > expected) || (high !== null && high < expected)) return null;
  return { date, market, low, expected, high, ...horizon };
};

export const validateForecastRows = (rawRows) => {
  const input = Array.isArray(rawRows) ? rawRows : [];
  const rows = input.map(normalizeForecastRow).filter(Boolean).sort((a, b) =>
    a.date.localeCompare(b.date) || HORIZON_TYPES.indexOf(a.horizonType) - HORIZON_TYPES.indexOf(b.horizonType)
      || a.horizon.localeCompare(b.horizon),
  );
  return {
    rows,
    rejectedCount: input.length - rows.length,
    incompleteIntervalCount: rows.filter((row) => row.low === null || row.high === null).length,
  };
};

export const selectForecastRows = (rows, market, horizonType = 'all') =>
  rows.filter((row) => row.market === market && (horizonType === 'all' || row.horizonType === horizonType));

export const timestampMillis = (value) => {
  let millis;
  try {
    if (typeof value?.toMillis === 'function') millis = value.toMillis();
    else if (typeof value?.toDate === 'function') millis = value.toDate().getTime();
    else if (value instanceof Date) millis = value.getTime();
    else if (typeof value?.seconds === 'number') millis = value.seconds * 1000;
    else if (typeof value === 'number') millis = value;
    else if (typeof value === 'string') millis = Date.parse(value);
  } catch {
    return null;
  }
  return Number.isFinite(millis) ? millis : null;
};

export const observationKey = (market, date) => market + '|' + date;

/** Unscoped farmer posts cannot be compared to a particular forecast market. */
export const indexPriceObservations = (posts, grade) => {
  const observations = new Map();
  let unscopedCount = 0;
  for (const post of posts) {
    if (String(post.quality ?? '').trim().toUpperCase() !== grade) continue;
    const market = typeof post.market === 'string' ? post.market.trim().toUpperCase() : '';
    const millis = timestampMillis(post.createdAt);
    const explicitDate = post.date !== undefined && post.date !== null && post.date !== '';
    const date = explicitDate ? normalizeForecastDate(post.date) : observationCalendarDate(millis);
    const price = numberOrNull(post.price);
    if (!market || !date || price === null) {
      unscopedCount += 1;
      continue;
    }
    const key = observationKey(market, date);
    if (!observations.has(key)) observations.set(key, []);
    observations.get(key).push({ ...post, price });
  }
  return { observations, unscopedCount };
};

export const comparePriceObservation = (row, price) => {
  const value = numberOrNull(price);
  if (value === null) return null;
  if (row.low === null || row.high === null) return 'no_interval';
  return value < row.low ? 'below' : value > row.high ? 'above' : 'within';
};

export const summarizeObservations = (row, observations) => {
  const prices = observations.map((post) => post.price);
  if (!prices.length) return null;
  return {
    count: prices.length,
    average: prices.reduce((sum, price) => sum + price, 0) / prices.length,
    min: Math.min(...prices),
    max: Math.max(...prices),
    outsideCount: prices.filter((price) => ['below', 'above'].includes(comparePriceObservation(row, price))).length,
  };
};


/** Forecasts use local calendar dates; midnight in Morocco can precede UTC midnight. */
export const observationCalendarDate = (millis) => {
  if (millis === null || !Number.isFinite(millis)) return null;
  const date = new Date(millis);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type).value;
  return part('year') + '-' + part('month') + '-' + part('day');
};
