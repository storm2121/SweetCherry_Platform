import { useEffect, useState } from 'react';
import { WEATHER_QUERY_BY_REGION } from '../services/constants.js';
import {
  openMeteoForecastUrl,
  unavailableWeather,
  weatherErrorMessage,
  weatherFromOpenMeteo,
  weatherLocationQuery,
} from '../utils/weatherState.js';

// Current conditions and a three-day outlook for the farmer's region, from
// Open-Meteo at the region's coordinates. No API key is involved.
export const useWeather = (region) => {
  const [weather, setWeather] = useState(unavailableWeather);
  const [loading, setLoading] = useState(Boolean(region));
  const [error, setError] = useState(null);

  useEffect(() => {
    const url = openMeteoForecastUrl(weatherLocationQuery(region, WEATHER_QUERY_BY_REGION[region] || region));
    let active = true;
    const controller = new AbortController();
    setWeather(unavailableWeather());
    setError(null);
    if (!region || !url) {
      setLoading(false);
      if (region) setError('تعذر تحديد المنطقة لعرض الطقس.');
      return () => {
        active = false;
        controller.abort();
      };
    }

    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(url, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || payload.error) throw new Error(payload.reason || 'Weather provider request failed.');
        const normalized = weatherFromOpenMeteo(payload);
        if (normalized.dataStatus === 'unavailable') throw new Error('Weather data unavailable.');
        if (active) {
          setWeather(normalized);
          setError(normalized.dataStatus === 'partial' ? 'بيانات الطقس غير مكتملة؛ لا تتوفر إرشادات موثوقة لكل المؤشرات.' : null);
        }
      } catch (failure) {
        if (active && failure.name !== 'AbortError') {
          setWeather(unavailableWeather());
          setError(weatherErrorMessage());
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [region]);

  return { weather, loading, error };
};
