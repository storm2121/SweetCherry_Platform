/**
 * hydroponicsService.js
 *
 * Firestore schema:
 *   /hydroDevices/{deviceId}
 *     ownerId, deviceName, createdAt
 *   /hydroReadings/{deviceId}
 *     latest: { tds, temperature, pumpOn, timestamp }
 *   /hydroAlerts/{alertId}
 *     deviceId, ownerId, type, confidence, message, imageUrl, status, createdAt
 */
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { db, functions, storage } from '../config/firebase.js';

const HYDRO_DEVICES = 'hydroDevices';
const HYDRO_READINGS = 'hydroReadings';
const HYDRO_ALERTS = 'hydroAlerts';

// ─── Device management ────────────────────────────────────────────────────────

/** Get or create a device document for a user. */
export const getOrCreateDevice = async (userId) => {
  if (!userId) return null;
  const deviceId = `device_${userId}`;
  const ref = doc(db, HYDRO_DEVICES, deviceId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      ownerId: userId,
      deviceName: 'جهاز ESP32',
      createdAt: Date.now(),
      connected: false,
    });
  }
  return { id: deviceId, ...(snap.data() ?? {}) };
};

/** Subscribe to live sensor readings for a device. */
export const subscribeReadings = (deviceId, callback) => {
  if (!deviceId) return () => {};
  const readingRef = doc(db, HYDRO_READINGS, deviceId);
  return onSnapshot(
    readingRef,
    (snap) => callback(snap.exists() ? snap.data() : null),
    () => callback(null),
  );
};

/** Subscribe to vision/deficiency alerts for a device. */
export const subscribeAlerts = (deviceId, callback) => {
  if (!deviceId) return () => {};
  const q = query(
    collection(db, HYDRO_ALERTS),
    where('deviceId', '==', deviceId),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => callback([]),
  );
};

/** Toggle pump state (writes command to Firestore; ESP32 polls this). */
export const setPumpCommand = async (deviceId, pumpOn) => {
  if (!deviceId) return;
  await updateDoc(doc(db, HYDRO_DEVICES, deviceId), {
    pumpCommand: pumpOn,
    pumpCommandAt: Date.now(),
  });
};

// ─── Plant vision analysis ────────────────────────────────────────────────────

const analyzeVisionImageFn = httpsCallable(functions, 'analyzeVisionImage');

/**
 * Upload a plant image and request deficiency analysis.
 * @param {string} deviceId
 * @param {string} ownerId
 * @param {File}   imageFile
 */
export const analyzeVisionImage = async (deviceId, ownerId, imageFile) => {
  if (!imageFile) throw new Error('No image selected.');
  if (imageFile.size > 10 * 1024 * 1024) throw new Error('Image must be under 10MB.');

  const storePath = `hydroVision/${deviceId}/${Date.now()}-${imageFile.name}`;
  const storageRef = ref(storage, storePath);
  const snap = await uploadBytes(storageRef, imageFile);
  const imageUrl = await getDownloadURL(snap.ref);

  const result = await analyzeVisionImageFn({ deviceId, ownerId, imageUrl });
  return result.data;
};

/** Resolve an alert (mark as handled). */
export const resolveAlert = async (alertId) => {
  await updateDoc(doc(db, HYDRO_ALERTS, alertId), { status: 'resolved' });
};
