import { join } from 'node:path';
import { firebaseCli, javaEnvironment, root, runNode } from './project-tools.mjs';
await runNode(firebaseCli(), [
  'emulators:exec', '--config', '../../firebase.rules-test.json',
  '--only', 'firestore,storage', '--project', 'demo-sweetcherry',
  'node --test --test-concurrency=1',
], { cwd: join(root,'tests/rules'), env: javaEnvironment() });
// A successful Windows run can leave its Java Firestore child behind.
await runNode(join(root,'tests/rules/stop-orphan-emulator.mjs'), []);
