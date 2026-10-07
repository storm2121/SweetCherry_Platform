import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../config/firebase.js';
import { DIAGNOSIS_STATUS, VISION_DIAGNOSES } from './diagnosisConstants.js';
import { regionDocId } from './regionUtils.js';

const FARMER_MESSAGES = 'farmerMessages';
const FARMER_MESSAGE_REPLIES = 'replies';
const FARMER_NOTES = 'farmerNotes';
const FARMER_NOTE_SCOPE_CURRENT = 'expert_region_current';

export const subscribeInbox = (callback, expert) => {
  const q = query(collection(db, FARMER_MESSAGES), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snapshot) => {
    const messages = snapshot.docs
      .map((docSnap) => normalizeInboxThread(docSnap, expert?.uid))
      .sort((a, b) => timestampMs(b.lastActivityAt) - timestampMs(a.lastActivityAt));
    callback(messages);
  });
};

export const subscribeInboxReplies = (messageId, callback) => {
  if (!messageId) return () => {};
  const q = query(
    collection(db, FARMER_MESSAGES, messageId, FARMER_MESSAGE_REPLIES),
    orderBy('createdAt', 'asc'),
  );
  return onSnapshot(q, (snapshot) => {
    const replies = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    callback(replies);
  });
};

export const markInboxMessageRead = async ({ messageId, expert }) => {
  if (!messageId || !expert?.uid) return;
  await updateDoc(doc(db, FARMER_MESSAGES, messageId), {
    [`readBy.${expert.uid}`]: serverTimestamp(),
  });
};

export const addInboxReply = async ({ messageId, expert, body }) => {
  const text = String(body || '').trim();
  if (!messageId || !expert?.uid || !text) {
    throw new Error('Reply text is required.');
  }

  await addDoc(collection(db, FARMER_MESSAGES, messageId, FARMER_MESSAGE_REPLIES), {
    expertId: expert.uid,
    expertName: expert.name || 'Expert',
    body: text,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await updateDoc(doc(db, FARMER_MESSAGES, messageId), {
    lastActivityAt: serverTimestamp(),
    lastReplyPreview: text.slice(0, 140),
    replyCount: increment(1),
    [`readBy.${expert.uid}`]: serverTimestamp(),
  });
};

export const subscribeExpertNotes = (expertId, callback) => {
  if (!expertId) return () => {};
  const q = query(collection(db, FARMER_NOTES), where('expertId', '==', expertId));
  return onSnapshot(q, (snapshot) => {
    const notes = snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((note) => note.scope === FARMER_NOTE_SCOPE_CURRENT && note.active !== false)
      .sort((a, b) => timestampMs(b.updatedAt || b.createdAt) - timestampMs(a.updatedAt || a.createdAt));
    callback(notes);
  });
};

export const publishExpertNotes = async ({ expert, subject, body, regions }) => {
  const tasks = regions.map((region) => saveExpertNote({ expert, subject, body, region }));
  await Promise.all(tasks);
};

export const saveExpertNote = async ({ expert, subject, body, region }) => {
  const cleanRegion = String(region || '').trim();
  const cleanSubject = String(subject || '').trim();
  const cleanBody = String(body || '').trim();
  if (!expert?.uid || !cleanRegion || !cleanSubject || !cleanBody) {
    throw new Error('Expert, region, subject, and note body are required.');
  }

  const noteRef = doc(db, FARMER_NOTES, currentNoteId(cleanRegion, expert.uid));
  const existing = await getDoc(noteRef);
  const createdAt = existing.exists() ? existing.data()?.createdAt ?? serverTimestamp() : serverTimestamp();
  await setDoc(
    noteRef,
    {
      scope: FARMER_NOTE_SCOPE_CURRENT,
      currentKey: `${regionDocId(cleanRegion)}:${expert.uid}`,
      region: cleanRegion,
      subject: cleanSubject,
      body: cleanBody,
      expertId: expert.uid,
      expertName: expert.name || 'Expert',
      active: true,
      updatedAt: serverTimestamp(),
      createdAt,
    },
    { merge: true },
  );
};

export const deleteExpertNote = async ({ expert, region }) => {
  const cleanRegion = String(region || '').trim();
  if (!expert?.uid || !cleanRegion) {
    throw new Error('Expert and region are required.');
  }
  await deleteDoc(doc(db, FARMER_NOTES, currentNoteId(cleanRegion, expert.uid)));
};

export const saveExpertNotesForRegions = async ({ expert, subject, body, regions }) => {
  const tasks = regions.map((region) => saveExpertNote({ expert, subject, body, region }));
  await Promise.all(tasks);
};

const currentNoteId = (region, expertId) => `${regionDocId(region)}__${expertId}`;

export const subscribeVisionDiagnoses = (callback, onError) => {
  const q = query(collection(db, VISION_DIAGNOSES), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const diagnoses = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      callback(diagnoses);
    },
    onError,
  );
};

// One expert reviews a photo at a time. Taking a photo claims it for 30
// minutes; saving a draft renews the claim. firestore.rules enforces the same
// limits, so an outdated screen cannot overwrite another expert's review.
export const CLAIM_MINUTES = 30;

export const claimLapsed = (diagnosis, now = Date.now()) => {
  const claimedAt = timestampMs(diagnosis?.claimedAt) || timestampMs(diagnosis?.updatedAt);
  return !claimedAt || now - claimedAt > CLAIM_MINUTES * 60 * 1000;
};

const reviewError = (code, message) => Object.assign(new Error(message), { code });

export const claimDiagnosis = ({ diagnosisId, expert }) => {
  const diagnosisRef = doc(db, VISION_DIAGNOSES, diagnosisId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(diagnosisRef);
    if (!snapshot.exists()) throw reviewError('review/missing', 'لم تعد هذه الصورة موجودة.');

    const diagnosis = snapshot.data();
    const holder = diagnosis.reviewedBy ?? null;
    const claimable =
      diagnosis.status === DIAGNOSIS_STATUS.awaiting ||
      (diagnosis.status === DIAGNOSIS_STATUS.inReview &&
        (holder === expert.uid || !holder || claimLapsed(diagnosis)));
    if (!claimable) {
      throw diagnosis.status === DIAGNOSIS_STATUS.inReview
        ? reviewError('review/claimed', `يراجع ${diagnosis.reviewedByName || 'خبير آخر'} هذه الصورة الآن.`)
        : reviewError('review/finished', 'انتهت مراجعة هذه الصورة.');
    }

    transaction.update(diagnosisRef, {
      status: DIAGNOSIS_STATUS.inReview,
      reviewedBy: expert.uid,
      reviewedByName: expert.name ?? null,
      claimedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
};

// Hands the photo back to the queue. The draft stays for whoever takes it next.
export const releaseDiagnosis = ({ diagnosisId }) =>
  updateDoc(doc(db, VISION_DIAGNOSES, diagnosisId), {
    status: DIAGNOSIS_STATUS.awaiting,
    reviewedBy: null,
    reviewedByName: null,
    updatedAt: serverTimestamp(),
  });

export const describeReviewError = (error) => {
  if (error?.code?.startsWith('review/')) return error.message;
  if (error?.code === 'permission-denied') {
    return `تعذّر الحفظ: ربما تولّى خبير آخر هذه الصورة، أو انتهت مدة حجزك (${CLAIM_MINUTES} دقيقة). أعد فتح الصورة ثم حاول.`;
  }
  if (error?.code === 'unavailable') return 'لا يوجد اتصال بالشبكة. أعد المحاولة بعد عودة الاتصال.';
  return 'تعذّر حفظ المراجعة. حاول مرة أخرى.';
};

export const saveDiagnosisDraft = async ({ diagnosisId, expert, review }) => {
  await updateDoc(doc(db, VISION_DIAGNOSES, diagnosisId), {
    ...normalizeReview(review),
    status: DIAGNOSIS_STATUS.inReview,
    reviewedBy: expert?.uid ?? null,
    reviewedByName: expert?.name ?? null,
    claimedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const submitDiagnosisReview = async ({ diagnosisId, expert, review }) => {
  await updateDoc(doc(db, VISION_DIAGNOSES, diagnosisId), {
    ...normalizeReview(review),
    status: DIAGNOSIS_STATUS.reviewed,
    reviewedBy: expert?.uid ?? null,
    reviewedByName: expert?.name ?? null,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const rejectDiagnosisReview = async ({ diagnosisId, expert, review }) => {
  await updateDoc(doc(db, VISION_DIAGNOSES, diagnosisId), {
    ...normalizeReview(review),
    status: DIAGNOSIS_STATUS.rejected,
    imageQuality: review.imageQuality || 'unusable',
    reviewedBy: expert?.uid ?? null,
    reviewedByName: expert?.name ?? null,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

const normalizeReview = (review = {}) => {
  const sourceObservations = Array.isArray(review.observations)
    ? review.observations
    : Array.isArray(review.problems)
      ? review.problems
      : [];
  const observations = sourceObservations.map((observation) => ({
    bodyPart: observation.bodyPart || '',
    problemType: observation.problemType || '',
    manualLabel: observation.manualLabel || '',
    severity: observation.severity || 'mild',
    confidence: observation.confidence || 'medium',
    spread: observation.spread || 'few_spots',
  }));
  const visibleParts = uniqueStrings([
    ...(Array.isArray(review.visibleParts) ? review.visibleParts : []),
    ...observations.map((observation) => observation.bodyPart),
  ]);
  const primaryBodyPart = visibleParts[0] || null;
  const overallSeverity = review.overallSeverity || deriveOverallSeverity(observations);

  return {
    visibleParts,
    observations,
    bodyPart: primaryBodyPart,
    primaryBodyPart,
    imageQuality: review.imageQuality || null,
    problems: observations,
    manualLabel: review.manualLabel || '',
    overallSeverity,
    recommendedAction: review.recommendedAction || '',
    expertNote: review.expertNote || review.recommendedAction || '',
  };
};

const uniqueStrings = (values = []) =>
  Array.from(new Set(values.filter((value) => typeof value === 'string' && value.trim())));

const deriveOverallSeverity = (observations = []) => {
  const rank = {
    none: 0,
    mild: 1,
    moderate: 2,
    severe: 3,
    critical: 4,
  };
  return observations.reduce((highest, observation) => {
    const current = observation.severity || null;
    if (!current) return highest;
    if (!highest) return current;
    return rank[current] > rank[highest] ? current : highest;
  }, null);
};

const normalizeInboxThread = (docSnap, expertId) => {
  const data = docSnap.data();
  const lastActivityAt = data.lastActivityAt || data.createdAt || null;
  const readAt = expertId ? data.readBy?.[expertId] : null;
  return {
    id: docSnap.id,
    ...data,
    lastActivityAt,
    isUnread: !!expertId && timestampMs(lastActivityAt) > timestampMs(readAt),
    replyCount: Number(data.replyCount || 0),
  };
};

const timestampMs = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value) || 0;
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
};
