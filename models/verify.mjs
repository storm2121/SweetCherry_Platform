// Sanity check: load the converted TFJS GraphModel in Node and run a forward pass.
// Confirms the artifacts in public/models/plant_disease/ will work in the browser.
//
// Run:  node verify.mjs   (from the models/ folder, after `npm install` below)

import * as tf from "@tensorflow/tfjs";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = resolve(HERE, "..", "public", "models", "plant_disease");

// A tiny file-based IOHandler so we don't need tfjs-node.
function makeFileHandler(modelDir) {
  const modelJsonPath = resolve(modelDir, "model.json");
  const modelJson = JSON.parse(readFileSync(modelJsonPath, "utf-8"));

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
          weightData.byteOffset + weightData.byteLength
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

(async () => {
  await tf.ready();
  console.log(`tfjs backend: ${tf.getBackend()}`);

  const model = await tf.loadGraphModel(makeFileHandler(MODELS_DIR));
  console.log(`model loaded.`);
  console.log(`  inputs:  ${model.inputs.map((i) => `${i.name} ${JSON.stringify(i.shape)}`).join(", ")}`);
  console.log(`  outputs: ${model.outputs.map((o) => `${o.name} ${JSON.stringify(o.shape)}`).join(", ")}`);

  // Forward pass on a zero tensor — we only care that shape/dtype contract holds.
  const input = tf.zeros([1, 224, 224, 3], "float32");
  const output = model.execute(input);
  console.log(`  output shape: ${JSON.stringify(output.shape)}  (expected [1, 38])`);

  const probs = await output.data();
  const sum = probs.reduce((a, b) => a + b, 0);
  console.log(`  probabilities sum: ${sum.toFixed(4)}  (expected ~1.0 after softmax)`);
  console.log(`  first 3 probs: [${probs[0].toFixed(4)}, ${probs[1].toFixed(4)}, ${probs[2].toFixed(4)}]`);

  const labels = JSON.parse(readFileSync(resolve(MODELS_DIR, "labels.json"), "utf-8"));
  console.log(`  labels count: ${Object.keys(labels).length}  (expected 38)`);

  if (output.shape[0] === 1 && output.shape[1] === 38 && Math.abs(sum - 1.0) < 0.05) {
    console.log("\n✓ VERIFIED: model loads, output shape correct, softmax sums to 1.");
    process.exit(0);
  } else {
    console.error("\n✗ FAILED: artifact does not match expected contract.");
    process.exit(1);
  }
})().catch((err) => {
  console.error("verification crashed:", err);
  process.exit(1);
});
