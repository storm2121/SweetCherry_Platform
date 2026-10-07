import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase.js';
import { regionDocId } from './regionUtils.js';

const AI_NOTES = 'aiNotes';
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const requestAiNote = httpsCallable(functions, 'generateAiNote');

export const ensureAiNoteForRegion = async ({ region, weatherSummary }) => {
  const existing = await fetchExisting(region);
  if (existing) {
    const data = existing.data();
    if (data.generatedAt && Date.now() - data.generatedAt < DAY_IN_MS) {
      return { id: existing.id, ...data };
    }
  }

  const response = await requestAiNote({
    region,
    weatherSummary,
  });

  return response.data;
};

const fetchExisting = async (region) => {
  const docRef = doc(db, AI_NOTES, regionDocId(region));
  const snapshot = await getDoc(docRef);
  return snapshot.exists() ? snapshot : null;
};
