import { join } from 'node:path';
import { npmCli, root, runNode } from './project-tools.mjs';
for (const directory of ['functions', 'tests/rules']) {
  console.log(`Installing locked dependencies in ${directory}...`);
  await runNode(npmCli(), ['ci'], { cwd: join(root,directory) });
}
console.log('Application, Functions and rules-test dependencies are ready.');
