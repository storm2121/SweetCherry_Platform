import { LOCALES } from '../../i18n/language.js';

// Number and date formatting for the landing page. fr-MA and ar-MA keep
// Latin digits; ar-MA uses the Moroccan month names (ماي، يوليوز، غشت…).
export { LOCALES };

export const capitalize = (text) => (text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text);

// Prices to the nearest tenth of a dirham: precise enough to tell the low,
// likely and high prices apart without reading like a spreadsheet.
export const formatPrice = (value, lang) =>
  value === null || value === undefined ? '—' : value.toLocaleString(LOCALES[lang], { maximumFractionDigits: 1 });

export const formatTemp = (value, lang) =>
  value === null || value === undefined ? '—' : `${(Math.round(value) || 0).toLocaleString(LOCALES[lang])}°`;

export const formatNumber = (value, lang) =>
  value === null || value === undefined ? '—' : Math.round(value).toLocaleString(LOCALES[lang]);

// ISO calendar dates are formatted at noon UTC so no time zone shifts the day.
export const formatDay = (iso, lang, options = { day: 'numeric', month: 'long', year: 'numeric' }) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString(LOCALES[lang], { ...options, timeZone: 'UTC' });

export const formatInstant = (date, lang) =>
  date.toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Casablanca' });
