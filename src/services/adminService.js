import { addDoc, collection, doc, getDoc, getDocs, orderBy, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase.js';

const USERS = 'users';
const DATASET_IMAGES = 'datasetImages';
const MODEL_TRAINING_JOBS = 'modelTrainingJobs';
const MODEL_CANDIDATES = 'modelCandidates';
const MODEL_REGISTRY = 'modelRegistry';
const deleteUserCallable = httpsCallable(functions, 'adminDeleteUser');
const deleteEntryCallable = httpsCallable(functions, 'adminDeleteEntry');
const backfillDailyWeatherCacheCallable = httpsCallable(functions, 'backfillDailyWeatherCache');
const backfillDiagnosisWeatherContextCallable = httpsCallable(functions, 'backfillDiagnosisWeatherContext');

export const ADMIN_CONTENT_SECTIONS = [
  {
    key: 'diagnoses',
    label: 'تشخيصات الصور',
    collectionName: 'visionDiagnoses',
    orderField: 'createdAt',
    description: 'صور التشخيص المنظمة مع مراجعات الخبراء.',
  },
  {
    key: 'farmerMessages',
    label: 'رسائل الخبراء',
    collectionName: 'farmerMessages',
    orderField: 'createdAt',
    description: 'الصور والتسجيلات التي يرسلها المزارعون للخبراء.',
  },
  {
    key: 'farmerChat',
    label: 'غرفة المزارعين',
    collectionName: 'farmerChat',
    orderField: 'createdAt',
    description: 'رسائل المجتمع العامة، نصوص ووسائط.',
  },
  {
    key: 'expertNotes',
    label: 'توجيهات الخبراء',
    collectionName: 'farmerNotes',
    orderField: 'createdAt',
    description: 'النصائح المنشورة للمزارعين حسب المنطقة.',
  },
  {
    key: 'pricePosts',
    label: 'منشورات الأسعار',
    collectionName: 'pricePosts',
    orderField: 'createdAt',
    description: 'أسعار وصور السوق التي أضافها المزارعون.',
  },
  {
    key: 'hydroAlerts',
    label: 'تنبيهات الهيدروبونيك',
    collectionName: 'hydroAlerts',
    orderField: 'createdAt',
    description: 'تنبيهات تحليل صور الهيدروبونيك.',
  },
];

export const getPendingExperts = async () => {
  const q = query(
    collection(db, USERS),
    where('role', '==', 'expert'),
    where('status', 'in', ['pending', 'rejected']),
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
};

export const updateExpertStatus = async (uid, status) => {
  await updateDoc(doc(db, USERS, uid), { status });
};

export const listUsers = async () => {
  const snapshot = await getDocs(collection(db, USERS));
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
};

export const deleteUser = async (uid) => {
  const result = await deleteUserCallable({ uid });
  return result.data;
};

export const listAdminContent = async () => {
  const entries = await Promise.all(
    ADMIN_CONTENT_SECTIONS.map(async (section) => {
      const snapshot = await getDocs(
        query(collection(db, section.collectionName), orderBy(section.orderField, 'desc')),
      );
      return [
        section.key,
        snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          collectionName: section.collectionName,
          ...docSnap.data(),
        })),
      ];
    }),
  );

  return Object.fromEntries(entries);
};

export const listDatasetImages = async () => {
  const snapshot = await getDocs(collection(db, DATASET_IMAGES));
  return snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    collectionName: DATASET_IMAGES,
    ...docSnap.data(),
  }));
};

export const deleteAdminEntry = async ({ collectionName, id }) => {
  const result = await deleteEntryCallable({ collectionName, id });
  return result.data;
};

export const backfillDailyWeatherCache = async ({ days = 90 } = {}) => {
  const result = await backfillDailyWeatherCacheCallable({ days });
  return result.data;
};

export const backfillDiagnosisWeatherContext = async ({ limit = 100, includeExisting = false } = {}) => {
  const result = await backfillDiagnosisWeatherContextCallable({ limit, includeExisting });
  return result.data;
};

export const createModelTrainingJob = async ({
  targetPart,
  selectedLabels,
  minReviewedCount,
  manifestItems = [],
  labelCounts = {},
  admin,
}) => {
  const now = Date.now();
  const safeLabels = Array.from(new Set((selectedLabels ?? []).filter(Boolean)));
  const jobRef = await addDoc(collection(db, MODEL_TRAINING_JOBS), {
    targetPart,
    selectedLabels: safeLabels,
    minReviewedCount: Number(minReviewedCount) || 0,
    status: 'manifest_ready',
    manifestPath: null,
    labelCounts,
    manifestItemCount: manifestItems.length,
    createdBy: admin?.uid ?? null,
    createdByName: admin?.name || admin?.displayName || admin?.phone || 'Admin',
    createdAt: now,
    updatedAt: now,
    error: null,
  });

  await setDoc(
    jobRef,
    {
      manifestPath: `${MODEL_TRAINING_JOBS}/${jobRef.id}/manifestItems`,
    },
    { merge: true },
  );

  for (let index = 0; index < manifestItems.length; index += 450) {
    const batch = writeBatch(db);
    manifestItems.slice(index, index + 450).forEach((item, offset) => {
      const docId = String(index + offset).padStart(6, '0');
      batch.set(doc(db, MODEL_TRAINING_JOBS, jobRef.id, 'manifestItems', docId), item);
    });
    await batch.commit();
  }

  const sourceCounts = manifestItems.reduce((acc, item) => {
    const key = item.sourceType || 'expert_review';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  await setDoc(
    jobRef,
    {
      sourceCounts,
      sourceCollections: Array.from(
        new Set(manifestItems.map((item) => item.sourceCollection).filter(Boolean)),
      ),
    },
    { merge: true },
  );

  return { id: jobRef.id, targetPart, selectedLabels: safeLabels, manifestItems, labelCounts, sourceCounts };
};

export const listModelTrainingJobs = async () => {
  const snapshot = await getDocs(
    query(collection(db, MODEL_TRAINING_JOBS), orderBy('createdAt', 'desc')),
  );
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
};

export const listModelCandidates = async () => {
  const snapshot = await getDocs(
    query(collection(db, MODEL_CANDIDATES), orderBy('createdAt', 'desc')),
  );
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
};

export const publishModelCandidate = async ({ candidateId, admin }) => {
  const candidateRef = doc(db, MODEL_CANDIDATES, candidateId);
  const candidateSnap = await getDoc(candidateRef);
  if (!candidateSnap.exists()) {
    throw new Error('Model candidate not found.');
  }

  const candidate = candidateSnap.data();
  const modelJson = candidate.artifactPaths?.modelJson;
  const labelsJson = candidate.artifactPaths?.labelsJson;
  if (!modelJson || !labelsJson) {
    throw new Error('Candidate is missing model or labels artifacts.');
  }

  const now = Date.now();
  const previouslyPublished = await getDocs(
    query(collection(db, MODEL_CANDIDATES), where('status', '==', 'published')),
  );
  const batch = writeBatch(db);
  previouslyPublished.docs.forEach((docSnap) => {
    if (docSnap.id !== candidateId) {
      batch.update(docSnap.ref, { status: 'candidate', unpublishedAt: now });
    }
  });
  batch.update(candidateRef, {
    status: 'published',
    publishedAt: now,
    publishedBy: admin?.uid ?? null,
  });
  batch.set(doc(db, MODEL_REGISTRY, 'current'), {
    candidateId,
    modelVersion: candidate.modelVersion || candidateId,
    modelUrl: modelJson,
    labelsUrl: labelsJson,
    targetPart: candidate.targetPart ?? null,
    publishedAt: now,
    publishedBy: admin?.uid ?? null,
  });
  await batch.commit();

  return { candidateId, modelVersion: candidate.modelVersion || candidateId };
};
