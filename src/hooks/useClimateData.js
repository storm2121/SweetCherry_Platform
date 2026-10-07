import { useEffect, useState } from 'react';
import { fetchClimateOverview } from '../services/climateService.js';

export const useClimateData = () => {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchClimateOverview();
        if (!ignore) {
          setPayload(data);
        }
      } catch (err) {
        if (!ignore) {
          setError(err?.message || 'تعذر تحميل بيانات المناخ.');
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      ignore = true;
    };
  }, []);

  return {
    payload, loading, error, warning: payload?.warning || null,
    source: payload?.source || null, asOf: payload?.asOf || null,
    isSample: payload?.isSample ?? null, dataStatus: payload?.dataStatus || 'unavailable',
  };
};
