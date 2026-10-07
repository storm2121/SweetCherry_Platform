import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase.js';

const generateTtsAudio = httpsCallable(functions, 'generateTtsAudio');

export const requestTtsAudio = async ({ text, cacheKey, cleanPrefix }) => {
  const response = await generateTtsAudio({ text, cacheKey, cleanPrefix });
  const audioUrl = response.data?.audioUrl;
  if (!audioUrl) {
    throw new Error('TTS audio URL missing.');
  }
  return audioUrl;
};
