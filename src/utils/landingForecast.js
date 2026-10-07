// Helpers for the forecast preview on the public landing page. Rows are the
// validated output of validateForecastRows (forecastData.js).

const DAY_MS = 86400000;
const isoMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
export const addDays = (iso, days) => new Date(isoMs(iso) + days * DAY_MS).toISOString().slice(0, 10);

// The weekly part of a sheet (the 1–8 and 9–52 week horizons) for one market,
// oldest first, one row per date.
export const weeklySeries = (rows, market) => {
  const byDate = new Map();
  for (const row of rows) {
    if (row.market !== market || row.horizonType === 'long_range' || byDate.has(row.date)) continue;
    byDate.set(row.date, row);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
};

// The row whose week contains `today`. A week runs until the next row's date;
// the last one runs seven days.
export const weekContaining = (series, today) => {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    if (series[index].date > today) continue;
    const end = series[index + 1]?.date ?? addDays(series[index].date, 7);
    return today < end ? series[index] : null;
  }
  return null;
};

export const seriesEnd = (series) => (series.length ? addDays(series[series.length - 1].date, 7) : null);

// Rounded axis bounds and step for a value range, roughly `count` intervals.
export const niceScale = (min, max, count = 4) => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((value) => value >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = lo; value <= hi + step / 2; value += step) ticks.push(Number(value.toFixed(6)));
  return { lo, hi: hi === lo ? lo + step : hi, step, ticks };
};

// First day of each month between two ISO dates, for axis ticks.
export const monthStarts = (fromIso, toIso) => {
  const starts = [];
  const from = new Date(isoMs(fromIso));
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth() + (from.getUTCDate() > 1 ? 1 : 0);
  for (;;) {
    if (month > 11) { year += 1; month = 0; }
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    if (iso > toIso) break;
    starts.push(iso);
    month += 1;
  }
  return starts;
};
