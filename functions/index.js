import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage, getDownloadURL } from 'firebase-admin/storage';
import { Buffer } from 'node:buffer';

import OpenAI from 'openai';
import { CLIMATE_MODEL, CLIMATE_TIMEZONE, completedSevenDayWindow, scenarioWindowForYear, climateRequestParams, summarizeHourlyWindow, summarizeScenarioWindow, shortWindowRisk, canonicalRegionId } from "./lib/climateMetrics.mjs";
import {
  EXPERT_CONVERSATIONS,
  EXPERT_CONVERSATION_MESSAGES,
  EXPERT_PENDING_REPLIES,
  EXPERT_REQUESTS,
  createClaimExpertRequestAndReply,
  deleteConversationMessages,
} from './lib/expertRequests.mjs';

setGlobalOptions({ region: 'europe-west1', maxInstances: 4 });

const app = initializeApp();
const adminAuth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const OPENAI_SECRET = defineSecret('OPENAI_API_KEY');
const ELEVENLABS_SECRET = defineSecret('ELEVENLABS_API_KEY');

const ELEVENLABS_VOICE_ID = 'A9ATTqUUQ6GHu0coCz8t';
const ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';

const REGION_CONFIG = [
  {
    id: 'sefrou',
    name: 'Sefrou',
    aliases: ['sefrou', 'صفرو'],
    bounds: { top: 34.05, bottom: 33.62, left: -5.15, right: -4.45 },
    centroid: { lat: 33.83, lon: -4.84 },
    variety: 'Burlat',
    chillTarget: 760,
    rainTarget: 38,
  },
  {
    id: 'azrou',
    name: 'Azrou',
    aliases: ['azrou', 'آزرو'],
    bounds: { top: 33.62, bottom: 33.25, left: -5.45, right: -4.95 },
    centroid: { lat: 33.43, lon: -5.22 },
    variety: 'Kordia',
    chillTarget: 880,
    rainTarget: 46,
  },
  {
    id: 'ifrane',
    name: 'Ifrane',
    aliases: ['ifrane', 'إفران'],
    bounds: { top: 33.75, bottom: 33.35, left: -5.35, right: -4.85 },
    centroid: { lat: 33.53, lon: -5.11 },
    variety: 'Burlat',
    chillTarget: 920,
    rainTarget: 50,
  },
  {
    id: 'el_hajeb',
    name: 'El Hajeb',
    aliases: ['el hajeb', 'elhajeb', 'el-hajeb', 'الحاجب'],
    bounds: { top: 33.85, bottom: 33.45, left: -5.65, right: -5.05 },
    centroid: { lat: 33.69, lon: -5.37 },
    variety: 'Summit',
    chillTarget: 740,
    rainTarget: 36,
  },
  {
    id: 'taounate',
    name: 'Taounate',
    aliases: ['taounate', 'تاونات'],
    bounds: { top: 34.75, bottom: 34.25, left: -5.05, right: -4.25 },
    centroid: { lat: 34.54, lon: -4.64 },
    variety: 'Regina',
    chillTarget: 620,
    rainTarget: 42,
  },
];

const SCENARIO_YEARS = {
  current: new Date().getUTCFullYear(),
  '2030': 2030,
  '2050': 2050,
};
const PRICE_POSTS = 'pricePosts';

const USERS = 'users';
const VISION_DIAGNOSES = 'visionDiagnoses';
const DAILY_WEATHER_CACHE = 'dailyWeatherCache';
const WEATHER_CACHE_META_REF = db.collection('system').doc('dailyWeatherCache');
const DIAGNOSIS_WEATHER_LOOKBACK_DAYS = 30;
const FARMER_MESSAGES = 'farmerMessages';
const FARMER_MESSAGE_REPLIES = 'replies';
const FARMER_CHAT = 'farmerChat';
const FARMER_NOTES = 'farmerNotes';
const HYDRO_ALERTS = 'hydroAlerts';
const HYDRO_DEVICES = 'hydroDevices';
const HYDRO_READINGS = 'hydroReadings';
const DELETABLE_COLLECTIONS = new Set([
  VISION_DIAGNOSES,
  FARMER_MESSAGES,
  FARMER_CHAT,
  EXPERT_REQUESTS,
  EXPERT_CONVERSATIONS,
  FARMER_NOTES,
  PRICE_POSTS,
  HYDRO_ALERTS,
]);

export const generateAiNote = onCall(
  { timeoutSeconds: 120, cors: true, secrets: [OPENAI_SECRET] },
  async (request) => {
    const { region, weatherSummary } = request.data || {};
    console.log('generateAiNote:start', { region, hasSummary: !!weatherSummary });

    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Login required before generating AI notes.');
    }

    if (!region) {
      throw new HttpsError('invalid-argument', 'Region is required.');
    }

    const userDoc = await db.collection('users').doc(request.auth.uid).get();
    if (!userDoc.exists) {
      throw new HttpsError('permission-denied', 'User profile missing.');
    }

    const userRole = userDoc.data()?.role;
    if (!['farmer', 'expert', 'admin'].includes(userRole)) {
      throw new HttpsError('permission-denied', 'Role not allowed to request AI notes.');
    }

    const regionId = formatRegionId(region);
    const noteRef = db.collection('aiNotes').doc(regionId);
    const lockRef = db.collection('aiNoteLocks').doc(regionId);

    const existingSnap = await noteRef.get();
    if (existingSnap.exists) {
      const existingData = existingSnap.data();
      const hasForecast = Array.isArray(existingData.weatherSummary?.forecast) && existingData.weatherSummary.forecast.length >= 1;
      if (
        hasForecast &&
        existingData.generatedAt &&
        Date.now() - existingData.generatedAt < DAY_IN_MS
      ) {
        return { id: existingSnap.id, ...existingData };
      }
      await noteRef.delete().catch(() => {});
    }

    try {
      await lockRef.create({ createdAt: Date.now() });
    } catch (err) {
      if (err.code === 6 || err.code === 'ALREADY_EXISTS') {
        const freshSnap = await noteRef.get();
        if (freshSnap.exists) {
          return { id: freshSnap.id, ...freshSnap.data() };
        }
        throw new HttpsError('resource-exhausted', 'AI note generation in progress.');
      }
      throw err;
    }

    try {
      const openaiKey = OPENAI_SECRET.value();
      if (!openaiKey) {
        throw new HttpsError('failed-precondition', 'OpenAI key missing on server.');
      }

      const openai = new OpenAI({ apiKey: openaiKey });
      console.log('generateAiNote:summary', JSON.stringify(weatherSummary, null, 2));
      const prompt = buildPrompt(region, weatherSummary);
      console.log('generateAiNote:prompt', prompt);

      const completion = await openai.responses.create({
        model: 'gpt-4o-mini',
        input: prompt,
      });

      const content =
        completion?.output?.[0]?.content?.[0]?.text ??
        'New guidance will appear soon. Keep checking the weather risks and follow expert tips.';

      const note = {
        region,
        content,
        weatherSummary: weatherSummary ?? null,
        generatedAt: Date.now(),
        expiresAt: Date.now() + DAY_IN_MS,
        createdBy: request.auth.uid,
      };

      await noteRef.set(note);
      console.log('generateAiNote:success', { region, noteId: noteRef.id });
      return { id: noteRef.id, ...note };
    } finally {
      await lockRef.delete().catch(() => {});
    }
  },
);

export const ingestClimateLayers = onSchedule(
  {
    schedule: 'every 120 hours',
    timeZone: 'Africa/Casablanca',
    region: 'europe-west1',
    timeoutSeconds: 540,
  },
  async () => {
    const snapshot = await buildClimateSnapshot();
    const docRef = db.collection('climateSnapshots').doc('latest');
    await docRef.set(snapshot);
    const batch = db.batch();
    Object.entries(snapshot.regionSummaries).forEach(([regionId, summary]) => {
      const ref = db.collection('climateSummaries').doc(regionId);
      batch.set(ref, summary, { merge: true });
    });
    await batch.commit();
    console.log('ingestClimateLayers:stored', snapshot.generatedAt);
  },
);

export const getClimateOverview = onCall({ cors: true }, async () => {
  const snap = await db.collection('climateSnapshots').doc('latest').get();
  if (snap.exists) {
    return snap.data();
  }
  return SAMPLE_CLIMATE_PAYLOAD;
});

export const getRegionClimateSummary = onCall({ cors: true }, async (request) => {
  const { regionId } = request.data || {};
  if (typeof regionId !== 'string' || !regionId.trim() || regionId.includes('/')) {
    throw new HttpsError('invalid-argument', 'regionId is required');
  }
  const canonicalId = canonicalRegionId(regionId, REGION_CONFIG) || regionId;
  const doc = await db.collection('climateSummaries').doc(regionId).get();
  if (doc.exists) return { regionId, ...doc.data(), canonicalRegionId: canonicalId };
  if (canonicalId !== regionId) {
    const canonicalDoc = await db.collection('climateSummaries').doc(canonicalId).get();
    if (canonicalDoc.exists) return { ...canonicalDoc.data(), regionId, canonicalRegionId: canonicalId };
  }
  const summary = SAMPLE_CLIMATE_PAYLOAD.regionSummaries?.[canonicalId];
  if (!summary) {
    throw new HttpsError('not-found', 'Region summary unavailable.');
  }
  return { regionId, ...summary, canonicalRegionId: canonicalId, source: 'sample', asOf: null, isSample: true, dataStatus: 'sample' };
});

export const cacheDailyWeather = onSchedule(
  {
    schedule: 'every 24 hours',
    timeZone: 'Africa/Casablanca',
    region: 'europe-west1',
    timeoutSeconds: 300,
  },
  async () => {
    const dateKey = dateKeyDaysAgo(1);
    const result = await writeDailyWeatherRange({
      startDateKey: dateKey,
      endDateKey: dateKey,
      sourceReason: 'scheduled_daily_cache',
    });
    console.log('dailyWeatherCache:scheduled-complete', result);
  },
);

export const backfillDailyWeatherCache = onCall(
  { timeoutSeconds: 540, cors: true },
  async (request) => {
    await requireAdminUser(request);
    const days = clampInteger(request.data?.days ?? 90, 1, 365);
    const endDateKey = dateKeyDaysAgo(1);
    const startDateKey = addDaysToDateKey(endDateKey, -(days - 1));
    return writeDailyWeatherRange({
      startDateKey,
      endDateKey,
      sourceReason: 'admin_backfill',
    });
  },
);

export const backfillDiagnosisWeatherContext = onCall(
  { timeoutSeconds: 540, cors: true },
  async (request) => {
    await requireAdminUser(request);
    const limit = clampInteger(request.data?.limit ?? 100, 1, 500);
    const includeExisting = request.data?.includeExisting === true;
    const fetchLimit = includeExisting ? limit : Math.min(limit * 4, 1000);
    const queryRef = db.collection(VISION_DIAGNOSES).orderBy('createdAt', 'desc').limit(fetchLimit);
    const snapshot = await queryRef.get();
    const docs = includeExisting
      ? snapshot.docs
      : snapshot.docs.filter((docSnap) => docSnap.data()?.weatherContext == null).slice(0, limit);
    let updated = 0;
    let skipped = 0;
    const statuses = {};

    for (const docSnap of docs) {
      const result = await enrichDiagnosisWeatherContext(docSnap.ref, docSnap.data());
      statuses[result.status] = (statuses[result.status] ?? 0) + 1;
      if (result.updated) {
        updated += 1;
      } else {
        skipped += 1;
      }
    }

    return {
      scanned: snapshot.size,
      selected: docs.length,
      updated,
      skipped,
      statuses,
      includeExisting,
    };
  },
);

export const enrichDiagnosisWeatherOnCreate = onDocumentCreated(
  {
    document: `${VISION_DIAGNOSES}/{diagnosisId}`,
    region: 'europe-west1',
    timeoutSeconds: 60,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const result = await enrichDiagnosisWeatherContext(snap.ref, snap.data());
    console.log('diagnosisWeather:onCreate', { diagnosisId: event.params.diagnosisId, ...result });
  },
);

// Assigns a farmer's question to the first expert who answers. Recovered from
// the 2026-05-07 deployment; the logic lives in lib/expertRequests.mjs.
export const claimExpertRequestAndReply = createClaimExpertRequestAndReply({ onCall, HttpsError, db, FieldValue });

export const adminDeleteUser = onCall({ cors: true }, async (request) => {
  let targetUid = '';

  try {
    const requester = await requireAdminUser(request);
    targetUid = String(request.data?.uid || '').trim();

    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'uid is required.');
    }
    if (targetUid === requester.uid) {
      throw new HttpsError('failed-precondition', 'Admins cannot delete their own accounts here.');
    }

    console.log('adminDeleteUser:start', { requesterUid: requester.uid, targetUid });

    const targetRef = db.collection(USERS).doc(targetUid);
    const targetSnap = await targetRef.get();
    if (targetSnap.exists && targetSnap.data()?.role === 'admin') {
      throw new HttpsError('permission-denied', 'Admin accounts cannot be deleted here.');
    }

    const cleanup = await deleteUserOwnedData(targetUid, targetSnap.exists ? targetSnap.data() : {});

    try {
      await adminAuth.deleteUser(targetUid);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') {
        throw new HttpsError('internal', error?.message || 'Failed to delete auth user.');
      }
    }

    await targetRef.delete().catch(() => {});
    console.log('adminDeleteUser:success', { targetUid, cleanup });
    return { ok: true, uid: targetUid, cleanup };
  } catch (error) {
    console.error('adminDeleteUser:failed', {
      targetUid,
      code: error?.code,
      message: error?.message,
      stack: error?.stack,
    });
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', error?.message || 'Failed to delete user.');
  }
});

export const adminDeleteEntry = onCall({ cors: true }, async (request) => {
  await requireAdminUser(request);
  const collectionName = String(request.data?.collectionName || '').trim();
  const id = String(request.data?.id || '').trim();

  if (!collectionName || !id) {
    throw new HttpsError('invalid-argument', 'collectionName and id are required.');
  }
  if (!DELETABLE_COLLECTIONS.has(collectionName)) {
    throw new HttpsError('permission-denied', 'This collection cannot be deleted from the admin dashboard.');
  }

  return deleteAdminRecord(collectionName, id);
});

const deleteUserOwnedData = async (uid, profile = {}) => {
  const deleted = {
    documents: 0,
    relatedDocuments: 0,
    storageFiles: 0,
    collections: {},
    expertRepliesDeleted: 0,
    inboxReadReceiptsRemoved: 0,
    expertReviewsAnonymized: 0,
  };

  const ownedQueries = [
    [VISION_DIAGNOSES, 'farmerId'],
    [FARMER_MESSAGES, 'farmerId'],
    [FARMER_CHAT, 'senderId'],
    [EXPERT_REQUESTS, 'farmerId'],
    [EXPERT_CONVERSATIONS, 'farmerId'],
    [EXPERT_CONVERSATIONS, 'expertId'],
    [FARMER_NOTES, 'expertId'],
    [PRICE_POSTS, 'farmerId'],
    [HYDRO_ALERTS, 'ownerId'],
    [HYDRO_DEVICES, 'ownerId'],
  ];

  for (const [collectionName, field] of ownedQueries) {
    try {
      const snapshot = await db.collection(collectionName).where(field, '==', uid).get();
      for (const docSnap of snapshot.docs) {
        const result = await deleteAdminRecord(collectionName, docSnap.id, docSnap);
        deleted.documents += result.deleted ? 1 : 0;
        deleted.relatedDocuments += result.relatedDocumentsDeleted ?? 0;
        deleted.storageFiles += result.storageDeleted ?? 0;
        deleted.collections[collectionName] = (deleted.collections[collectionName] ?? 0) + 1;
      }
    } catch (error) {
      console.error('adminDeleteUser:collection-cleanup-failed', {
        uid,
        collectionName,
        field,
        message: error?.message,
        code: error?.code,
      });
      throw new Error(`Failed cleaning ${collectionName}: ${error?.message || 'unknown error'}`);
    }
  }

  deleted.expertRepliesDeleted = await runUserCleanupStep(
    'expertRepliesDeleted',
    () => deleteExpertReplies(uid),
  );
  deleted.inboxReadReceiptsRemoved = await runUserCleanupStep(
    'inboxReadReceiptsRemoved',
    () => deleteInboxReadReceipts(uid),
  );
  deleted.expertReviewsAnonymized = await runUserCleanupStep(
    'expertReviewsAnonymized',
    () => anonymizeExpertReviews(uid),
  );

  const proofPath = parseStoragePath(profile.documentUrl);
  if (proofPath) {
    deleted.storageFiles += await deleteStoragePath(proofPath);
  }

  for (const prefix of [
    `expertProofs/${uid}/`,
    `${VISION_DIAGNOSES}/${uid}/`,
    `${FARMER_MESSAGES}/${uid}/`,
    `${FARMER_CHAT}/${uid}/`,
    `${PRICE_POSTS}/${uid}/`,
    `${EXPERT_REQUESTS}/${uid}/`,
    `${EXPERT_PENDING_REPLIES}/${uid}/`,
    `hydroVision/device_${uid}/`,
  ]) {
    deleted.storageFiles += await deleteStoragePrefix(prefix);
  }

  const readingRef = db.collection(HYDRO_READINGS).doc(`device_${uid}`);
  const readingSnap = await readingRef.get();
  if (readingSnap.exists) {
    await readingRef.delete();
    deleted.documents += 1;
    deleted.collections[HYDRO_READINGS] = (deleted.collections[HYDRO_READINGS] ?? 0) + 1;
  }

  return deleted;
};

const deleteAdminRecord = async (collectionName, id, existingSnap = null) => {
  const recordRef = db.collection(collectionName).doc(id);
  const recordSnap = existingSnap ?? (await recordRef.get());
  if (!recordSnap.exists) {
    return { ok: true, collectionName, id, deleted: false, storageDeleted: 0 };
  }

  const data = recordSnap.data() ?? {};
  const storagePaths = collectStoragePaths(data);
  let storageDeleted = 0;
  for (const path of storagePaths) {
    storageDeleted += await deleteStoragePath(path);
  }

  let relatedDocumentsDeleted = 0;
  if (collectionName === FARMER_MESSAGES) {
    relatedDocumentsDeleted = await deleteSubcollection(recordRef.collection(FARMER_MESSAGE_REPLIES));
  }
  if (collectionName === EXPERT_CONVERSATIONS) {
    const result = await deleteConversationMessages({
      db,
      collectionRef: recordRef.collection(EXPERT_CONVERSATION_MESSAGES),
      collectStoragePaths,
      deleteStoragePath,
    });
    relatedDocumentsDeleted = result.deleted;
    storageDeleted += result.storageDeleted;
  }

  await recordRef.delete();
  return {
    ok: true,
    collectionName,
    id,
    deleted: true,
    storageDeleted,
    relatedDocumentsDeleted,
  };
};

const runUserCleanupStep = async (step, operation) => {
  try {
    return await operation();
  } catch (error) {
    console.error('adminDeleteUser:cleanup-step-failed', {
      step,
      code: error?.code,
      message: error?.message,
    });
    throw new Error(`Failed cleanup step ${step}: ${error?.message || 'unknown error'}`);
  }
};

const deleteExpertReplies = async (uid) => {
  const messageSnapshot = await db.collection(FARMER_MESSAGES).get();
  const parentRefs = new Map();
  let deleted = 0;

  for (const messageDoc of messageSnapshot.docs) {
    const repliesSnapshot = await messageDoc.ref.collection(FARMER_MESSAGE_REPLIES).get();
    const matchingReplies = repliesSnapshot.docs.filter((replyDoc) => replyDoc.data()?.expertId === uid);
    if (!matchingReplies.length) continue;

    await deleteDocsInBatches(matchingReplies);
    deleted += matchingReplies.length;
    parentRefs.set(messageDoc.ref.path, messageDoc.ref);
  }

  if (parentRefs.size) {
    await Promise.all(
      Array.from(parentRefs.values()).map((parentRef) =>
        refreshFarmerMessageReplySummary(parentRef).catch((error) => {
          console.warn('adminDeleteUser:reply-summary-refresh-failed', parentRef.path, error?.message);
        }),
      ),
    );
  }

  return deleted;
};

const deleteInboxReadReceipts = async (uid) => {
  const snapshot = await db.collection(FARMER_MESSAGES).get();
  const docsWithReceipt = snapshot.docs.filter((docSnap) => {
    const readBy = docSnap.data()?.readBy;
    return readBy && Object.prototype.hasOwnProperty.call(readBy, uid);
  });
  if (!docsWithReceipt.length) return 0;

  await updateDocsInBatches(
    docsWithReceipt.map((docSnap) => ({
      ref: docSnap.ref,
      data: { [`readBy.${uid}`]: FieldValue.delete() },
    })),
  );

  return docsWithReceipt.length;
};

const anonymizeExpertReviews = async (uid) => {
  const snapshot = await db.collection(VISION_DIAGNOSES).where('reviewedBy', '==', uid).get();
  if (snapshot.empty) return 0;

  await updateDocsInBatches(
    snapshot.docs.map((docSnap) => ({
      ref: docSnap.ref,
      data: {
        reviewedBy: null,
        reviewedByName: 'Deleted expert',
        updatedAt: Date.now(),
        deletedExpertReviewRetained: true,
      },
    })),
  );

  return snapshot.size;
};

const refreshFarmerMessageReplySummary = async (messageRef) => {
  const [messageSnap, repliesSnap] = await Promise.all([
    messageRef.get(),
    messageRef.collection(FARMER_MESSAGE_REPLIES).orderBy('createdAt', 'desc').get(),
  ]);
  if (!messageSnap.exists) return;

  const latestReply = repliesSnap.docs[0]?.data();
  await messageRef.update({
    replyCount: repliesSnap.size,
    lastReplyPreview: latestReply?.body ? String(latestReply.body).slice(0, 160) : '',
    lastActivityAt: latestReply?.createdAt ?? messageSnap.data()?.createdAt ?? Date.now(),
  });
};

const deleteDocsInBatches = async (docs) => {
  for (let index = 0; index < docs.length; index += 450) {
    const batch = db.batch();
    docs.slice(index, index + 450).forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
  }
};

const updateDocsInBatches = async (updates) => {
  for (let index = 0; index < updates.length; index += 450) {
    const batch = db.batch();
    updates.slice(index, index + 450).forEach(({ ref, data }) => batch.update(ref, data));
    await batch.commit();
  }
};

const deleteSubcollection = async (collectionRef) => {
  let deleted = 0;
  while (true) {
    const snapshot = await collectionRef.limit(450).get();
    if (snapshot.empty) break;
    const batch = db.batch();
    snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
    deleted += snapshot.size;
    if (snapshot.size < 450) break;
  }
  return deleted;
};

const collectStoragePaths = (data = {}) => {
  const candidates = [
    data.imagePath,
    data.filePath,
    data.storagePath,
    data.imageUrl,
    data.fileUrl,
    data.documentUrl,
  ];
  if (['image', 'audio'].includes(data.type)) {
    candidates.push(data.content);
  }

  return Array.from(
    new Set(
      candidates
        .map(parseStoragePath)
        .filter(Boolean),
    ),
  );
};

const parseStoragePath = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const input = value.trim();

  if (!input.startsWith('http') && !input.startsWith('gs://')) {
    return isKnownStoragePath(input) ? input : null;
  }

  if (input.startsWith('gs://')) {
    const withoutScheme = input.slice('gs://'.length);
    const slashIndex = withoutScheme.indexOf('/');
    return slashIndex >= 0 ? withoutScheme.slice(slashIndex + 1) : null;
  }

  try {
    const url = new URL(input);
    const encodedObjectPath = url.pathname.match(/\/o\/([^/?]+)/)?.[1];
    if (encodedObjectPath) {
      return decodeURIComponent(encodedObjectPath);
    }

    if (url.hostname === 'storage.googleapis.com') {
      const [, , ...pathParts] = url.pathname.split('/');
      return pathParts.length ? decodeURIComponent(pathParts.join('/')) : null;
    }
  } catch {
    return null;
  }

  return null;
};

const isKnownStoragePath = (value) =>
  [
    'expertProofs/',
    `${VISION_DIAGNOSES}/`,
    `${FARMER_MESSAGES}/`,
    `${FARMER_CHAT}/`,
    `${PRICE_POSTS}/`,
    `${EXPERT_REQUESTS}/`,
    `${EXPERT_CONVERSATIONS}/`,
    `${EXPERT_PENDING_REPLIES}/`,
    'hydroVision/',
    'tts/',
  ].some((prefix) => value.startsWith(prefix));

const deleteStoragePath = async (path) => {
  if (!path) return 0;
  try {
    await storage.bucket().file(path).delete({ ignoreNotFound: true });
    return 1;
  } catch (error) {
    if (error?.code === 404) return 0;
    console.warn('adminDelete:storage-delete-failed', path, error?.message);
    return 0;
  }
};

const deleteStoragePrefix = async (prefix) => {
  try {
    const [files] = await storage.bucket().getFiles({ prefix });
    if (!files.length) return 0;
    await Promise.all(
      files.map((file) =>
        file.delete({ ignoreNotFound: true }).catch((error) => {
          if (error?.code !== 404) {
            console.warn('adminDelete:prefix-delete-failed', file.name, error?.message);
          }
        }),
      ),
    );
    return files.length;
  } catch (error) {
    console.warn('adminDelete:prefix-list-failed', prefix, error?.message);
    return 0;
  }
};

// ─── IoT: Ingest sensor data from ESP32 ──────────────────────────────────────
export const ingestSensorData = onCall(
  { timeoutSeconds: 30, cors: true },
  async (request) => {
    const { deviceId, tds, temperature, pumpOn } = request.data ?? {};

    if (!deviceId) {
      throw new HttpsError('invalid-argument', 'deviceId is required.');
    }

    // Verify device exists and get ownerId
    const deviceSnap = await db.collection('hydroDevices').doc(deviceId).get();
    if (!deviceSnap.exists) {
      throw new HttpsError('not-found', 'Device not registered. Register via the app first.');
    }

    const now = Date.now();
    const readingData = {
      tds: typeof tds === 'number' ? tds : null,
      temperature: typeof temperature === 'number' ? temperature : null,
      pumpOn: typeof pumpOn === 'boolean' ? pumpOn : false,
      timestamp: now,
    };

    // Write latest reading
    await db.collection('hydroReadings').doc(deviceId).set(readingData, { merge: true });

    // Read pump command if any
    const deviceData = deviceSnap.data();
    const pumpCommand = deviceData?.pumpCommand ?? null;
    const pumpCommandAt = deviceData?.pumpCommandAt ?? 0;
    const commandIsRecent = now - pumpCommandAt < 60_000; // 60s window

    return {
      ok: true,
      pumpCommand: commandIsRecent ? pumpCommand : null,
    };
  },
);

// ─── Plant vision analysis (AI deficiency detection) ─────────────────────────
export const analyzeVisionImage = onCall(
  { timeoutSeconds: 120, cors: true, secrets: [OPENAI_SECRET] },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Login required.');
    }

    const { deviceId, ownerId, imageUrl } = request.data ?? {};
    if (!imageUrl) throw new HttpsError('invalid-argument', 'imageUrl is required.');

    const openaiKey = OPENAI_SECRET.value();
    if (!openaiKey) throw new HttpsError('failed-precondition', 'OpenAI key missing.');

    const openai = new OpenAI({ apiKey: openaiKey });

    let analysisText = '';
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `You are a plant pathology expert specializing in hydroponic systems. Analyze this plant image for nutrient deficiencies, especially potassium (K), nitrogen (N), calcium (Ca), or magnesium (Mg).

                Respond in Arabic. Format your response as JSON with these fields:
                { "deficiency": "nutrient name or null", "confidence": 0.0-1.0, "message": "short diagnosis in Arabic", "recommendation": "treatment recommendation in Arabic" }`,
              },
              { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
            ],
          },
        ],
        max_tokens: 400,
        response_format: { type: 'json_object' },
      });

      analysisText = response.choices?.[0]?.message?.content ?? '{}';
    } catch (err) {
      console.error('Vision analysis error', err);
      throw new HttpsError('internal', 'Vision analysis failed.');
    }

    let parsed = {};
    try {
      parsed = JSON.parse(analysisText);
    } catch (error) {
      console.warn('Vision analysis JSON parse failed', error?.message);
    }

    const alertData = {
      deviceId: deviceId ?? null,
      ownerId: ownerId ?? request.auth.uid,
      type: parsed.deficiency ? `نقص ${parsed.deficiency}` : 'تحليل صحة النبات',
      confidence: parsed.confidence ?? null,
      message: parsed.message ?? 'تم التحليل.',
      recommendation: parsed.recommendation ?? null,
      imageUrl,
      status: 'open',
      createdAt: Date.now(),
    };

    const alertRef = await db.collection('hydroAlerts').add(alertData);
    return { ...alertData, id: alertRef.id };
  },
);

export const generateTtsAudio = onCall(
  { timeoutSeconds: 120, cors: true, secrets: [ELEVENLABS_SECRET] },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Login required before generating audio.');
    }

    const text = String(request.data?.text || '').trim();
    const cacheKey = String(request.data?.cacheKey || '').trim();
    const cleanPrefix = String(request.data?.cleanPrefix || '').trim();

    if (!text) {
      throw new HttpsError('invalid-argument', 'text is required.');
    }
    if (text.length > 1200) {
      throw new HttpsError('invalid-argument', 'text is too long.');
    }

    const apiKey = ELEVENLABS_SECRET.value();
    if (!apiKey) {
      throw new HttpsError('failed-precondition', 'ElevenLabs key missing on server.');
    }

    const safeKey = makeSafeStorageKey(cacheKey || `tts-${hashString(text)}`);
    const safePrefix = cleanPrefix ? makeSafeStorageKey(cleanPrefix) : '';
    const storagePath = `tts/${safeKey}.mp3`;
    const file = storage.bucket().file(storagePath);

    const [exists] = await file.exists();
    if (!exists) {
      const audioBuffer = await synthesizeTtsAudio(text, apiKey);
      await file.save(audioBuffer, {
        contentType: 'audio/mpeg',
        resumable: false,
        metadata: {
          cacheControl: 'public,max-age=86400',
        },
      });
    }

    if (safePrefix) {
      await cleanupOldTtsFiles(safePrefix, storagePath);
    }

    const audioUrl = await getDownloadURL(file);

    return { audioUrl, storagePath };
  },
);

const buildPrompt = (region, summary = {}) => {
  const days = Array.isArray(summary.forecast) ? summary.forecast.slice(0, 3) : [];
  const dayLines =
    days.map((day, index) => formatForecastLine(day, index)).join('\n') ||
    'لا تتوفر بيانات تفصيلية للأيام الثلاثة القادمة.';

  const risk = summary?.risk ?? 'مستقرة';

  return `
أنت خبير مغربي في زراعة الكرز الحلو في منطقة ${region}.
اكتب مذكرة يومية للمزارع بالعربية الفصحى على شكل ثلاث فقرات متدفقة بأسلوب محادثة طبيعي.

قواعد الكتابة الصارمة ولا استثناء فيها:
لا تستخدم أي من هذه الرموز أو التنسيقات: رمز الدرجة المئوية أو علامة النسبة المئوية أو الشرطة العمودية أو الأقواس أو النقطتين في منتصف الجملة أو علامة النجمة أو الأرقام المرقّمة كعناوين.
اكتب درجات الحرارة هكذا: "24 درجة" وليس "24 درجة مئوية".
اكتب النسب هكذا: "65 بالمئة" وليس "65 في المئة".
سمِّ الأيام بالاسم: "اليوم" و"غداً" و"بعد غد" ولا تستخدم التواريخ الرقمية.
اكتب الرياح هكذا: "20 كيلومتراً في الساعة".
النص مخصص للقراءة الصوتية لذا يجب أن يُقرأ بسلاسة تامة دون أي توقف مرتبك أو رمز غريب.
لا تُضِف أي قسم لمصادر البيانات أو تذييلات تقنية.

بيانات الطقس:
${dayLines}
مستوى الخطر: ${risk}

اكتب ثلاث فقرات:
الفقرة الأولى: صف حالة الطقس اليوم وأثرها المباشر على أشجار الكرز في المنطقة.
الفقرة الثانية: أعط توصيات عملية واضحة لكل يوم من الأيام الثلاثة في مجالات الري والتغطية والتسميد ومراقبة الآفات.
الفقرة الثالثة: نبّه المزارع إن وُجد خطر أو فرصة مهمة، ثم اختم بجملة تشجيعية واحدة.
لا تتجاوز 230 كلمة.
`.trim();
};

const formatForecastLine = (forecastDay, index) => {
  if (!forecastDay) {
    return `${labelFor(index)}: لا توجد بيانات.`;
  }

  const { tempMax, tempMin, avgHumidity, maxWind, rainChance, conditionAr, condition } = forecastDay;
  const cond = conditionAr || condition || 'غير معروفة';
  const r = (v) => Math.round(v);

  const parts = [
    `حالة ${cond}`,
    tempMax != null ? `أعلى درجة ${r(tempMax)} درجة` : null,
    tempMin != null ? `وأدنى ${r(tempMin)} درجة` : null,
    avgHumidity != null ? `رطوبة ${r(avgHumidity)} بالمئة` : null,
    maxWind != null ? `رياح تصل إلى ${r(maxWind)} كيلومتراً في الساعة` : null,
    rainChance != null ? `احتمال أمطار ${r(rainChance)} بالمئة` : null,
  ].filter(Boolean);

  return `${labelFor(index)}: ${parts.join('، ')}.`;
};

const labelFor = (index) => {
  if (index === 0) return 'اليوم';
  if (index === 1) return 'غداً';
  if (index === 2) return 'بعد غد';
  return `اليوم +${index}`;
};
const formatRegionId = (region) => encodeURIComponent(region.trim()).replace(/%/g, '_').toLowerCase();

const clampInteger = (value, min, max) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.round(clamp(number, min, max));
};

const dateKeyDaysAgo = (daysAgo = 0) => {
  const date = new Date(Date.now() - daysAgo * DAY_IN_MS);
  return formatDateKey(date);
};

const formatDateKey = (dateInput) => {
  const date = dateInput instanceof Date ? dateInput : resolveDate(dateInput);
  return date.toISOString().slice(0, 10);
};

const parseDateKey = (dateKey) => {
  const parsed = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }
  return parsed;
};

const addDaysToDateKey = (dateKey, offsetDays) => {
  const date = parseDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return formatDateKey(date);
};

const dateKeyRange = (startDateKey, endDateKey) => {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);
  if (start > end) {
    throw new Error('startDateKey must be before endDateKey');
  }
  const keys = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    keys.push(formatDateKey(cursor));
  }
  return keys;
};

const dailyWeatherDocId = (regionId, dateKey) => `${regionId}_${dateKey}`;

const writeDailyWeatherRange = async ({ startDateKey, endDateKey, sourceReason }) => {
  const expectedDateKeys = dateKeyRange(startDateKey, endDateKey);
  let written = 0;
  const failures = [];
  const perRegion = {};

  for (const region of REGION_CONFIG) {
    try {
      const dailyRecords = await fetchHistoricalDailyWeather(region, startDateKey, endDateKey);
      written += await writeDailyWeatherRecords(region, dailyRecords, sourceReason);
      perRegion[region.id] = dailyRecords.length;
    } catch (error) {
      console.warn('dailyWeatherCache:region-failed', region.id, error?.message);
      failures.push({ regionId: region.id, message: error?.message || String(error) });
      perRegion[region.id] = 0;
    }
  }

  const payload = {
    sourceReason,
    startDateKey,
    endDateKey,
    expectedDays: expectedDateKeys.length,
    written,
    failures,
    perRegion,
    updatedAt: Date.now(),
  };
  await WEATHER_CACHE_META_REF.set(payload, { merge: true });
  return payload;
};

const fetchHistoricalDailyWeather = async (region, startDateKey, endDateKey) => {
  const params = new URLSearchParams({
    latitude: region.centroid.lat.toString(),
    longitude: region.centroid.lon.toString(),
    start_date: startDateKey,
    end_date: endDateKey,
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'temperature_2m_mean',
      'relative_humidity_2m_mean',
      'precipitation_sum',
      'wind_speed_10m_max',
    ].join(','),
    timezone: 'UTC',
  });
  const url = `https://archive-api.open-meteo.com/v1/archive?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Open-Meteo archive fetch failed ${response.status}: ${errorText}`);
  }

  const json = await response.json();
  const daily = json?.daily ?? {};
  const times = daily.time ?? [];
  return times.map((dateKey, index) => ({
    dateKey,
    temperatureMaxC: numberOrNull(daily.temperature_2m_max?.[index]),
    temperatureMinC: numberOrNull(daily.temperature_2m_min?.[index]),
    temperatureMeanC: numberOrNull(daily.temperature_2m_mean?.[index]),
    humidityMeanPct: numberOrNull(daily.relative_humidity_2m_mean?.[index]),
    precipitationMm: numberOrNull(daily.precipitation_sum?.[index]) ?? 0,
    windMaxKmh: numberOrNull(daily.wind_speed_10m_max?.[index]),
  }));
};

const writeDailyWeatherRecords = async (region, dailyRecords, sourceReason) => {
  let written = 0;
  let batch = db.batch();
  let batchCount = 0;

  const commitBatch = async () => {
    if (!batchCount) return;
    await batch.commit();
    batch = db.batch();
    batchCount = 0;
  };

  for (const record of dailyRecords) {
    if (!record?.dateKey) continue;
    const ref = db.collection(DAILY_WEATHER_CACHE).doc(dailyWeatherDocId(region.id, record.dateKey));
    batch.set(
      ref,
      {
        regionId: region.id,
        regionName: region.name,
        dateKey: record.dateKey,
        latitude: region.centroid.lat,
        longitude: region.centroid.lon,
        source: 'open-meteo-archive',
        sourceReason,
        temperatureMaxC: record.temperatureMaxC,
        temperatureMinC: record.temperatureMinC,
        temperatureMeanC: record.temperatureMeanC,
        humidityMeanPct: record.humidityMeanPct,
        precipitationMm: record.precipitationMm,
        windMaxKmh: record.windMaxKmh,
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    written += 1;
    batchCount += 1;
    if (batchCount >= 450) {
      await commitBatch();
    }
  }

  await commitBatch();
  return written;
};

const enrichDiagnosisWeatherContext = async (diagnosisRef, diagnosis = {}) => {
  if (!diagnosisRef) {
    return { status: 'missing_ref', updated: false };
  }

  const region = resolveDiagnosisRegion(diagnosis);
  if (!region) {
    const weatherContext = makeWeatherContext({
      status: 'missing_region',
      reason: 'farmerRegion_missing_or_unmatched',
      diagnosis,
    });
    await diagnosisRef.set({ weatherContext }, { merge: true });
    return { status: weatherContext.status, updated: true };
  }

  const diagnosisDateKey = formatDateKey(resolveDate(diagnosis.createdAt));
  const endDateKey = addDaysToDateKey(diagnosisDateKey, -1);
  const startDateKey = addDaysToDateKey(endDateKey, -(DIAGNOSIS_WEATHER_LOOKBACK_DAYS - 1));
  const records = await readWeatherCacheRecords(region.id, startDateKey, endDateKey);
  const weatherContext = buildDiagnosisWeatherContext({
    diagnosis,
    region,
    diagnosisDateKey,
    startDateKey,
    endDateKey,
    records,
  });
  await diagnosisRef.set({ weatherContext }, { merge: true });
  return { status: weatherContext.status, updated: true };
};

const resolveDiagnosisRegion = (diagnosis = {}) => {
  const candidates = [
    diagnosis.farmerRegion,
    diagnosis.region,
    diagnosis.regionId,
    diagnosis.farmerCity,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const match = matchRegionConfig(candidate);
    if (match) return match;
  }

  return null;
};

const matchRegionConfig = (input) => {
  const value = normalizeRegionLookup(input);
  if (!value) return null;
  const compactValue = compactRegionLookup(value);

  for (const region of REGION_CONFIG) {
    const candidates = [region.id, region.name, ...(region.aliases ?? [])].map(normalizeRegionLookup);
    const compactCandidates = candidates.map(compactRegionLookup);
    if (
      candidates.includes(value) ||
      compactCandidates.includes(compactValue) ||
      candidates.some((candidate) => value.includes(candidate) || candidate.includes(value)) ||
      compactCandidates.some((candidate) => compactValue.includes(candidate) || candidate.includes(compactValue))
    ) {
      return region;
    }
  }

  return null;
};

const normalizeText = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const normalizeRegionLookup = (value) =>
  normalizeText(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const compactRegionLookup = (value) => value.replace(/\s+/g, '');

const readWeatherCacheRecords = async (regionId, startDateKey, endDateKey) => {
  const refs = dateKeyRange(startDateKey, endDateKey).map((dateKey) =>
    db.collection(DAILY_WEATHER_CACHE).doc(dailyWeatherDocId(regionId, dateKey)),
  );
  const snapshots = await Promise.all(refs.map((ref) => ref.get()));
  return snapshots
    .filter((snap) => snap.exists)
    .map((snap) => ({ id: snap.id, ...snap.data() }))
    .sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)));
};

const buildDiagnosisWeatherContext = ({
  diagnosis,
  region,
  diagnosisDateKey,
  startDateKey,
  endDateKey,
  records,
}) => {
  if (!records.length) {
    return makeWeatherContext({
      status: 'insufficient_cache',
      reason: 'no_weather_records_for_region_and_period',
      diagnosis,
      region,
      diagnosisDateKey,
      startDateKey,
      endDateKey,
      records,
    });
  }

  const rainLast7dMm = sumRecent(records, 'precipitationMm', 7);
  const rainLast14dMm = sumRecent(records, 'precipitationMm', 14);
  const rainLast30dMm = sumRecent(records, 'precipitationMm', 30);
  const humidityMean14dPct = averageRecent(records, 'humidityMeanPct', 14);
  const temperatureMax30dC = maxRecent(records, 'temperatureMaxC', 30);
  const temperatureMin30dC = minRecent(records, 'temperatureMinC', 30);
  const heatDays30d = countRecent(records, 30, (record) => Number(record.temperatureMaxC) >= 32);
  const frostDays30d = countRecent(records, 30, (record) => Number(record.temperatureMinC) <= 0);
  const wetDays7d = countRecent(records, 7, (record) => Number(record.precipitationMm) >= 1);
  const wetDays14d = countRecent(records, 14, (record) => Number(record.precipitationMm) >= 1);
  const wetStreakMax30d = maxConsecutiveRecent(records, 30, (record) => Number(record.precipitationMm) >= 1);

  return makeWeatherContext({
    status: records.length >= 7 ? 'ready' : 'partial',
    diagnosis,
    region,
    diagnosisDateKey,
    startDateKey,
    endDateKey,
    records,
    metrics: {
      rainLast7dMm,
      rainLast14dMm,
      rainLast30dMm,
      humidityMean14dPct,
      temperatureMax30dC,
      temperatureMin30dC,
      heatDays30d,
      frostDays30d,
      wetDays7d,
      wetDays14d,
      wetStreakMax30d,
    },
  });
};

const makeWeatherContext = ({
  status,
  reason = null,
  diagnosis = {},
  region = null,
  diagnosisDateKey = null,
  startDateKey = null,
  endDateKey = null,
  records = [],
  metrics = null,
}) => ({
  status,
  reason,
  source: DAILY_WEATHER_CACHE,
  provider: 'open-meteo',
  regionId: region?.id ?? null,
  regionName: region?.name ?? diagnosis.farmerRegion ?? null,
  diagnosisDateKey,
  lookback: {
    daysRequested: DIAGNOSIS_WEATHER_LOOKBACK_DAYS,
    startDateKey,
    endDateKey,
    daysAvailable: records.length,
  },
  metrics,
  populatedAt: Date.now(),
});

const sumRecent = (records, field, days) =>
  recentRecords(records, days).reduce((sum, record) => sum + (numberOrNull(record[field]) ?? 0), 0);

const averageRecent = (records, field, days) => {
  const values = recentRecords(records, days)
    .map((record) => numberOrNull(record[field]))
    .filter((value) => value != null);
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
};

const maxRecent = (records, field, days) => {
  const values = recentRecords(records, days)
    .map((record) => numberOrNull(record[field]))
    .filter((value) => value != null);
  return values.length ? Math.max(...values) : null;
};

const minRecent = (records, field, days) => {
  const values = recentRecords(records, days)
    .map((record) => numberOrNull(record[field]))
    .filter((value) => value != null);
  return values.length ? Math.min(...values) : null;
};

const countRecent = (records, days, predicate) => recentRecords(records, days).filter(predicate).length;

const maxConsecutiveRecent = (records, days, predicate) => {
  let max = 0;
  let current = 0;
  recentRecords(records, days).forEach((record) => {
    if (predicate(record)) {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  });
  return max;
};

const recentRecords = (records, days) => records.slice(Math.max(0, records.length - days));

const numberOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const requireAdminUser = async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Login required.');
  }

  const userSnap = await db.collection('users').doc(request.auth.uid).get();
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile missing.');
  }

  const user = { uid: request.auth.uid, ...userSnap.data() };
  if (user.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }

  return user;
};

const synthesizeTtsAudio = async (text, apiKey) => {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL_ID,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new HttpsError('internal', `TTS generation failed: ${errorText}`);
  }

  return Buffer.from(await response.arrayBuffer());
};

const cleanupOldTtsFiles = async (safePrefix, keepPath) => {
  const [files] = await storage.bucket().getFiles({ prefix: 'tts/' });
  const removals = files
    .filter((file) => file.name.startsWith(`tts/${safePrefix}`) && file.name !== keepPath)
    .map((file) => file.delete().catch(() => {}));

  if (removals.length) {
    await Promise.all(removals);
  }
};

const makeSafeStorageKey = (input = '') =>
  encodeURIComponent(input.trim())
    .replace(/%/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120) || `tts-${Date.now()}`;

const buildClimateSnapshot = async () => {
  const generatedAt = Date.now();
  const statsPerRegion = [];
  const timeWindow = completedSevenDayWindow(new Date(generatedAt));

  for (const region of REGION_CONFIG) {
    try {
      const baseStats = await fetchGfsMetrics(region, timeWindow);
      const scenarioStats = { current: baseStats };
      for (const [scenario, year] of Object.entries(SCENARIO_YEARS)) {
        if (scenario === 'current') continue;
        try {
          scenarioStats[scenario] = await fetchScenarioStats(region, year, timeWindow);
        } catch (error) {
          console.warn('buildClimateSnapshot:scenario-unavailable', region.id, scenario, error?.message);
        }
      }
      const viability = {};
      Object.entries(scenarioStats).forEach(([scenario, stats]) => {
        viability[scenario] = classifyViability(region, stats);
      });
      const economics = computeEconomics(region, scenarioStats);
      statsPerRegion.push({ region, baseStats, scenarioStats, viability, economics });
    } catch (error) {
      console.warn('buildClimateSnapshot:region-failed', region.id, error?.message);
    }
  }

  if (!statsPerRegion.length) {
    return SAMPLE_CLIMATE_PAYLOAD;
  }

  const temperatureFeatures = [];
  const rainfallFeatures = [];
  const chillFeatures = [];
  const droughtFeatures = [];
  const viabilityLayers = { current: [], '2030': [], '2050': [] };
  const riskScores = [];
  const regionSummaries = {};

  statsPerRegion.forEach(({ region, scenarioStats, viability, economics }) => {
    const currentStats = scenarioStats.current;
    temperatureFeatures.push(
      makeFeatureFromBounds(region.bounds, {
        label: region.name,
        tempMax: Number(currentStats.tempMax?.toFixed(1)),
        tempMin: Number(currentStats.tempMin?.toFixed(1)),
      }),
    );
    rainfallFeatures.push(
      makeFeatureFromBounds(region.bounds, {
        label: region.name,
        rainfallMm: Number(currentStats.rainfall7d?.toFixed(1)),
      }),
    );
    chillFeatures.push(
      makeFeatureFromBounds(region.bounds, {
        label: region.name,
        chillHours: Math.round(currentStats.chillHours), period: '7_completed_days', seasonalAssessment: 'unavailable',
      }),
    );
    droughtFeatures.push(
      makeFeatureFromBounds(region.bounds, {
        label: region.name,
        droughtIndex: Number(economics.droughtIndex.toFixed(2)),
      }),
    );

    ['current', '2030', '2050'].forEach((scenario) => {
      const stats = scenarioStats[scenario];
      if (!stats) return;
      viabilityLayers[scenario].push(
        makeFeatureFromBounds(region.bounds, {
          regionId: region.id,
          variety: region.variety,
          rating: viability[scenario]?.rating ?? 'غير محسوم', basis: 'seven_day_heat_rain_indicator', seasonalAssessment: 'unavailable',
        }),
      );
    });

    riskScores.push({
      regionId: region.id,
      regionName: region.name,
      score: Number((viability.current?.riskScore ?? 0).toFixed(2)),
      status: describeRisk(viability.current?.riskScore ?? 0),
      hint: economics.summary,
      trend: viability['2030']?.rating === viability.current?.rating ? 'stable' : 'up',
    });

    regionSummaries[region.id] = {
      name: region.name,
      source: 'open-meteo', asOf: generatedAt, isSample: false,
      dataStatus: scenarioStats['2030'] && scenarioStats['2050'] ? 'available' : 'partial',
      timeWindow, seasonalAssessment: 'unavailable', seasonalChillTarget: region.chillTarget,
      suitabilityTrend: economics.trend,
      rainfall: {
        current: Number(currentStats.rainfall7d?.toFixed(1)),
        future: scenarioStats['2030'] ? Number(scenarioStats['2030'].rainfall7d.toFixed(1)) : null,
        period: '7_completed_days', futureWindow: scenarioStats['2030']?.timeWindow || null,
      },
      chillHours: {
        current: Math.round(currentStats.chillHours),
        future: null, period: '7_completed_days', seasonalCurrent: null,
        seasonalAssessment: 'unavailable',
      },
      yieldImpact: null, priceDelta: null,
      recommendation: economics.recommendations,
    };
  });

  const folder = `climate/layers/${generatedAt}`;
  const [temperaturePath, rainfallPath, chillHoursPath, droughtPath] = await Promise.all([
    uploadGeoJsonLayer(`${folder}/temperature.json`, featureCollection(temperatureFeatures)),
    uploadGeoJsonLayer(`${folder}/rainfall.json`, featureCollection(rainfallFeatures)),
    uploadGeoJsonLayer(`${folder}/chillHours.json`, featureCollection(chillFeatures)),
    uploadGeoJsonLayer(`${folder}/drought.json`, featureCollection(droughtFeatures)),
  ]);

  const viabilityPaths = {};
  await Promise.all(
    Object.entries(viabilityLayers).map(async ([scenario, features]) => {
      viabilityPaths[scenario] = await uploadGeoJsonLayer(
        `${folder}/viability-${scenario}.json`,
        featureCollection(features),
      );
    }),
  );

  return {
    generatedAt, asOf: generatedAt, source: 'open-meteo', isSample: false,
    dataStatus: statsPerRegion.length === REGION_CONFIG.length && statsPerRegion.every(({ scenarioStats }) => scenarioStats['2030'] && scenarioStats['2050']) ? 'available' : 'partial',
    timeWindow, climateModel: CLIMATE_MODEL, seasonalAssessment: 'unavailable',
    warning: 'مؤشر الحرارة والهطول يغطي سبعة أيام. ملاءمة الأصناف والإنتاج تتطلب بيانات موسم البرودة وتقييم الخبير.',
    mapView: {
      center: [-5.2, 33.0],
      zoom: 5.2,
      bounds: [
        [Math.min(...REGION_CONFIG.map((r) => r.bounds.left)) - 0.5, Math.min(...REGION_CONFIG.map((r) => r.bounds.bottom)) - 0.5],
        [Math.max(...REGION_CONFIG.map((r) => r.bounds.right)) + 0.5, Math.max(...REGION_CONFIG.map((r) => r.bounds.top)) + 0.5],
      ],
    },
    layers: {
      temperaturePath,
      rainfallPath,
      chillHoursPath,
      droughtPath,
      viabilityPaths,
    },
    riskScores,
    regionSummaries,
  };
};

const fetchGfsMetrics = async (region, timeWindow) => {
  const params = new URLSearchParams({
    latitude: String(region.centroid.lat), longitude: String(region.centroid.lon),
    hourly: 'temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation',
    past_days: '7', forecast_days: '1', timezone: CLIMATE_TIMEZONE,
  });
  const response = await fetch(`https://api.open-meteo.com/v1/gfs?${params}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GFS request failed (${response.status}).`);
  const json = await response.json();
  return summarizeHourlyWindow(json.hourly || {}, timeWindow);
};

const fetchScenarioStats = async (region, year, timeWindow) => {
  const period = scenarioWindowForYear(timeWindow, year);
  const params = climateRequestParams(region, year, timeWindow);
  const response = await fetch(`https://climate-api.open-meteo.com/v1/climate?${params}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Climate request failed (${response.status}).`);
  const json = await response.json();
  return summarizeScenarioWindow(json.daily || {}, period);
};

// This is a recent heat/rain indicator, not a seasonal cultivar suitability score.
const classifyViability = (region, stats) => shortWindowRisk(region, stats);

const computeEconomics = (region, scenarioStats) => {
  const current = scenarioStats.current;
  const heatStress = Math.max(0, current.tempMax - 32);
  const droughtIndex = clamp((region.rainTarget - current.rainfall7d) / region.rainTarget, 0, 1);
  return {
    yieldImpact: null, priceDelta: null, droughtIndex,
    summary: droughtIndex > 0.6
      ? 'الهطول في الأيام السبعة الأخيرة أقل من المرجع؛ تحقق من رطوبة التربة قبل ضبط الري.'
      : heatStress > 2
        ? 'سجلت الفترة الأخيرة حرارة مرتفعة؛ راقب الإجهاد الحراري ورطوبة التربة.'
        : 'راقب الحرارة والهطول؛ بيانات موسم البرودة غير مكتملة.',
    recommendations: buildRecommendations(droughtIndex, heatStress),
    trend: 'هذه مقارنة مناخية لفترة من سبعة أيام، وليست حكماً على ملاءمة الصنف أو توقعاً للإنتاج.',
  };
};

const buildRecommendations = (droughtIndex, heatStress) => {
  const items = ['لا تستنتج نقص البرودة الموسمية من ساعات البرودة خلال أسبوع؛ راجع سجل الموسم مع الخبير.'];
  if (droughtIndex > 0.5) items.push('تحقق من رطوبة التربة ومخزون المياه قبل تعديل برنامج الري.');
  if (heatStress > 2) items.push('راقب علامات الإجهاد الحراري وناقش الحماية المناسبة مع الخبير.');
  return items;
};

const makeFeatureFromBounds = (bounds, properties = {}) => {
  const { left, right, top, bottom } = bounds;
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [left, top],
          [right, top],
          [right, bottom],
          [left, bottom],
          [left, top],
        ],
      ],
    },
  };
};

const resolveDate = (value) => {
  if (!value) return new Date();
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  return new Date();
};

const hashString = (input = '') => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
};
const describeRisk = (score) => {
  if (score > 0.7) return 'مرتفع';
  if (score > 0.45) return 'متوسط';
  return 'مستقر';
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const featureCollection = (features = []) => ({
  type: 'FeatureCollection',
  features,
});

const uploadGeoJsonLayer = async (path, data) => {
  const bucket = storage.bucket();
  await bucket.file(path).save(JSON.stringify(data), {
    contentType: 'application/json',
    resumable: false,
    gzip: true,
  });
  return path;
};

const SAMPLE_CLIMATE_PAYLOAD = {
  generatedAt: null, asOf: null, source: 'sample', isSample: true, dataStatus: 'sample',
  seasonalAssessment: 'unavailable',
  warning: 'بيانات توضيحية فقط. تعذر تأكيد بيانات المناخ الحالية؛ لا تستخدم هذه القيم لاتخاذ قرار.',
  mapView: { center: [-5.05, 33.95], zoom: 7.2 },
  layers: {
    temperature: featureCollection(REGION_CONFIG.map((region) => makeBox(
      [region.bounds.left, region.bounds.top],
      [region.bounds.right, region.bounds.bottom],
      { label: region.name, tempMax: region.id === 'taounate' ? 26 : 22, tempMin: ['azrou', 'ifrane'].includes(region.id) ? 7 : 11 },
    ))),
    rainfall: featureCollection(REGION_CONFIG.map((region) => makeBox(
      [region.bounds.left, region.bounds.top],
      [region.bounds.right, region.bounds.bottom],
      { label: region.name, rainfallMm: region.rainTarget },
    ))),
    chillHours: featureCollection(REGION_CONFIG.map((region) => makeBox(
      [region.bounds.left, region.bounds.top],
      [region.bounds.right, region.bounds.bottom],
      { label: region.name, chillHours: region.chillTarget },
    ))),
    drought: featureCollection(REGION_CONFIG.map((region) => makeBox(
      [region.bounds.left, region.bounds.top],
      [region.bounds.right, region.bounds.bottom],
      { label: region.name, droughtIndex: Number(clamp((50 - region.rainTarget) / 50, 0, 1).toFixed(2)) },
    ))),
    viability: {
      current: featureCollection(REGION_CONFIG.map((region) => makeBox(
        [region.bounds.left, region.bounds.top],
        [region.bounds.right, region.bounds.bottom],
        { regionId: region.id, variety: region.variety, rating: 'good' },
      ))),
      '2030': featureCollection(REGION_CONFIG.map((region) => makeBox(
        [region.bounds.left, region.bounds.top],
        [region.bounds.right, region.bounds.bottom],
        { regionId: region.id, variety: region.variety, rating: region.id === 'taounate' ? 'watch' : 'good' },
      ))),
      '2050': featureCollection(REGION_CONFIG.map((region) => makeBox(
        [region.bounds.left, region.bounds.top],
        [region.bounds.right, region.bounds.bottom],
        { regionId: region.id, variety: region.variety, rating: ['azrou', 'ifrane'].includes(region.id) ? 'good' : 'watch' },
      ))),
    },
  },
  riskScores: REGION_CONFIG.map((region) => ({
    regionId: region.id,
    regionName: region.name,
    score: region.id === 'taounate' ? 0.46 : region.id === 'ifrane' ? 0.22 : 0.34,
    status: ['taounate', 'el_hajeb'].includes(region.id) ? 'watch' : 'stable',
    hint: 'SweetCherry project region. Monitor chill, rainfall, humidity, heat, and frost pressure.',
    trend: region.id === 'taounate' ? 'up' : 'stable',
  })),
  regionSummaries: Object.fromEntries(REGION_CONFIG.map((region) => [
    region.id,
    {
      name: region.name, source: 'sample', asOf: null, isSample: true, dataStatus: 'sample',
      suitabilityTrend: 'Suitable cherry-growing region with monitoring needed for heat, frost, humidity, and rainfall.',
      rainfall: { current: region.rainTarget, future: Math.max(0, region.rainTarget - 5) },
      chillHours: { current: region.chillTarget, future: Math.max(0, region.chillTarget - 60) },
      recommendation: [
        'Monitor rainfall and humidity around flowering and fruit development.',
        'Use expert-reviewed diagnosis records to refine disease-risk guidance over time.',
      ],
    },
  ])),
};

function makeBox([lon1, lat1], [lon2, lat2], properties = {}) {
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [lon1, lat1],
          [lon2, lat1],
          [lon2, lat2],
          [lon1, lat2],
          [lon1, lat1],
        ],
      ],
    },
  };
}
