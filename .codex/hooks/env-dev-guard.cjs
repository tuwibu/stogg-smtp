#!/usr/bin/env node
/**
 * env-dev-guard.cjs — PreToolUse hook on MCP tool calls (settings.json matcher: "mcp__.*").
 *
 * Hard-blocks MCP datastore calls that target anything other than a DEV datastore.
 * The only legitimate connection target is a local/dev store; pointing an agent's
 * MCP tool at a prod/staging DSN (by accident or via env indirection) is denied.
 *
 * Block rules (deny-all default — finding 8):
 *   - $-indirection: any tool_input value starting with `$` or `${` → block
 *     (a DSN must be literal in .env.dev, never a variable reference — finding 3).
 *   - host allowlist: loopback (localhost/127.0.0.1/::1), RFC1918
 *     (10.*, 192.168.*, 172.16-31.*), or a configured dev-host. Any other host → block.
 *   - db-name: contains prod/production/staging/stage → block (even on a dev host).
 *
 * Allowlist source (Q#3): .ck.json → hooks['env-dev-guard'].allowHosts (string[]).
 *   Default (no config) = deny-all except loopback/RFC1918.
 *
 * Fail-open: malformed stdin or hook disabled → exit 0. No connection info found in
 * tool_input → exit 0 (nothing to gate).
 *
 * Contract: plans/.../phase-04-dev-connector-env-guard.md
 */

'use strict';

const { isHookEnabled, getHookOption } = require('./lib/ck-config-utils.cjs');

// ─── Host classification ──────────────────────────────────────────────────────

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

/** True if host is loopback or in an RFC1918 private range. */
function isPrivateHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (LOOPBACK.has(h)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

const PROD_DB_RE = /(prod|production|staging|stage)/i;

// ─── tool_input scanning ──────────────────────────────────────────────────────

/** Recursively collect every string value in an object/array. */
function collectStrings(node, out) {
  if (node == null) return;
  if (typeof node === 'string') { out.push(node); return; }
  if (Array.isArray(node)) { for (const v of node) collectStrings(v, out); return; }
  if (typeof node === 'object') { for (const k of Object.keys(node)) collectStrings(node[k], out); }
}

/**
 * Extract { hosts, dbNames } connection targets from a string.
 * Handles full DSNs (scheme://[user[:pass]@]host[:port][/db]) and bare hostnames
 * inside URLs. Returns null if the string carries no connection target.
 */
function extractTargets(str) {
  const hosts = [];
  const dbNames = [];
  // scheme://[creds@]host[:port][/path]
  const dsnRe = /[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s]*@)?([^:/\s?#]+)(?::\d+)?(?:\/([^?\s#]*))?/gi;
  let m;
  while ((m = dsnRe.exec(str)) !== null) {
    if (m[1]) hosts.push(m[1]);
    if (m[2]) dbNames.push(m[2].split('/')[0]);
  }
  return hosts.length ? { hosts, dbNames } : null;
}

/** Keys whose bare-string value should be treated as a host. */
const HOST_KEY_RE = /^(host|hostname|server|endpoint|addr|address)$/i;

/** Keys whose value should be treated as a database/schema name. */
const DB_KEY_RE = /^(database|db|dbname|db_name|schema|catalog)$/i;

/** Collect db-name candidates from db-like keys (structured args, not DSNs). */
function collectDbKeys(node, out) {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const v of node) collectDbKeys(v, out); return; }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (typeof v === 'string' && DB_KEY_RE.test(k)) out.push(v);
    else if (v && typeof v === 'object') collectDbKeys(v, out);
  }
}

/** Collect host candidates from host-like keys (bare hostnames, not URLs). */
function collectHostKeys(node, out) {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const v of node) collectHostKeys(v, out); return; }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (typeof v === 'string' && HOST_KEY_RE.test(k) && !/:\/\//.test(v)) {
      // strip scheme-less host:port / path noise
      out.push(v.replace(/^https?:\/\//, '').split(/[/:\s]/)[0]);
    } else if (v && typeof v === 'object') {
      collectHostKeys(v, out);
    }
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

let payload = '';
process.stdin.on('data', c => { payload += c; });
process.stdin.on('end', () => {
  let data;
  try { data = JSON.parse(payload || '{}'); } catch { process.exit(0); }

  if (!isHookEnabled('env-dev-guard')) process.exit(0);

  const toolInput = data?.tool_input;
  if (!toolInput || typeof toolInput !== 'object') process.exit(0);

  const block = (reason, hint) => {
    process.stderr.write(
      `[env-dev-guard] BLOCKED: ${reason}\n  Hint: ${hint}\n` +
      `  Override: add the host to .ck.json hooks['env-dev-guard'].allowHosts, ` +
      `or disable the hook there.\n`,
    );
    process.exit(2);
  };

  const allowHosts = (getHookOption('env-dev-guard', 'allowHosts', []) || [])
    .map(h => String(h).toLowerCase());

  const strings = [];
  collectStrings(toolInput, strings);

  // 1) $-indirection / command substitution — no variable or shell expansion in a
  //    connection value (env bypass). Catches leading $VAR, ${VAR} anywhere, and backticks.
  for (const s of strings) {
    if (/^\s*\$\{?/.test(s) || /\$\{/.test(s) || /`/.test(s) || /\$\(/.test(s)) {
      block(
        'variable indirection / command substitution not allowed in a dev connection value',
        'Use a literal dev DSN from .env.dev, not a $VAR / ${VAR} / `cmd` reference.',
      );
    }
  }

  // 2) Collect connection targets (hosts + db names).
  const hosts = [];
  const dbNames = [];
  for (const s of strings) {
    const t = extractTargets(s);
    if (t) { hosts.push(...t.hosts); dbNames.push(...t.dbNames); }
  }
  collectHostKeys(toolInput, hosts);
  collectDbKeys(toolInput, dbNames);

  // 3) db-name must not look like prod/staging (checked even without a host, since a
  //    prod db-name on a pre-configured server is still a non-dev target).
  for (const db of dbNames) {
    if (PROD_DB_RE.test(db)) {
      block(`database name "${db}" looks like a non-dev environment`, 'Point at a local dev database.');
    }
  }

  if (hosts.length === 0) process.exit(0); // no host to gate (db-name already cleared)

  // 4) host allowlist (deny-all default).
  for (const host of hosts) {
    const h = host.toLowerCase();
    if (isPrivateHost(h) || allowHosts.includes(h)) continue;
    block(
      `host "${host}" is not a dev datastore (deny-all except loopback/RFC1918/allowHosts)`,
      'Connect only to a local dev store, or whitelist this host in .ck.json hooks[env-dev-guard].allowHosts.',
    );
  }

  process.exit(0);
});
