import { findGrowingRegion } from '../data/growingRegions.js';

export const weatherNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;

export const unavailableWeather = () => ({
  temperature: null, condition: null, conditionAr: 'غير متاح', humidity: null,
  risk: 'Unavailable', riskLabel: 'غير متاح', forecast: [],
  source: 'weatherapi', asOf: null, isSample: false, dataStatus: 'unavailable',
});

// Thresholds behind the farmer weather warnings (°C and % chance of rain).
export const HEAT_MAX_C = 32;
export const FROST_MIN_C = 3;
export const RAIN_CHANCE_PCT = 40;

export const deriveWeatherRisk = (today = {}, tomorrow = {}) => {
  const max = weatherNumber(today.tempMax);
  const min = weatherNumber(today.tempMin);
  const rain = weatherNumber(today.rainChance);
  const tomorrowRain = weatherNumber(tomorrow.rainChance);
  if (max !== null && max >= HEAT_MAX_C) return { code: 'Heat risk', label: 'خطر الحرارة' };
  if (min !== null && min <= FROST_MIN_C) return { code: 'Frost risk', label: 'خطر الصقيع' };
  if ((rain !== null && rain >= RAIN_CHANCE_PCT) || (tomorrowRain !== null && tomorrowRain >= RAIN_CHANCE_PCT)) {
    return { code: 'Rain risk', label: 'خطر الأمطار' };
  }
  if ([max, min, rain, tomorrowRain].some((value) => value === null)) {
    return { code: 'Unavailable', label: 'غير متاح' };
  }
  return { code: 'Stable', label: 'الظروف مستقرة' };
};

export const normalizeWeatherForecast = (days = []) => Array.isArray(days) ? days.slice(0, 3).map((entry, index) => {
  const day = entry?.day || {};
  return {
    index, date: entry?.date || '', tempMax: weatherNumber(day.maxtemp_c), tempMin: weatherNumber(day.mintemp_c),
    avgHumidity: weatherNumber(day.avghumidity), maxWind: weatherNumber(day.maxwind_kph),
    rainChance: weatherNumber(day.daily_chance_of_rain), condition: day.condition?.text || null,
    hourly: [6, 12, 18].map((slot) => entry?.hour?.[slot]).filter(Boolean).map((hour) => ({
      time: hour.time, temp: weatherNumber(hour.temp_c), condition: hour.condition?.text || null,
    })),
  };
}) : [];

export const weatherFromPayload = (payload = {}) => {
  const forecast = normalizeWeatherForecast(payload.forecast?.forecastday);
  const current = payload.current || {};
  const risk = deriveWeatherRisk(forecast[0], forecast[1]);
  const temperature = weatherNumber(current.temp_c);
  const humidity = weatherNumber(current.humidity);
  const epoch = weatherNumber(current.last_updated_epoch);
  return {
    ...unavailableWeather(), temperature, humidity,
    condition: current.condition?.text || null, conditionAr: current.condition?.text || 'غير متاح',
    forecast, risk: risk.code, riskLabel: risk.label, asOf: epoch !== null ? epoch * 1000 : null,
    dataStatus: temperature === null && humidity === null && !forecast.length ? 'unavailable'
      : temperature !== null && humidity !== null && risk.code !== 'Unavailable' ? 'live' : 'partial',
  };
};

export const weatherErrorMessage = (code) => {
  if ([1002, 2006, 2007, 2008, 2009].includes(Number(code))) return 'خدمة الطقس غير متاحة حالياً. يرجى المحاولة لاحقاً.';
  if (Number(code) === 1006) return 'تعذر تحديد المنطقة لعرض الطقس.';
  return 'تعذر تحميل الطقس الحالي. يرجى التحقق من الاتصال والمحاولة لاحقاً.';
};

export const weatherLocationQuery = (region, fallback = region) => {
  const match = findGrowingRegion(region);
  return match ? `${match.lat},${match.lon}` : fallback;
};

// ---- Open-Meteo (no API key; the same provider the climate functions use) ----

// WMO weather codes as reported by Open-Meteo.
const WMO_LABELS_AR = {
  0: 'صحو', 1: 'صحو غالباً', 2: 'غائم جزئياً', 3: 'غائم',
  45: 'ضباب', 48: 'ضباب متجمد',
  51: 'رذاذ خفيف', 53: 'رذاذ', 55: 'رذاذ كثيف', 56: 'رذاذ متجمد خفيف', 57: 'رذاذ متجمد',
  61: 'مطر خفيف', 63: 'مطر', 65: 'مطر غزير', 66: 'مطر متجمد خفيف', 67: 'مطر متجمد',
  71: 'ثلج خفيف', 73: 'ثلج', 75: 'ثلج كثيف', 77: 'حبيبات ثلج',
  80: 'زخات مطر خفيفة', 81: 'زخات مطر', 82: 'زخات مطر قوية', 85: 'زخات ثلج خفيفة', 86: 'زخات ثلج',
  95: 'عاصفة رعدية', 96: 'عاصفة رعدية مع برد خفيف', 99: 'عاصفة رعدية مع برد',
};

export const weatherCodeLabel = (code) => WMO_LABELS_AR[code] ?? null;

export const openMeteoForecastUrl = (locationQuery) => {
  const [latitude, longitude] = String(locationQuery || '').split(',').map((value) => Number(value));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,relative_humidity_2m_mean,wind_speed_10m_max,weather_code',
    hourly: 'temperature_2m,weather_code',
    forecast_days: '3',
    timezone: 'Africa/Casablanca',
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
};

// Open-Meteo reports local times without a zone; utc_offset_seconds gives it.
const localTimeToMs = (time, offsetSeconds = 0) => {
  if (typeof time !== 'string' || !time) return null;
  const ms = Date.parse(`${time.length === 16 ? `${time}:00` : time}Z`);
  return Number.isFinite(ms) ? ms - offsetSeconds * 1000 : null;
};

export const weatherFromOpenMeteo = (payload = {}) => {
  const current = payload.current || {};
  const daily = payload.daily || {};
  const hourly = payload.hourly || {};
  const at = (series, index) => weatherNumber(series?.[index]);
  const forecast = (daily.time || []).slice(0, 3).map((date, index) => {
    const code = at(daily.weather_code, index);
    return {
      index,
      date,
      tempMax: at(daily.temperature_2m_max, index),
      tempMin: at(daily.temperature_2m_min, index),
      avgHumidity: at(daily.relative_humidity_2m_mean, index),
      maxWind: at(daily.wind_speed_10m_max, index),
      rainChance: at(daily.precipitation_probability_max, index),
      condition: weatherCodeLabel(code),
      conditionAr: weatherCodeLabel(code),
      hourly: ['06:00', '12:00', '18:00']
        .map((clock) => (hourly.time || []).indexOf(`${date}T${clock}`))
        .filter((position) => position >= 0)
        .map((position) => ({
          time: hourly.time[position].replace('T', ' '),
          temp: at(hourly.temperature_2m, position),
          condition: weatherCodeLabel(at(hourly.weather_code, position)),
        })),
    };
  });
  const risk = deriveWeatherRisk(forecast[0], forecast[1]);
  const temperature = weatherNumber(current.temperature_2m);
  const humidity = weatherNumber(current.relative_humidity_2m);
  const condition = weatherCodeLabel(weatherNumber(current.weather_code));
  return {
    ...unavailableWeather(),
    source: 'open-meteo',
    temperature,
    humidity,
    condition,
    conditionAr: condition || 'غير متاح',
    forecast,
    risk: risk.code,
    riskLabel: risk.label,
    asOf: localTimeToMs(current.time, weatherNumber(payload.utc_offset_seconds) ?? 0),
    dataStatus:
      temperature === null && humidity === null && !forecast.length
        ? 'unavailable'
        : temperature !== null && humidity !== null && risk.code !== 'Unavailable'
          ? 'live'
          : 'partial',
  };
};
