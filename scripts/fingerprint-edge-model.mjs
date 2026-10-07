import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modelDir = resolve(root, 'public/models/cherry_multiclass');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(resolve(modelDir, 'model.json'));
const labelBytes = await readFile(resolve(modelDir, 'labels.json'));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const labels = JSON.parse(labelBytes.toString('utf8'));
const paths = manifest.weightsManifest.flatMap((group) => group.paths);
const parts = [manifestBytes, labelBytes];
const shards = [];
for (const path of paths) {
  if (!/^[\w.-]+\.bin$/.test(path)) throw new Error('Unsupported model weight path.');
  const bytes = await readFile(resolve(modelDir, path));
  parts.push(bytes);
  shards.push({ path, bytes: bytes.length, sha256: digest(bytes) });
}
const fingerprint = createHash('sha256');
for (const part of parts) fingerprint.update(part);
const metadata = {
  fingerprint: fingerprint.digest('hex'), manifestSha256: digest(manifestBytes), labelsSha256: digest(labelBytes),
  classCount: 6, inputShape: [1, 224, 224, 3], source: 'bundled', labels, shards,
};
await writeFile(resolve(root, 'src/data/edgeModelFingerprint.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log('Bundled cherry model fingerprint generated.');
