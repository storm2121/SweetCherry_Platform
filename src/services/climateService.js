import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';
import { functions, storage } from '../config/firebase.js';
import { SAMPLE_CLIMATE } from '../data/climateSample.js';
import { climateDataState } from '../utils/climateState.js';

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache = null;
const layerCache = new Map();

export const fetchClimateOverview = async () => {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.payload;
  }

  const fallback = () => {
    const sample = climateDataState(SAMPLE_CLIMATE, true);
    cache = { loadedAt: Date.now(), payload: sample };
    return sample;
  };

  try {
    const callable = httpsCallable(functions, 'getClimateOverview');
    const { data } = await callable();
    if (data && typeof data === 'object') {
      const hydrated = climateDataState(await hydrateClimatePayload(data));
      cache = { loadedAt: Date.now(), payload: hydrated };
      return hydrated;
    }
    return fallback();
  } catch (error) {
    console.warn('fetchClimateOverview:fallback', error?.message);
    return fallback();
  }
};

export const fetchRegionClimate = async (regionId) => {
  if (!regionId) {
    return null;
  }
  try {
    const callable = httpsCallable(functions, 'getRegionClimateSummary');
    const { data } = await callable({ regionId });
    if (data) return climateDataState(data);
  } catch (error) {
    console.warn('fetchRegionClimate:fallback', error?.message);
  }

  const sample = SAMPLE_CLIMATE.regionSummaries?.[regionId];
  if (sample) {
    return climateDataState({ regionId, ...sample }, true);
  }
  return null;
};

const hydrateClimatePayload = async (raw) => {
  if (!raw?.layers) return raw;
  const layers = { ...raw.layers };

  const download = async (path) => {
    if (!path) return null;
    if (layerCache.has(path)) return layerCache.get(path);
    const url = await getDownloadURL(storageRef(storage, path));
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download layer ${path}`);
    }
    const data = await response.json();
    layerCache.set(path, data);
    return data;
  };

  if (!layers.temperature && layers.temperaturePath) {
    layers.temperature = await download(layers.temperaturePath);
  }
  if (!layers.rainfall && layers.rainfallPath) {
    layers.rainfall = await download(layers.rainfallPath);
  }
  if (!layers.chillHours && layers.chillHoursPath) {
    layers.chillHours = await download(layers.chillHoursPath);
  }
  if (!layers.drought && layers.droughtPath) {
    layers.drought = await download(layers.droughtPath);
  }

  if (!layers.viability && layers.viabilityPaths) {
    const result = {};
    const entries = Object.entries(layers.viabilityPaths);
    await Promise.all(
      entries.map(async ([scenario, path]) => {
        result[scenario] = await download(path);
      }),
    );
    layers.viability = result;
  }

  return { ...raw, layers };
};
