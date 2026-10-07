import { useEffect, useState } from 'react';
import { regionsForecastUrl, regionsFromOpenMeteo } from '../utils/regionsWeather.js';

// Weather for the five growing areas, fetched once per page view.
export const useRegionsWeather = () => {
  const [state, setState] = useState({ status: 'loading', regions: [] });

  useEffect(() => {
    const controller = new AbortController();
    fetch(regionsForecastUrl(), { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((payload) => {
        const regions = regionsFromOpenMeteo(payload);
        setState(regions.length ? { status: 'ready', regions } : { status: 'error', regions: [] });
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setState({ status: 'error', regions: [] });
      });
    return () => controller.abort();
  }, []);

  return state;
};
