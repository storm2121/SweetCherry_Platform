import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { root } from './project-tools.mjs';

const checks = [
  ['OpenAI credential', /(?<![A-Za-z0-9_-])sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}/g],
  ['private key', new RegExp('-----BEGIN '+'(?:RSA |EC |OPENSSH )?PRIVATE KEY-----','g')],
  ['service account', /"type"\s*:\s*"service_account"/g],
  ['assigned server secret', /(?:OPENAI_API_KEY|ELEVENLABS_API_KEY|CDS_API_KEY|WEATHERAPI_KEY)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/g],
];
const failures = new Set();
const scan = (path,buffer,label = path) => {
  if (/(^|\/)(?:\.env(?:\.[^/]+)?|\.secret\.local)$/.test(path) && !path.endsWith('.env.example')) failures.add(label+': private environment file');
  if (!/\.(?:[cm]?js|jsx|json|md|txt|csv|ya?ml|rules|html|py|ino|ps1)$|\.env\.example$/.test(path)) return;
  const source = buffer.toString('utf8');
  for (const [name,pattern] of checks) {
    pattern.lastIndex = 0;
    if (pattern.test(source)) failures.add(label+': '+name);
  }
};
const git = (args) => spawnSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:24*1024*1024,windowsHide:true});
const listed = git(['ls-files','--cached','--others','--exclude-standard','-z']);
if (listed.status === 0) {
  for (const path of new Set(listed.stdout.split('\0').filter(Boolean))) scan(path,readFileSync(join(root,path)));
} else {
  const skipped = new Set(['node_modules','.git','.venv','venv','dist','.firebase','__pycache__','.pytest_cache','.cache']);
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      if (skipped.has(name) || name === '.env' || /^\.env\./.test(name) && name !== '.env.example') continue;
      const path = join(directory,name);
      if (statSync(path).isDirectory()) visit(path);
      else scan(relative(root,path).replaceAll('\\','/'),readFileSync(path));
    }
  };
  visit(root);
}
if (process.argv.includes('--history')) {
  const revisions = git(['rev-list','--all']);
  if (revisions.status !== 0) throw new Error('Initialise fresh Git history before scanning commits.');
  for (const revision of revisions.stdout.trim().split('\n').filter(Boolean)) {
    const paths = git(['ls-tree','-r','--name-only','-z',revision]).stdout.split('\0').filter(Boolean);
    for (const path of paths) {
      if (!/\.(?:[cm]?js|jsx|json|md|txt|csv|ya?ml|rules|html|py|ino|ps1)$|(^|\/)\.env/.test(path)) continue;
      const blob = git(['show',revision+':'+path]);
      if (blob.status !== 0) throw new Error('Could not inspect a committed file.');
      scan(path,Buffer.from(blob.stdout),revision.slice(0,8)+':'+path);
    }
  }
}
if (failures.size) {
  console.error('Secret-pattern check failed (values are deliberately hidden):\n'+[...failures].join('\n'));
  process.exitCode = 1;
} else console.log('Secret-pattern check passed'+(process.argv.includes('--history')?' for the working tree and every commit.':'.'));
