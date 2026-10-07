import { useEffect, useMemo, useState } from 'react';
import { subscribeForecastRows } from '../services/forecastService.js';
import { subscribePricePosts } from '../services/farmerService.js';
import { indexPriceObservations, validateForecastRows } from '../utils/forecastData.js';

export const useForecastRows = (grade) => {
  const [sheet, setSheet] = useState(null);
  const [pricePosts, setPricePosts] = useState([]);

  useEffect(() => {
    if (!grade) return undefined;
    return subscribeForecastRows(
      grade,
      (data) => setSheet({ grade, data, error: null }),
      () => setSheet({ grade, data: null, error: 'تعذر تحميل التوقعات. تحقق من الاتصال ثم أعد المحاولة.' }),
    );
  }, [grade]);

  useEffect(() => {
    return subscribePricePosts(setPricePosts);
  }, []);

  // Never show the preceding grade while the new subscription is loading.
  const sheetData = sheet?.grade === grade ? sheet.data : null;
  const validated = useMemo(() => validateForecastRows(sheetData?.rows), [sheetData]);
  const indexed = useMemo(() => indexPriceObservations(pricePosts, grade), [pricePosts, grade]);
  const markets = useMemo(() => Array.from(new Set(validated.rows.map((row) => row.market))).sort(), [validated.rows]);

  return {
    loading: !!grade && sheet?.grade !== grade,
    error: sheet?.grade === grade ? sheet.error : null,
    rows: validated.rows,
    rejectedCount: validated.rejectedCount,
    incompleteIntervalCount: validated.incompleteIntervalCount,
    markets,
    observations: indexed.observations,
    unscopedObservationCount: indexed.unscopedCount,
    updatedAt: sheetData?.updatedAt ?? null,
    generatedAt: sheetData?.generatedAt ?? sheetData?.issuedAt ?? null,
    sourceName: sheetData?.sourceName ?? sheetData?.source ?? null,
    modelVersion: sheetData?.modelVersion ?? null,
    provenance: sheetData?.provenance ?? null,
    dataCutoff: sheetData?.dataCutoff ?? null,
    rowCount: validated.rows.length,
  };
};
