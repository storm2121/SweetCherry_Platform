export const regionDocId = (region = '') =>
  encodeURIComponent(region.trim()).replace(/%/g, '_').toLowerCase();
