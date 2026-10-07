// Sanity check: load cherry_binary TFJS model from disk, run two known
// Kaggle validation images (one healthy, one mildew), print the probabilities.
// If this prints the wrong class, the bug is in the MODEL (training / conversion).
// If this prints the right class but the React app still shows wrong, the bug
// is in the BROWSER wiring.
//
// Run:  node models/verify_cherry_binary.mjs

import * as tf from '@tensorflow/tfjs';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from 'canvas';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = resolve(HERE, '..', 'public', 'models', 'cherry_binary');
const DATA_ROOT = 'D:/FarmData/Kaggle_Leaves_7.5/New Plant Diseases Dataset(Augmented)/valid';
const HEALTHY_DIR = join(DATA_ROOT, 'Cherry_(including_sour)___healthy');
const MILDEW_DIR = join(DATA_ROOT, 'Cherry_(including_sour)___Powdery_mildew');

function makeFileHandler(modelDir) {
  const modelJson = JSON.parse(readFileSync(resolve(modelDir, 'model.json'), 'utf-8'));
  return {
    load: async () => {
      const manifest = modelJson.weightsManifest[0];
      const weightData = manifest.paths
        .map((p) => readFileSync(resolve(modelDir, p)))
        .reduce((buf, next) => Buffer.concat([buf, next]));
      return {
        modelTopology: modelJson.modelTopology,
        weightSpecs: manifest.weights,
        weightData: weightData.buffer.slice(
          weightData.byteOffset,
          weightData.byteOffset + weightData.byteLength,
        ),
        format: modelJson.format,
        generatedBy: modelJson.generatedBy,
        convertedBy: modelJson.convertedBy,
        signature: modelJson.signature,
        userDefinedMetadata: modelJson.userDefinedMetadata,
        modelInitializer: modelJson.modelInitializer,
      };
    },
  };
}

async function imageToTensor(imgPath) {
  const img = await loadImage(imgPath);
  const canvas = createCanvas(224, 224);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, 224, 224);
  const imageData = ctx.getImageData(0, 0, 224, 224);
  // Canvas uses RGBA; drop alpha. Pixels are uint8 in [0, 255].
  const rgb = new Float32Array(224 * 224 * 3);
  for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 3) {
    rgb[j] = imageData.data[i] / 255;
    rgb[j + 1] = imageData.data[i + 1] / 255;
    rgb[j + 2] = imageData.data[i + 2] / 255;
  }
  return tf.tensor4d(rgb, [1, 224, 224, 3], 'float32');
}

(async () => {
  await tf.ready();
  console.log(`tfjs backend: ${tf.getBackend()}`);

  const model = await tf.loadGraphModel(makeFileHandler(MODELS_DIR));
  const labels = JSON.parse(readFileSync(resolve(MODELS_DIR, 'labels.json'), 'utf-8'));
  console.log('labels.json:', labels);

  const cases = [
    { dir: HEALTHY_DIR, expected: 0, expectedName: 'healthy' },
    { dir: MILDEW_DIR, expected: 1, expectedName: 'mildew' },
  ];

  for (const { dir, expected, expectedName } of cases) {
    const files = readdirSync(dir).slice(0, 3); // test 3 per class
    console.log(`\n=== ${expectedName.toUpperCase()}  (expected class ${expected}) ===`);
    for (const fname of files) {
      const imgPath = join(dir, fname);
      const input = await imageToTensor(imgPath);
      const out = model.execute(input);
      const probs = await out.data();
      const pred = probs[0] > probs[1] ? 0 : 1;
      const maxProb = Math.max(probs[0], probs[1]);
      const correct = pred === expected ? '✓' : '✗';
      console.log(
        `${correct}  ${fname.slice(0, 40)}...  P(healthy)=${probs[0].toFixed(4)}  P(mildew)=${probs[1].toFixed(4)}  → pred=${pred} (${maxProb.toFixed(4)})`,
      );
      input.dispose();
      out.dispose();
    }
  }
})().catch((err) => {
  console.error('verify crashed:', err);
  process.exit(1);
});
