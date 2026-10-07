// The five cherry-growing areas SweetCherry covers, placed at each town centre.
// The coordinates drive the weather requests and the landing-page map.
export const GROWING_REGIONS = [
  { id: 'sefrou', ar: 'صفرو', en: 'Sefrou', fr: 'Sefrou', lat: 33.83, lon: -4.84, aliases: ['صفرو', 'sefrou'] },
  { id: 'azrou', ar: 'آزرو', en: 'Azrou', fr: 'Azrou', lat: 33.43, lon: -5.22, aliases: ['آزرو', 'أزرو', 'ازرو', 'azrou'] },
  { id: 'ifrane', ar: 'إفران', en: 'Ifrane', fr: 'Ifrane', lat: 33.53, lon: -5.11, aliases: ['إفران', 'افران', 'ifrane'] },
  { id: 'el-hajeb', ar: 'الحاجب', en: 'El Hajeb', fr: 'El Hajeb', lat: 33.69, lon: -5.37, aliases: ['الحاجب', 'el hajeb', 'elhajeb'] },
  { id: 'taounate', ar: 'تاونات', en: 'Taounate', fr: 'Taounate', lat: 34.54, lon: -4.64, aliases: ['تاونات', 'taounate'] },
];

export const findGrowingRegion = (name) => {
  const normalized = String(name || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  return GROWING_REGIONS.find((region) => region.aliases.includes(normalized)) ?? null;
};
