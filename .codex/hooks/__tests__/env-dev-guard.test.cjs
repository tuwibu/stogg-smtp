/**
 * Tests for env-dev-guard.cjs — PreToolUse hook on MCP tool calls (matcher mcp__.*).
 * Run: node .codex/hooks/__tests__/env-dev-guard.test.cjs
 *
 * The guard inspects an MCP tool call's tool_input for any connection string /
 * host / db-name and BLOCKS (exit 2) unless the target is a dev datastore:
 *   - host must be loopback / RFC1918 / a configured dev-host (deny-all default),
 *   - db-name must not look like prod/staging,
 *   - values must not use $-indirection (env bypass),
 * Fail-open (exit 0) on malformed stdin or when the hook is disabled.
 *
 * Spawned via child_process feeding a JSON payload on stdin, mirroring
 * secrets-scanner-pre-commit.test.cjs.
 *
 * Contract: plans/.../phase-04-dev-connector-env-guard.md
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'env-dev-guard.cjs');

let passed = 0;
let failed = 0;

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
    throw new Error(`${msg}\n  Expected: ${JSON.stringify(expected)}\n  Actual:   ${JSON.stringify(actual)}`);
  }
}

function assertContains(actual, substr, msg = '') {
  if (typeof actual !== 'string' || !actual.includes(substr)) {
    throw new Error(`${msg}\n  Expected to contain: ${JSON.stringify(substr)}\n  Actual: ${JSON.stringify(actual)}`);
  }
}

/** Run the hook with a payload object on stdin, from optional cwd. */
function runHook(payload, cwd) {
  return spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    cwd: cwd || process.cwd(),
  });
}

function mcpCall(toolInput, toolName) {
  return { tool_name: toolName || 'mcp__postgres-dev__query', tool_input: toolInput };
}

/** Fresh tmp project dir (no .ck.json → default deny-all). */
function tmpProject(ckJson) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-dev-guard-'));
  if (ckJson) {
    fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.codex', '.ck.json'), JSON.stringify(ckJson));
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

test('1. loopback host (localhost) → allow (exit 0)', () => {
  const dir = tmpProject();
  try {
    const r = runHook(mcpCall({ dsn: 'postgresql://localhost:5432/app' }), dir);
    assertEquals(r.status, 0, `exit code (stderr: ${r.stderr})`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('2. prod RDS host → block (exit 2, deny-all)', () => {
  const dir = tmpProject();
  try {
    const r = runHook(mcpCall({ dsn: 'postgresql://user:pw@prod-db.rds.amazonaws.com:5432/app' }), dir);
    assertEquals(r.status, 2, 'exit code');
    assertContains(r.stderr, 'env-dev-guard', 'message');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('3. db-name contains "staging" → block', () => {
  const dir = tmpProject();
  try {
    const r = runHook(mcpCall({ dsn: 'postgresql://localhost:5432/app_staging' }), dir);
    assertEquals(r.status, 2, 'exit code');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('4. $-indirection value → block ("indirection")', () => {
  const dir = tmpProject();
  try {
    const r = runHook(mcpCall({ dsn: '$PROD_URL' }), dir);
    assertEquals(r.status, 2, 'exit code');
    assertContains(r.stderr.toLowerCase(), 'indirection', 'reason');
    const r2 = runHook(mcpCall({ dsn: '${DATABASE_URL}' }), dir);
    assertEquals(r2.status, 2, 'exit code (braced)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('5. cloud host (s3.amazonaws.com) → block', () => {
  const dir = tmpProject();
  try {
    const r = runHook(mcpCall({ endpoint: 'https://s3.amazonaws.com/bucket' }, 'mcp__s3-dev__list'), dir);
    assertEquals(r.status, 2, 'exit code');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('6. non-dev host with NO .ck.json dev-host config → default block', () => {
  const dir = tmpProject(); // no config
  try {
    const r = runHook(mcpCall({ host: 'db.internal.company.com' }), dir);
    assertEquals(r.status, 2, 'exit code');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('7. RFC1918 host (10.x / 192.168.x / 172.16-31.x) → allow', () => {
  const dir = tmpProject();
  try {
    for (const h of ['10.0.0.5', '192.168.1.10', '172.16.0.1', '172.31.255.1']) {
      const r = runHook(mcpCall({ dsn: `postgresql://${h}:5432/app` }), dir);
      assertEquals(r.status, 0, `host ${h} should allow (stderr: ${r.stderr})`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('8. configured dev-host whitelist → allow', () => {
  const dir = tmpProject({ hooks: { 'env-dev-guard': { allowHosts: ['dev.mycorp.test'] } } });
  try {
    const r = runHook(mcpCall({ dsn: 'postgresql://dev.mycorp.test:5432/app' }), dir);
    assertEquals(r.status, 0, `exit code (stderr: ${r.stderr})`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('9. hook disabled in .ck.json → allow (exit 0) even for prod host', () => {
  const dir = tmpProject({ hooks: { 'env-dev-guard': false } });
  try {
    const r = runHook(mcpCall({ dsn: 'postgresql://prod-db.rds.amazonaws.com/app' }), dir);
    assertEquals(r.status, 0, `exit code (stderr: ${r.stderr})`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('10. malformed stdin → fail-open (exit 0, no crash)', () => {
  const dir = tmpProject();
  try {
    const r = runHook('{ not json', dir);
    assertEquals(r.status, 0, 'exit code');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('12. split structured args {host, database:"production_db"} → block (M3)', () => {
  const dir = tmpProject();
  try {
    const r = runHook(mcpCall({ host: '10.0.0.1', database: 'production_db' }), dir);
    assertEquals(r.status, 2, 'prod db-name via separate key must block');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('13. backtick command substitution mid-value → block (M4)', () => {
  const dir = tmpProject();
  try {
    const r = runHook(mcpCall({ dsn: 'postgresql://localhost/`cat ~/.pgpass`' }), dir);
    assertEquals(r.status, 2, 'backtick must block');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('14. dev db-name via separate key {host, database:"app"} → allow', () => {
  const dir = tmpProject();
  try {
    const r = runHook(mcpCall({ host: 'localhost', database: 'app' }), dir);
    assertEquals(r.status, 0, `dev db should allow (stderr: ${r.stderr})`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('11. non-mcp / no connection info in tool_input → allow', () => {
  const dir = tmpProject();
  try {
    const r = runHook(mcpCall({ limit: 10, query: 'SELECT 1' }), dir);
    assertEquals(r.status, 0, `exit code (stderr: ${r.stderr})`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
