/**
 * djb2 hash — deterministic, fast, good distribution for cache keys.
 * Shared across all modules to avoid duplication.
 */
export const hashString = (input = '') => {
  if (!input) return '0';
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
};
