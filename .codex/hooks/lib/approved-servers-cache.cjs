'use strict';
/**
 * approved-servers-cache.cjs — disk cache of MCP servers the user already approved.
 *
 * Lets the db-connect flow ask "approve connecting to <server>?" only ONCE per
 * server instead of on every connection. Stored under session-state/ (gitignored,
 * persistent across restarts).
 *
 * API:
 *   isApproved(server)  → boolean
 *   approve(server)     → void (idempotent)
 *   list()              → string[]
 *
 * Fail-open: any read/parse error → treated as "not approved" (re-prompt), never throws.
 *
 * Contract: plans/.../phase-04-dev-connector-env-guard.md
 */

const fs = require('fs');
const path = require('path');

// hooks/lib/ → project root is two levels up from hooks/.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const CACHE_DIR = path.join(PROJECT_ROOT, 'session-state');
const CACHE_FILE = path.join(CACHE_DIR, 'approved-mcp-servers.json');

function readCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.servers) ? parsed.servers : [];
  } catch (_) {
    return [];
  }
}

function writeCache(servers) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify({ servers }, null, 2) + '\n', 'utf8');
}

function isApproved(server) {
  if (!server) return false;
  return readCache().includes(server);
}

function approve(server) {
  if (!server) return;
  const servers = readCache();
  if (!servers.includes(server)) {
    servers.push(server);
    writeCache(servers);
  }
}

function list() {
  return readCache();
}

module.exports = { isApproved, approve, list, CACHE_FILE };
