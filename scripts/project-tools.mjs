import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
export const npmCli = () => {
  const path = process.env.npm_execpath;
  if (!path || !existsSync(path)) throw new Error('Run this command through npm run, for example npm run demo.');
  return path;
};
export const firebaseCli = () => {
  try { return require.resolve('firebase-tools/lib/bin/firebase.js'); } catch { /* Try the existing global CLI. */ }
  const result = spawnSync(process.execPath, [npmCli(), 'root', '--global'], { encoding: 'utf8', windowsHide: true });
  const path = join(result.stdout?.trim() || '', 'firebase-tools/lib/bin/firebase.js');
  if (result.status !== 0 || !existsSync(path)) {
    throw new Error('Firebase CLI is required. Install firebase-tools@14.26.0, then rerun this command.');
  }
  return path;
};
export const javaEnvironment = (extra = {}) => {
  const env = { ...process.env, ...extra, FIREBASE_CLI_DISABLE_USAGE: 'true', FUNCTIONS_DISCOVERY_TIMEOUT: '60' };
  if (process.platform === 'win32' && !env.JAVA_HOME) {
    for (const base of ['C:/Program Files/Java', 'C:/Program Files/Eclipse Adoptium']) {
      if (!existsSync(base)) continue;
      const name = readdirSync(base).find((entry) => /^jdk-?21(?:[._-]|$)/i.test(entry));
      if (name) { env.JAVA_HOME = join(base, name); env.PATH = join(env.JAVA_HOME, 'bin') + delimiter + env.PATH; break; }
    }
  }
  return env;
};
export const startNode = (script, args, options = {}) => spawn(process.execPath, [script, ...args], {
  cwd: root, stdio: 'inherit', windowsHide: true, ...options,
});
export const runNode = (script, args, options = {}) => new Promise((resolve, reject) => {
  const child = startNode(script,args,options);
  child.once('error',reject);
  child.once('exit',(code,signal) => code === 0 ? resolve() : reject(new Error(`Command exited with ${code ?? signal}.`)));
});
export const stopChild = (child) => {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else child.kill('SIGTERM');
};
