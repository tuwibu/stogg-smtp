#!/usr/bin/env node
/**
 * test-runtime-executor.cjs - Tests for runtime-executor allowlisting
 *
 * Runtime executors (node, ts-node, tsx, bun) may RUN a compiled/script entrypoint
 * from dist/build, but file readers (cat, grep, less) must stay BLOCKED so build
 * output never floods context. Imports the real scout-checker (no pattern replica).
 */

const path = require('path');
const {
  isRuntimeExecutor,
  isAllowedCommand,
  checkScoutBlock
} = require('../../lib/scout-checker.cjs');

// Real shipped baseline (.claude/.ckignore) — tests/ -> scout-block -> hooks -> .claude
const ckignorePath = path.join(__dirname, '..', '..', '..', '.ckignore');

let passed = 0;
let failed = 0;

function check(actual, expected, desc) {
  if (actual === expected) {
    console.log(`\x1b[32m✓\x1b[0m ${desc}`);
    passed++;
  } else {
    console.log(`\x1b[31m✗\x1b[0m ${desc}: expected ${expected}, got ${actual}`);
    failed++;
  }
}

console.log('Testing runtime-executor allowlist...\n');

// --- isRuntimeExecutor unit ---
console.log('--- isRuntimeExecutor ---');
check(isRuntimeExecutor('node dist/main.js'), true, 'node dist/main.js');
check(isRuntimeExecutor('node build/server.js'), true, 'node build/server.js');
check(isRuntimeExecutor('nodejs dist/app.js'), true, 'nodejs dist/app.js');
check(isRuntimeExecutor('ts-node src/main.ts'), true, 'ts-node src/main.ts');
check(isRuntimeExecutor('tsx dist/x.js'), true, 'tsx dist/x.js');
check(isRuntimeExecutor('bun dist/main.js'), true, 'bun dist/main.js');
check(isRuntimeExecutor('node -e "console.log(1)"'), true, 'node -e inline (execution)');
// Must NOT match lookalikes
check(isRuntimeExecutor('nodemon dist/x.js'), false, 'nodemon (not a bare runtime)');
check(isRuntimeExecutor('bundle exec rake'), false, 'bundle (ruby, not bun)');
check(isRuntimeExecutor('cat dist/main.js'), false, 'cat is not a runtime');

// --- isAllowedCommand (dispatcher-level) ---
console.log('\n--- isAllowedCommand ---');
check(isAllowedCommand('node dist/main.js'), true, 'run compiled entrypoint allowed');
check(isAllowedCommand('NODE_ENV=production node dist/main.js'), true, 'env-prefixed run allowed');
check(isAllowedCommand('cat dist/main.js'), false, 'cat dist file still blocked');
check(isAllowedCommand('grep foo build/out.js'), false, 'grep build file still blocked');
check(isAllowedCommand('less dist/x.js'), false, 'less dist file still blocked');

// --- checkScoutBlock end-to-end against real .ckignore ---
console.log('\n--- checkScoutBlock (Bash) ---');
function blocked(command) {
  const r = checkScoutBlock({
    toolName: 'Bash',
    toolInput: { command },
    options: { ckignorePath, checkBroadPatterns: true }
  });
  return r.blocked === true;
}
check(blocked('node dist/main.js'), false, 'node dist/main.js -> ALLOWED');
check(blocked('node build/main.js'), false, 'node build/main.js -> ALLOWED');
check(blocked('tsx src/main.ts'), false, 'tsx src/main.ts -> ALLOWED');
check(blocked('cat dist/main.js'), true, 'cat dist/main.js -> BLOCKED');
check(blocked('grep secret build/out.js'), true, 'grep build/out.js -> BLOCKED');
// Compound: run is fine, but a reader segment must still block the whole call
check(blocked('node dist/main.js && cat dist/secret.js'), true, 'run && cat -> BLOCKED (reader segment)');

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
