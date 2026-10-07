import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as tf from '../src/utils/tensorflow.js';
import { validateModelSignature, rankValidatedProbabilities, validateOutputTensor } from '../src/utils/edgeModelContract.js';

const root = new URL('../', import.meta.url);
const modelDir = new URL('public/models/cherry_multiclass/', root);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('real bundled GraphModel cold-loads and returns six finite normalized class scores', async () => {
  const metadata = JSON.parse(await readFile(new URL('src/data/edgeModelFingerprint.json', root), 'utf8'));
  const manifestBytes = await readFile(new URL('model.json', modelDir));
  const labelBytes = await readFile(new URL('labels.json', modelDir));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const labels = JSON.parse(labelBytes.toString('utf8'));
  assert.equal(sha(manifestBytes), metadata.manifestSha256);
  assert.equal(sha(labelBytes), metadata.labelsSha256);
  const parts = [manifestBytes, labelBytes];
  const buffers = [];
  for (const shard of metadata.shards) {
    const bytes = await readFile(new URL(shard.path, modelDir));
    assert.equal(bytes.length, shard.bytes); assert.equal(sha(bytes), shard.sha256);
    parts.push(bytes); buffers.push(bytes);
  }
  const fingerprint = createHash('sha256');
  for (const bytes of parts) fingerprint.update(bytes);
  assert.equal(fingerprint.digest('hex'), metadata.fingerprint);
  const weightData = new Uint8Array(buffers.reduce((total, bytes) => total + bytes.length, 0));
  let offset = 0;
  for (const bytes of buffers) { weightData.set(bytes, offset); offset += bytes.length; }
  await tf.setBackend('cpu'); await tf.ready();
  const before = tf.memory().numTensors;
  const model = await tf.loadGraphModel({ load: async () => ({
    modelTopology: manifest.modelTopology, weightSpecs: manifest.weightsManifest.flatMap((group) => group.weights),
    weightData: weightData.buffer, format: manifest.format, generatedBy: manifest.generatedBy,
    convertedBy: manifest.convertedBy, signature: manifest.signature, modelInitializer: manifest.modelInitializer,
  }) });
  try {
    validateModelSignature(model, 6);
    for (const fill of [0, 0.5]) {
      tf.tidy(() => {
        const input = tf.fill([1, 224, 224, 3], fill, 'float32');
        const output = validateOutputTensor(model.execute(input), 6);
        const ranked = rankValidatedProbabilities(output.dataSync(), labels, 6);
        assert.equal(ranked.length, 6); assert.ok(ranked.every((entry) => Number.isFinite(entry.confidence)));
      });
    }
  } finally { model.dispose(); }
  assert.equal(tf.memory().numTensors, before, 'smoke inference releases its model and tensors');
});
