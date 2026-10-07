// Thin React wrapper around edgeInferenceService.
// Exposes ready/backend/error state and a stable classify() callback so
// components can render loading skeletons while the model warms up.

import { useCallback, useEffect, useState } from 'react';
import { classifyImage, initEdgeInference } from '../services/edgeInferenceService.js';

export const useEdgeInference = () => {
  const [ready, setReady] = useState(false);
  const [backend, setBackend] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    initEdgeInference()
      .then(({ backend: b }) => {
        if (!alive) return;
        setBackend(b);
        setReady(true);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err);
      });
    return () => {
      alive = false;
    };
  }, []);

  const classify = useCallback(async (imageEl) => classifyImage(imageEl), []);

  return { ready, backend, error, classify };
};
