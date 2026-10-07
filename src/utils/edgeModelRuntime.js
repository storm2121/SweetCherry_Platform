import {
  validateLabelMap, validateModelSignature, rankValidatedProbabilities,
  validateOutputTensor, selectInferenceBackend, bundledModelVersion,
} from './edgeModelContract.js';

// State is committed only after labels, model and a forward pass are valid.
export const createEdgeModelRuntime = ({ tf, metadata, loadNetworkModel }) => {
  const modelVersion = bundledModelVersion(metadata.fingerprint);
  const cacheUrl = `indexeddb://cherry-multiclass-${metadata.fingerprint}`;
  let readyState = null;
  let loading = null;

  const initialize = async (preferredBackend = 'webgl') => {
    const labels = validateLabelMap(metadata.labels, metadata.classCount);
    const backends = preferredBackend === 'cpu' ? ['cpu'] : ['webgl', 'cpu'];
    let lastError;
    for (const backend of backends) {
      let candidate = null;
      try {
        await selectInferenceBackend(tf, backend);
        let cached = false;
        try {
          candidate = await tf.loadGraphModel(cacheUrl);
          cached = true;
        } catch {
          candidate = await loadNetworkModel();
        }
        try {
          validateModelSignature(candidate, metadata.classCount);
          tf.tidy(() => {
            const output = validateOutputTensor(candidate.execute(tf.zeros(metadata.inputShape)), metadata.classCount);
            rankValidatedProbabilities(output.dataSync(), labels, metadata.classCount);
          });
        } catch (error) {
          if (!cached) throw error;
          candidate.dispose();
          candidate = null;
          candidate = await loadNetworkModel();
          validateModelSignature(candidate, metadata.classCount);
          tf.tidy(() => {
            const output = validateOutputTensor(candidate.execute(tf.zeros(metadata.inputShape)), metadata.classCount);
            rankValidatedProbabilities(output.dataSync(), labels, metadata.classCount);
          });
          cached = false;
        }
        if (!cached) await candidate.save(cacheUrl).catch(() => {});
        readyState = { model: candidate, labels, backend };
        return { backend, modelVersion, modelSource: 'bundled' };
      } catch (error) {
        candidate?.dispose();
        lastError = error;
      }
    }
    throw lastError || new Error('The bundled classifier could not initialize.');
  };

  const init = async () => {
    if (readyState) return { backend: readyState.backend, modelVersion, modelSource: 'bundled' };
    if (!loading) loading = initialize().finally(() => { loading = null; });
    return loading;
  };

  const classify = async (image) => {
    await init();
    const run = () => tf.tidy(() => {
      const pixels = tf.browser.fromPixels(image);
      const resized = tf.image.resizeBilinear(pixels, [224, 224]);
      const input = resized.toFloat().div(255).expandDims(0);
      const output = validateOutputTensor(readyState.model.execute(input), metadata.classCount);
      return rankValidatedProbabilities(output.dataSync(), readyState.labels, metadata.classCount);
    });
    let ranked;
    try { ranked = run(); }
    catch (error) {
      if (readyState.backend !== 'webgl') throw error;
      readyState.model.dispose();
      readyState = null;
      if (!loading) loading = initialize('cpu').finally(() => { loading = null; });
      await loading;
      ranked = run();
    }
    const winner = ranked[0];
    return {
      ...winner, top3: ranked.slice(0, 3), backend: readyState.backend,
      modelVersion, modelSource: 'bundled', assetFingerprint: metadata.fingerprint,
    };
  };

  return { init, classify, modelVersion };
};
