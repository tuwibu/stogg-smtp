/**
 * Tests for getHookOption() — export of ck-config-utils.cjs
 * Run: node .codex/hooks/lib/__tests__/get-hook-option.test.cjs
 *
 * getHookOption(hookName, key, defaultValue):
 *   Returns config.hooks[hookName][key] when the hook value is a plain object;
 *   otherwise returns defaultValue.
 *
 * Config is read from .codex/.ck.json relative to process.cwd().
 * Tests create a temp dir + write a minimal .codex/.ck.json, then chdir into it.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { getHookOption } = require('../ck-config-utils.cjs');

let passed = 0;
let failed = 0;

const originalCwd = process.cwd();

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${e.message}`);
    failed++;
  }
}

function assertEquals(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg}\n  Expected: ${JSON.stringify(expected)}\n  Actual: ${JSON.stringify(actual)}`);
  }
}

/**
 * Create a temp project dir with .codex/.ck.json containing hooksConfig,
 * chdir into it, run fn(), then restore cwd and clean up.
 */
function withConfig(hooksConfig, fn) {
  const tmpDir = path.join(os.tmpdir(), 'ck-test-hook-opt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  const codexDir = path.join(tmpDir, '.codex');
  fs.mkdirSync(codexDir, { recursive: true });

  const config = { hooks: hooksConfig };
  fs.writeFileSync(path.join(codexDir, '.ck.json'), JSON.stringify(config), 'utf8');

  process.chdir(tmpDir);
  try {
    fn();
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Create temp dir with NO .codex/.ck.json at all. */
function withNoConfig(fn) {
  const tmpDir = path.join(os.tmpdir(), 'ck-test-no-config-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(tmpDir, { recursive: true });
  process.chdir(tmpDir);
  try {
    fn();
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

console.log('\n=== Case 6a: hook value is a plain object — returns the key\'s value ===\n');

test('hook object {mode:"minimal"} → getHookOption returns "minimal"', () => {
  withConfig({ 'decision-visibility': { mode: 'minimal' } }, () => {
    const result = getHookOption('decision-visibility', 'mode', 'full');
    assertEquals(result, 'minimal', 'should return object key value');
  });
});

test('hook object {threshold:50} → getHookOption returns 50', () => {
  withConfig({ 'my-hook': { threshold: 50 } }, () => {
    const result = getHookOption('my-hook', 'threshold', 100);
    assertEquals(result, 50);
  });
});

test('hook object {enabled:false} → getHookOption returns false (not default)', () => {
  withConfig({ 'my-hook': { enabled: false } }, () => {
    const result = getHookOption('my-hook', 'enabled', true);
    assertEquals(result, false, 'explicit false in object should override default');
  });
});

test('hook object with multiple keys — correct key retrieved', () => {
  withConfig({ 'my-hook': { mode: 'verbose', level: 3, tag: 'prod' } }, () => {
    assertEquals(getHookOption('my-hook', 'mode', 'default'), 'verbose');
    assertEquals(getHookOption('my-hook', 'level', 0), 3);
    assertEquals(getHookOption('my-hook', 'tag', 'dev'), 'prod');
  });
});

// ---------------------------------------------------------------------------

console.log('\n=== Case 6b: hook value is boolean false — returns defaultValue ===\n');

test('hook value false → returns defaultValue', () => {
  withConfig({ 'my-hook': false }, () => {
    const result = getHookOption('my-hook', 'mode', 'full');
    assertEquals(result, 'full', 'false hook value should return default');
  });
});

// ---------------------------------------------------------------------------

console.log('\n=== Case 6c: hook value is boolean true — returns defaultValue ===\n');

test('hook value true → returns defaultValue (not an object, no key to read)', () => {
  withConfig({ 'my-hook': true }, () => {
    const result = getHookOption('my-hook', 'mode', 'full');
    assertEquals(result, 'full', 'true hook value should return default');
  });
});

// ---------------------------------------------------------------------------

console.log('\n=== Case 6d: hook not defined / undefined — returns defaultValue ===\n');

test('hook undefined (not in config) → returns defaultValue', () => {
  withConfig({}, () => {
    const result = getHookOption('nonexistent-hook', 'mode', 'fallback');
    assertEquals(result, 'fallback', 'undefined hook should return default');
  });
});

test('hooks section absent entirely → returns defaultValue', () => {
  const tmpDir = path.join(os.tmpdir(), 'ck-test-no-hooks-' + Date.now());
  const codexDir = path.join(tmpDir, '.codex');
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(path.join(codexDir, '.ck.json'), JSON.stringify({ workflow: {} }), 'utf8');
  process.chdir(tmpDir);
  try {
    const result = getHookOption('any-hook', 'key', 'default-val');
    assertEquals(result, 'default-val', 'no hooks section should return default');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('no config file → returns defaultValue, no throw', () => {
  withNoConfig(() => {
    const result = getHookOption('my-hook', 'mode', 'safe-default');
    assertEquals(result, 'safe-default', 'should return default when no config');
  });
});

// ---------------------------------------------------------------------------

console.log('\n=== Case 6e: key absent from hook object — returns defaultValue ===\n');

test('key absent from hook object → returns defaultValue', () => {
  withConfig({ 'my-hook': { otherKey: 'value' } }, () => {
    const result = getHookOption('my-hook', 'missingKey', 'my-default');
    assertEquals(result, 'my-default', 'absent key should return default');
  });
});

// ---------------------------------------------------------------------------

console.log('\n=== isHookEnabled backward compat — object value still treated as enabled ===\n');

test('isHookEnabled still returns true when hook value is object (backward compat)', () => {
  const { isHookEnabled } = require('../ck-config-utils.cjs');
  withConfig({ 'my-hook': { mode: 'minimal' } }, () => {
    const result = isHookEnabled('my-hook');
    assertEquals(result, true, 'object config value must still be treated as enabled by isHookEnabled');
  });
});

test('isHookEnabled still returns false when hook value is false', () => {
  const { isHookEnabled } = require('../ck-config-utils.cjs');
  withConfig({ 'my-hook': false }, () => {
    const result = isHookEnabled('my-hook');
    assertEquals(result, false);
  });
});

// ---------------------------------------------------------------------------

console.log('\n=== Summary ===\n');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed > 0) {
  process.exitCode = 1;
}
