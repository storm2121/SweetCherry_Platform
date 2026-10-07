import { useCallback, useRef, useState } from 'react';
import { requestTtsAudio } from '../services/ttsService.js';

export const useTTS = () => {
  const [speaking, setSpeaking] = useState(false);
  const abortRef = useRef(null);
  const audioRef = useRef(null);
  const highlightedRef = useRef([]);
  const stopRequestedRef = useRef(false);
  const audioCacheRef = useRef(new Map());

  const clearHighlights = () => {
    highlightedRef.current.forEach((el) => el.classList.remove('tts-highlight'));
    highlightedRef.current = [];
  };

  const stop = useCallback(() => {
    stopRequestedRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    clearHighlights();
    setSpeaking(false);
  }, []);

  const speakElements = useCallback(
    async (elements = []) => {
      const visibleElements = Array.from(elements).filter(isElementVisible);
      if (!visibleElements.length) return;

      const targets = visibleElements
        .map((el, orderIndex) => {
          const rawText = el.innerText ?? '';
          const text = sanitizeText(rawText);
          if (!text) return null;
          return {
            el,
            text,
            key: buildKey(el, text, orderIndex),
            cleanPrefix:
              el.dataset.ttsCleanPrefix ||
              el.closest('[data-tts-clean-prefix]')?.dataset.ttsCleanPrefix ||
              null,
          };
        })
        .filter(Boolean);

      if (!targets.length) return;

      const audioPromises = new Map();
      const primeAudio = (idx) => {
        if (idx < 0 || idx >= targets.length || audioPromises.has(idx)) return;
        const target = targets[idx];
        const safeKey = makeSafeKey(target.key);
        const cache = audioCacheRef.current;
        if (cache.has(safeKey)) {
          audioPromises.set(idx, cache.get(safeKey));
          return;
        }

        const promise = getOrCreateAudio({
          key: target.key,
          text: target.text,
          cleanPrefix: target.cleanPrefix,
          cache,
        });
        cache.set(safeKey, promise);
        promise.catch(() => cache.delete(safeKey));
        audioPromises.set(idx, promise);
      };

      primeAudio(0);
      primeAudio(1);
      stopRequestedRef.current = false;
      setSpeaking(true);

      try {
        for (let i = 0; i < targets.length; i += 1) {
          if (stopRequestedRef.current) break;
          primeAudio(i);
          primeAudio(i + 1);

          const target = targets[i];
          const el = target.el;
          el.classList.add('tts-highlight');
          highlightedRef.current.push(el);

          const audioUrl = await audioPromises.get(i);
          await playAudio(audioUrl, abortRef, audioRef);

          el.classList.remove('tts-highlight');
          highlightedRef.current = highlightedRef.current.filter((node) => node !== el);
          primeAudio(i + 2);
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('TTS error', error);
          alert('تعذر تشغيل القراءة الصوتية حالياً.');
        }
      } finally {
        clearHighlights();
        setSpeaking(false);
      }
    },
    [],
  );

  return { speaking, speakElements, stop };
};

const buildKey = (element, text, index) => {
  if (element.dataset.ttsKey) return element.dataset.ttsKey;
  return `auto-${hashString(text)}-${index}`;
};

const hashString = (input = '') => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
};

let ttsQueue = Promise.resolve();
const serializeTTS = (fn) => {
  ttsQueue = ttsQueue.then(fn, fn);
  return ttsQueue;
};

const getOrCreateAudio = async ({ key, text, cleanPrefix, cache }) => {
  const safeKey = makeSafeKey(key);
  const audioUrl = await serializeTTS(() =>
    requestTtsAudio({ text, cacheKey: key, cleanPrefix }),
  );

  if (cleanPrefix) {
    purgeCacheEntries(cache, cleanPrefix, safeKey);
  }

  return audioUrl;
};

const purgeCacheEntries = (cache, prefix, keepKey) => {
  if (!prefix || !cache) return;
  const normalized = makeSafeKey(prefix);
  cache.forEach((_, cacheKey) => {
    if (cacheKey !== keepKey && cacheKey.startsWith(normalized)) {
      cache.delete(cacheKey);
    }
  });
};

const sanitizeText = (input = '') =>
  stripEmoji(input)
    .replace(/\s+/g, ' ')
    .trim();

const stripEmoji = (input = '') =>
  Array.from(input)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (code === 0x200d || code === 0xfe0f) return false;
      if (code >= 0x1f300 && code <= 0x1faff) return false;
      if (code >= 0x2600 && code <= 0x27bf) return false;
      return true;
    })
    .join('');

const makeSafeKey = (key = '') => key.replace(/\s+/g, '_');

const isElementVisible = (element) => {
  if (!(element instanceof Element)) return false;
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  const withinVertical = rect.bottom > 0 && rect.top < window.innerHeight;
  const withinHorizontal = rect.right > 0 && rect.left < window.innerWidth;
  return withinVertical && withinHorizontal;
};

const playAudio = async (url, abortRef, audioRef) => {
  const controller = new AbortController();
  abortRef.current = controller;
  const audio = new Audio(url);
  audioRef.current = audio;
  audio.playbackRate = 0.96;
  await audio.play();
  await new Promise((resolve, reject) => {
    audio.onended = resolve;
    audio.onerror = (event) => reject(event.error || new Error('Audio playback error'));
    controller.signal.addEventListener('abort', () => {
      audio.pause();
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
};
