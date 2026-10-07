import { createConnection } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { firebaseCli, javaEnvironment, root, runNode, startNode, stopChild } from './project-tools.mjs';
import { captureEmulatorJavaChildren, stopCapturedEmulatorJava } from './owned-emulator-processes.mjs';

const require = createRequire(import.meta.url);
const env = javaEnvironment({
  VITE_USE_EMULATORS: 'true',
  VITE_FIREBASE_API_KEY: 'demo-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'localhost',
  VITE_FIREBASE_PROJECT_ID: 'demo-sweetcherry',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-sweetcherry.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '0',
  VITE_FIREBASE_APP_ID: 'demo-app',
  VITE_FIREBASE_FUNCTIONS_REGION: 'europe-west1',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9219',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8280',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9399',
  FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5101',
  GCLOUD_PROJECT: 'demo-sweetcherry',
});
const listening = (port) => new Promise((resolve) => {
  const socket = createConnection({ host:'127.0.0.1', port });
  socket.setTimeout(700);
  const finish = (ok) => { socket.destroy(); resolve(ok); };
  socket.once('connect',() => finish(true));
  socket.once('error',() => finish(false));
  socket.once('timeout',() => finish(false));
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve,ms));
const ports = [9219,8280,9399,5101,4610,4710,5289];
for (const port of ports) if (await listening(port)) throw new Error(`Port ${port} is already in use. Stop the existing demo before starting another.`);
const children = [];
let emulatorProcess;
let ownedJava = [];
let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  try {
    if (!ownedJava.length && emulatorProcess) ownedJava = captureEmulatorJavaChildren(emulatorProcess.pid);
  } catch { console.warn('Windows emulator ownership could not be checked during shutdown.'); }
  for (const child of children.reverse()) stopChild(child);
  try { stopCapturedEmulatorJava(ownedJava); }
  catch { console.warn('An owned Windows emulator could not be stopped.'); }
};
process.once('SIGINT',() => { shutdown(); process.exit(0); });
process.once('SIGTERM',() => { shutdown(); process.exit(0); });
process.once('exit',shutdown);
try {
  const emulators = startNode(firebaseCli(), [
    'emulators:start','--config','firebase.demo.json','--only','auth,firestore,storage,functions','--project','demo-sweetcherry',
  ], { env });
  children.push(emulators);
  emulatorProcess = emulators;
  const deadline = Date.now()+150000;
  while (!(await Promise.all([9219,8280,9399,5101].map(listening))).every(Boolean)) {
    if (emulators.exitCode !== null) throw new Error('Firebase emulators exited before becoming ready.');
    if (Date.now()>deadline) throw new Error('Firebase emulators did not start within 150 seconds.');
    await delay(800);
  }
  ownedJava = captureEmulatorJavaChildren(emulators.pid);
  await runNode(join(root,'tests/rules/seed-demo.mjs'),[],{env});
  await runNode(join(root,'scripts/seed-forecast-demo.mjs'),[],{env});
  const vite = startNode(join(dirname(require.resolve('vite/package.json')),'bin/vite.js'),['--host','127.0.0.1','--port','5289','--strictPort'],{env});
  children.push(vite);
  console.log('\nSweetCherry uses fictional emulator accounts and simulated forecast data.');
  console.log('Public app: http://127.0.0.1:5289/');
  for (const [role,account] of [['Farmer','farmerA'],['Expert','expertA'],['Admin','adminA'],['Pending expert','expertC']]) {
    console.log(`${role}: http://127.0.0.1:5289/dev/emulator-preview.html?as=${account}`);
  }
  console.log('Press q then Enter to stop all demo processes. Paid AI/TTS services require opt-in server secrets.');
  // A normal input command lets Windows finish cleanup before the terminal exits.
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (value) => {
    if (value.trim().toLowerCase() === 'q') { shutdown(); process.exit(0); }
  });
  process.stdin.resume();
  await new Promise((resolve,reject) => {
    for (const child of children) {
      child.once('error',reject);
      child.once('exit',(code) => stopping || code === 0 ? resolve() : reject(new Error(`Demo process exited with ${code}.`)));
    }
  });
} finally { shutdown(); process.stdin.pause(); }
