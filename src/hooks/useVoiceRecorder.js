import { useCallback, useEffect, useRef, useState } from 'react';
import { STORAGE_LIMITS } from '../services/constants.js';

// Records one voice note with MediaRecorder and hands back a File. Recording
// stops by itself at the length limit. Safari records audio/mp4, others webm.
export const useVoiceRecorder = ({ maxSeconds = STORAGE_LIMITS.audioMinutes * 60 } = {}) => {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [file, setFile] = useState(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const chunksRef = useRef([]);

  const releaseDevice = useCallback(() => {
    clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError('');
    setFile(null);
    setSeconds(0);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('هذا المتصفح لا يدعم التسجيل الصوتي.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        releaseDevice();
        setRecording(false);
        const mimeType = (recorder.mimeType || 'audio/webm').split(';')[0];
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (!blob.size) {
          setError('لم يُسجَّل أي صوت. حاول مرة أخرى.');
          return;
        }
        const extension = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
        setFile(new File([blob], `voice-${Date.now()}.${extension}`, { type: mimeType }));
      };

      recorder.start();
      setRecording(true);
      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        setSeconds(elapsed);
        if (elapsed >= maxSeconds) stop();
      }, 500);
    } catch {
      releaseDevice();
      setError('تعذّر استخدام الميكروفون. اسمح للمتصفح باستخدامه ثم أعد المحاولة.');
    }
  }, [maxSeconds, releaseDevice, stop]);

  const discard = useCallback(() => {
    setFile(null);
    setSeconds(0);
    setError('');
  }, []);

  useEffect(
    () => () => {
      if (recorderRef.current?.state === 'recording') {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      releaseDevice();
    },
    [releaseDevice],
  );

  return { recording, seconds, error, file, start, stop, discard };
};

export const formatDuration = (totalSeconds = 0) =>
  `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
