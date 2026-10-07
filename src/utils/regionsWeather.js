import { GROWING_REGIONS } from '../data/growingRegions.js';
import { FROST_MIN_C, HEAT_MAX_C, RAIN_CHANCE_PCT, weatherCodeLabel, weatherNumber } from './weatherState.js';

// Current conditions and a three-day outlook for all five areas in one
// Open-Meteo request. Used by the public landing page.

const WMO_LABELS_EN = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Freezing fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Light freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Light freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Light snow showers', 86: 'Snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm, light hail', 99: 'Thunderstorm with hail',
};

const WMO_LABELS_FR = {
  0: 'Ciel dégagé', 1: 'Plutôt dégagé', 2: 'Partiellement nuageux', 3: 'Couvert',
  45: 'Brouillard', 48: 'Brouillard givrant',
  51: 'Bruine légère', 53: 'Bruine', 55: 'Bruine dense', 56: 'Bruine verglaçante légère', 57: 'Bruine verglaçante',
  61: 'Pluie faible', 63: 'Pluie', 65: 'Forte pluie', 66: 'Pluie verglaçante faible', 67: 'Pluie verglaçante',
  71: 'Neige faible', 73: 'Neige', 75: 'Forte neige', 77: 'Grains de neige',
  80: 'Averses faibles', 81: 'Averses', 82: 'Fortes averses', 85: 'Averses de neige faibles', 86: 'Averses de neige',
  95: 'Orage', 96: 'Orage avec grêle faible', 99: 'Orage avec grêle',
};

const LABELS = { en: WMO_LABELS_EN, fr: WMO_LABELS_FR };

export const conditionLabel = (code, lang = 'ar') =>
  (lang === 'ar' ? weatherCodeLabel(code) : LABELS[lang]?.[code]) ?? null;

export const regionsForecastUrl = (regions = GROWING_REGIONS) => {
  const params = new URLSearchParams({
    latitude: regions.map((region) => region.lat).join(','),
    longitude: regions.map((region) => region.lon).join(','),
    current: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    forecast_days: '3',
    timezone: 'Africa/Casablanca',
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
};

// Open-Meteo answers a multi-location request with one entry per location,
// in request order. Anything else means the response cannot be matched to
// the regions, so nothing is returned.
export const regionsFromOpenMeteo = (payload, regions = GROWING_REGIONS) => {
  if (!Array.isArray(payload) || payload.length !== regions.length) return [];
  return regions.map((region, index) => {
    const entry = payload[index] ?? {};
    const daily = entry.daily ?? {};
    const days = (daily.time ?? []).slice(0, 3).map((date, day) => {
      const max = weatherNumber(daily.temperature_2m_max?.[day]);
      const min = weatherNumber(daily.temperature_2m_min?.[day]);
      const rainChance = weatherNumber(daily.precipitation_probability_max?.[day]);
      return {
        date,
        max,
        min,
        rainChance,
        code: weatherNumber(daily.weather_code?.[day]),
        // Same limits as the warnings in the farmer's weather view.
        frost: min !== null && min <= FROST_MIN_C,
        heat: max !== null && max >= HEAT_MAX_C,
        wet: rainChance !== null && rainChance >= RAIN_CHANCE_PCT,
      };
    });
    return {
      ...region,
      elevation: weatherNumber(entry.elevation),
      temperature: weatherNumber(entry.current?.temperature_2m),
      code: weatherNumber(entry.current?.weather_code),
      // Local Moroccan time of the reading, "YYYY-MM-DDTHH:MM".
      time: typeof entry.current?.time === 'string' ? entry.current.time : null,
      days,
    };
  });
};
