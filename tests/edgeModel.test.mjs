import test from 'node:test';
import assert from 'node:assert/strict';
import { bundledModelVersion, rankValidatedProbabilities, validateLabelMap, validateOutputTensor } from '../src/utils/edgeModelContract.js';
import { createEdgeModelRuntime } from '../src/utils/edgeModelRuntime.js';

const labels = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [String(index), `class ${index}`]));
const metadata = { fingerprint: 'a'.repeat(64), classCount: 6, inputShape: [1, 224, 224, 3], labels };
const values = [0.1, 0.05, 0.6, 0.15, 0.05, 0.05];

const makeFixture = ({ webglFalse = false, readyFailure = false, imageFailure = false, cachedBad = false, networkFailure = false } = {}) => {
  let backend;
  let loads = 0;
  let networkLoads = 0;
  let disposals = 0;
  const cacheUrls = [];
  const tensor = (kind) => ({ kind, toFloat() { return this; }, div() { return this; }, expandDims() { return this; } });
  const model = (bad = false) => ({
    inputs: [{ shape: [1, 224, 224, 3] }], outputs: [{ shape: [1, bad ? 38 : 6] }],
    execute(input) {
      if (imageFailure && input.kind === 'image' && backend === 'webgl') throw new Error('WebGL context lost');
      return { shape: [1, 6], dataSync: () => values };
    },
    dispose() { disposals += 1; }, async save(url) { cacheUrls.push(url); },
  });
  const tf = {
    async setBackend(name) { backend = name; return !(name === 'webgl' && webglFalse); },
    async ready() { if (backend === 'webgl' && readyFailure) throw new Error('Backend did not initialize'); },
    getBackend: () => backend,
    async loadGraphModel(url) { loads += 1; cacheUrls.push(url); if (cachedBad && loads === 1) return model(true); throw new Error('Cache unavailable'); },
    tidy: (fn) => fn(), zeros: () => tensor('zero'), browser: { fromPixels: () => tensor('image') },
    image: { resizeBilinear: (input) => input },
  };
  const loadNetworkModel = async () => { networkLoads += 1; if (networkFailure) throw new Error('Missing assets'); return model(); };
  return {
    runtime: createEdgeModelRuntime({ tf, metadata, loadNetworkModel }),
    stats: () => ({ backend, loads, networkLoads, disposals, cacheUrls }),
  };
};

test('invalid labels, output counts, nonfinite values and non-normalized outputs are rejected', () => {
  assert.throws(() => validateLabelMap({ '0': 'only one' }), /label map/);
  assert.throws(() => rankValidatedProbabilities([1], labels), /invalid probabilities/);
  assert.throws(() => rankValidatedProbabilities([NaN, 0, 0, 0, 0, 1], labels), /invalid probabilities/);
  assert.throws(() => rankValidatedProbabilities([1.1, 0, 0, 0, 0, -0.1], labels), /invalid probabilities/);
  assert.throws(() => rankValidatedProbabilities([0.1, 0.1, 0.1, 0.1, 0.1, 0.1], labels), /sum to one/);
  assert.throws(() => validateOutputTensor({ shape: [6], dataSync() {} }), /output shape/);
});

test('classification reports exactly three ranked classes and bundled artifact version', async () => {
  const fixture = makeFixture();
  const result = await fixture.runtime.classify({});
  assert.equal(result.top3.length, 3); assert.deepEqual(result.top3.map((entry) => entry.labelId), [2, 3, 0]);
  assert.equal(result.modelSource, 'bundled'); assert.equal(result.assetFingerprint, metadata.fingerprint);
  assert.equal(result.modelVersion, bundledModelVersion(metadata.fingerprint));
  assert.ok(fixture.stats().cacheUrls.every((url) => url.endsWith(metadata.fingerprint)));
});

test('WebGL false and initialization errors both trigger an actual CPU backend', async () => {
  for (const options of [{ webglFalse: true }, { readyFailure: true }]) {
    const fixture = makeFixture(options);
    const result = await fixture.runtime.init();
    assert.equal(result.backend, 'cpu'); assert.equal(fixture.stats().backend, 'cpu');
  }
});

test('initialization deduplicates parallel callers and does not retain partial failed state', async () => {
  const fixture = makeFixture();
  await Promise.all([fixture.runtime.init(), fixture.runtime.init()]);
  assert.equal(fixture.stats().networkLoads, 1);
  const broken = makeFixture({ networkFailure: true });
  await assert.rejects(broken.runtime.init(), /Missing assets/);
  await assert.rejects(broken.runtime.classify({}), /Missing assets/);
  assert.equal(broken.stats().networkLoads, 4, 'a failed initialization is retried, never treated as ready');
});

test('corrupt cached signature is disposed and replaced before readiness', async () => {
  const fixture = makeFixture({ cachedBad: true });
  await fixture.runtime.init();
  assert.equal(fixture.stats().networkLoads, 1); assert.equal(fixture.stats().disposals, 1);
});

test('inference failure on WebGL reinitializes on CPU before returning a result', async () => {
  const fixture = makeFixture({ imageFailure: true });
  const result = await fixture.runtime.classify({});
  assert.equal(result.backend, 'cpu'); assert.equal(result.top3.length, 3);
  assert.ok(fixture.stats().disposals >= 1);
});

test('different asset fingerprints produce different model identities', () => {
  assert.notEqual(bundledModelVersion('a'.repeat(64)), bundledModelVersion('b'.repeat(64)));
  assert.throws(() => bundledModelVersion('v1'), /fingerprint/);
});
