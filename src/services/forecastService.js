/**
 * forecastService.js
 *
 * Handles reading/writing Excel-based price forecast data.
 * Firestore schema:
 *   /forecastSheets/{grade}  → { rows: ForecastRow[], updatedAt, uploadedBy }
 *
 * ForecastRow: { date, market, low, expected, high, horizonType, horizon }
 *   date:        ISO date string  "2026-02-02"
 *   market:      "M01" | "M02" | "M03"
 *   low:         number | null (P10)
 *   expected:    number (P50)
 *   high:        number | null (P90)
 *   horizonType: "short_term" | "medium_term" | "long_range"
 *   horizon:     "1w" | "2w" | "2026" | "2027" | ...
 */
import { doc, getDoc, onSnapshot, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../config/firebase.js';
import { parseForecastWorkbook } from '../utils/forecastWorkbook.js';

// xlsx is dynamically imported only when admin triggers an upload (keeps initial bundle small)
const getXlsx = () => import('xlsx');

export const GRADES = ['A', 'AA', 'AAA'];

export const MARKET_LABELS = {
  M01: 'الدار البيضاء',
  M02: 'الرباط',
  M03: 'مراكش',
};

/** Subscribe to live forecast rows for a grade. Returns unsubscribe fn. */
export const subscribeForecastRows = (grade, callback, onError) => {
  if (!grade) return () => {};
  const ref = doc(db, 'forecastSheets', grade);
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) {
        callback(snap.data());
      } else {
        callback(null);
      }
    },
    (error) => onError ? onError(error) : callback(null),
  );
};

/** One read of a grade's published sheet, for pages that do not need live updates. */
export const fetchForecastSheet = async (grade) => {
  const snap = await getDoc(doc(db, 'forecastSheets', grade));
  return snap.exists() ? snap.data() : null;
};

/** One-off fetch for all grades (used in Admin to check last upload). */
export const fetchForecastMeta = async () => {
  const results = {};
  await Promise.all(
    GRADES.map(async (grade) => {
      const snap = await getDoc(doc(db, 'forecastSheets', grade));
      if (snap.exists()) {
        const { rows, updatedAt, uploadedBy } = snap.data();
        results[grade] = {
          count: Array.isArray(rows) ? rows.length : 0,
          updatedAt,
          uploadedBy,
        };
      } else {
        results[grade] = null;
      }
    }),
  );
  return results;
};

/**
 * Parse an Excel file with 3 sheets (Grade A, AA, AAA) and upload to Firestore.
 * @param {File} file        - The .xlsx file selected by admin
 * @param {string} uploadedBy - UID of the admin
 * @param {function} onProgress - (grade, status) => void
 */
export const uploadForecastExcel = async (file, uploadedBy, onProgress) => {
  const { read, utils } = await getXlsx();
  const buffer = await file.arrayBuffer();
  const workbook = read(buffer, { type: 'array', cellDates: true });

  const { metadata, grades } = parseForecastWorkbook(workbook, utils);
  if (Object.values(grades).some((result) => result.error)) {
    return Object.fromEntries(GRADES.map((grade) => [grade, {
      error: grades[grade].error || 'Workbook not uploaded. Correct the invalid grade sheet and retry.',
    }]));
  }
  const batch = writeBatch(db);
  for (const grade of GRADES) {
    onProgress?.(grade, 'uploading');
    const { rows, incompleteIntervalCount } = grades[grade];
    batch.set(doc(db, 'forecastSheets', grade), {
      rows, ...metadata, updatedAt: serverTimestamp(), uploadedBy,
      rowCount: rows.length, incompleteIntervalCount,
    });
  }
  await batch.commit();
  return Object.fromEntries(GRADES.map((grade) => {
    onProgress?.(grade, 'done');
    return [grade, {count:grades[grade].rows.length, incompleteIntervalCount:grades[grade].incompleteIntervalCount}];
  }));
};
