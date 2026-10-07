// Admin-only tester for the bundled six-class cherry-leaf GraphModel.
// Registry publication does not replace these deployed static model files.
import * as tf from '../utils/tensorflow.js';
import '@tensorflow/tfjs-backend-webgl';
import metadata from '../data/edgeModelFingerprint.json';
import { createEdgeModelRuntime } from '../utils/edgeModelRuntime.js';

const MODEL_BASE = '/models/cherry_multiclass/';

const fetchVerifiedAsset = async (path, expectedHash) => {
  const response = await fetch(`${MODEL_BASE}${path}?v=${metadata.fingerprint}`, { cache: 'no-cache' });
  if (!response.ok) throw new Error('The bundled model files are unavailable.');
  const bytes = await response.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const actualHash = Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
  if (actualHash !== expectedHash) throw new Error('The bundled model files do not match this application version.');
  return bytes;
};

const loadNetworkModel = async () => {
  const [manifestBytes, labelBytes] = await Promise.all([
    fetchVerifiedAsset('model.json', metadata.manifestSha256),
    fetchVerifiedAsset('labels.json', metadata.labelsSha256),
  ]);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const manifest = JSON.parse(decoder.decode(manifestBytes));
  const labels = JSON.parse(decoder.decode(labelBytes));
  if (JSON.stringify(labels) !== JSON.stringify(metadata.labels)) throw new Error('The model labels do not match this application version.');
  const paths = manifest.weightsManifest.flatMap((group) => group.paths);
  if (JSON.stringify(paths) !== JSON.stringify(metadata.shards.map((shard) => shard.path))) {
    throw new Error('The model weight manifest is incomplete.');
  }
  const buffers = await Promise.all(metadata.shards.map((shard) => fetchVerifiedAsset(shard.path, shard.sha256)));
  const weightData = new Uint8Array(buffers.reduce((length, buffer) => length + buffer.byteLength, 0));
  let offset = 0;
  for (const buffer of buffers) { weightData.set(new Uint8Array(buffer), offset); offset += buffer.byteLength; }
  return tf.loadGraphModel({
    load: async () => ({
      modelTopology: manifest.modelTopology,
      weightSpecs: manifest.weightsManifest.flatMap((group) => group.weights),
      weightData: weightData.buffer, format: manifest.format, generatedBy: manifest.generatedBy,
      convertedBy: manifest.convertedBy, signature: manifest.signature,
      userDefinedMetadata: manifest.userDefinedMetadata, modelInitializer: manifest.modelInitializer,
    }),
  });
};

const runtime = createEdgeModelRuntime({ tf, metadata, loadNetworkModel });
export const edgeInferenceModelVersion = runtime.modelVersion;
export const initEdgeInference = runtime.init;
export const classifyImage = runtime.classify;
