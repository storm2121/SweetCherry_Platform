export const validateLabelMap = (labels, classCount = 6) => {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels) || Object.keys(labels).length !== classCount) {
    throw new Error('The bundled classifier label map is incomplete.');
  }
  for (let index = 0; index < classCount; index += 1) {
    if (typeof labels[String(index)] !== 'string' || !labels[String(index)].trim()) {
      throw new Error('The bundled classifier label map is incomplete.');
    }
  }
  return labels;
};

export const validateModelSignature = (model, classCount = 6) => {
  const input = model.inputs?.[0]?.shape;
  // Some converted GraphModels omit symbolic output shapes; initialization also
  // validates the concrete [1, classCount] tensor from a full forward pass.
  const output = model.outputs?.[0]?.shape;
  if (model.inputs?.length !== 1 || model.outputs?.length !== 1 || input?.length !== 4
      || ![1, null, -1].includes(input[0]) || input[1] !== 224 || input[2] !== 224 || input[3] !== 3
      || (output && (output.length !== 2 || ![1, null, -1].includes(output[0]) || output[1] !== classCount))) {
    throw new Error('The bundled classifier does not match its image and label contract.');
  }
};

export const rankValidatedProbabilities = (values, labels, classCount = 6) => {
  validateLabelMap(labels, classCount);
  const probabilities = Array.from(values || []);
  if (probabilities.length !== classCount || !probabilities.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new Error('The classifier returned invalid probabilities.');
  }
  const sum = probabilities.reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) > 0.01) throw new Error('The classifier probabilities do not sum to one.');
  return probabilities.map((confidence, labelId) => ({ confidence, labelId, label: labels[String(labelId)] }))
    .sort((left, right) => right.confidence - left.confidence);
};

export const validateOutputTensor = (output, classCount = 6) => {
  if (output?.shape?.length !== 2 || output.shape[0] !== 1 || output.shape[1] !== classCount
      || typeof output.dataSync !== 'function') {
    throw new Error('The classifier returned an unexpected output shape.');
  }
  return output;
};

export const selectInferenceBackend = async (tf, backend) => {
  const selected = await tf.setBackend(backend);
  if (!selected) throw new Error(`The ${backend} backend is unavailable.`);
  await tf.ready();
  if (tf.getBackend() !== backend) throw new Error(`The ${backend} backend did not initialize.`);
  return backend;
};

export const bundledModelVersion = (fingerprint) => {
  if (!/^[a-f0-9]{64}$/.test(fingerprint || '')) throw new Error('The bundled model fingerprint is invalid.');
  return `cherry-multiclass-${fingerprint.slice(0, 16)}`;
};
