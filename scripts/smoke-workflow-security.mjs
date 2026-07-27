import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowsDir = path.join(root, '.github', 'workflows');
const workflowFiles = fs.readdirSync(workflowsDir)
  .filter((name) => /\.ya?ml$/i.test(name))
  .sort();

let actionCount = 0;
for (const fileName of workflowFiles) {
  const source = fs.readFileSync(path.join(workflowsDir, fileName), 'utf8');
  assert.doesNotMatch(source, /^\s*contents:\s*write\s*$/m, `${fileName} must not receive repository write access`);

  for (const match of source.matchAll(/^\s*uses:\s*([^#\s]+)(?:\s+#.*)?$/gm)) {
    const action = match[1];
    if (action.startsWith('./')) continue;
    actionCount += 1;
    assert.match(
      action,
      /^[\w.-]+\/[\w.-]+@[a-f0-9]{40}$/,
      `${fileName} action must be pinned to an immutable commit SHA: ${action}`
    );
  }
}

assert.equal(fs.existsSync(path.join(workflowsDir, 'sync.yml')), false, 'automatic upstream writes must remain disabled');
assert.ok(actionCount > 0, 'expected at least one pinned GitHub Action');

console.log(JSON.stringify({
  ok: true,
  workflows: workflowFiles,
  pinnedActions: actionCount,
  repositoryWritePermissions: false,
  automaticUpstreamSync: false
}, null, 2));
